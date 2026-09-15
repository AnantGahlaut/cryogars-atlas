"""Small, JSON-only lineage records for new writes; never hash large inputs.

Code hashes are captured at producer import/start, then checked at record time.
They identify local source bytes, not a recovered historical implementation or
a cryptographic attestation of a process. File stat identifiers are explicitly
weaker than content hashes; old archives keep their unknown history.
"""
import hashlib
import importlib.metadata
import json
import math
import platform
import sys
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

_SELF_PATH = Path(__file__).resolve()
_SELF_BYTES = _SELF_PATH.read_bytes()
_SELF_SOURCE = {'sha256': hashlib.sha256(_SELF_BYTES).hexdigest(), 'bytes': len(_SELF_BYTES)}
del _SELF_BYTES


def json_value(value):
    if hasattr(value, 'tolist'):
        return json_value(value.tolist())
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_value(v) for v in value]
    if isinstance(value, (Path,)):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def _json(value):
    return json.dumps(json_value(value), sort_keys=True, separators=(',', ':'), allow_nan=False)


def capture_sources(*paths):
    """Call at import/start for executable modules, before reads for assets."""
    result = {}
    for path in sorted({Path(p).resolve() for p in paths}):
        if path == _SELF_PATH:
            continue
        raw = path.read_bytes()
        result[str(path)] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    result[str(_SELF_PATH)] = dict(_SELF_SOURCE)
    return result


def file_identity(path):
    """Cheap input locator; deliberately contains no purported content digest."""
    path = Path(path)
    stat = path.stat()
    return {'filename': path.name, 'path': str(path.resolve()),
            'bytes': stat.st_size, 'mtime_ns': stat.st_mtime_ns,
            'identity_method': 'filename_size_mtime_not_content_hash'}


@lru_cache(maxsize=1)
def _installed_dependencies():
    versions = {'python': platform.python_version(), 'executable': sys.executable,
                'platform': platform.platform(),
                'version_scope': 'installed distributions in this interpreter'}
    for name in ('numpy', 'h5py', 'scipy', 'rasterio', 'pyproj', 'pandas',
                 'shapely', 'earthaccess', 'asf-search', 'requests'):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = 'not_installed'
    return versions


def _dependencies():
    # Modules may be imported after an earlier write; native versions are live.
    native = {}
    for module, attribute, label in (('h5py', 'version', 'hdf5'),
                                     ('rasterio', '__gdal_version__', 'gdal'),
                                     ('pyproj', 'proj_version_str', 'proj')):
        loaded = sys.modules.get(module)
        value = getattr(loaded, attribute, None)
        if label == 'hdf5':
            value = getattr(value, 'hdf5_version', None)
        native[label] = str(value) if value is not None else 'not_loaded'
    return {**_installed_dependencies(), 'native_libraries': native}


def read_lineage(attrs):
    raw = attrs.get('build_provenance_json')
    if raw is None:
        return {'status': 'unknown_not_recorded',
                'note': 'Historical executable hashes and runtime were not recorded.'}
    try:
        record = json.loads(raw)
        if not isinstance(record, dict):
            raise ValueError('lineage is not an object')
        return record
    except (TypeError, ValueError):
        return {'status': 'unreadable_record', 'recorded_value': json_value(raw)}


def new_record(stage, sources, parameters, inputs=(), parent=None):
    """A new write owns only its explicit scope; inherited products stay upstream."""
    changed = []
    for name, expected in sources.items():
        try:
            if hashlib.sha256(Path(name).read_bytes()).hexdigest() != expected['sha256']:
                changed.append(name)
        except OSError:
            changed.append(name)
    recipe = json_value({'stage': stage, 'sources': sources, 'parameters': parameters,
                         'inputs': list(inputs), 'parent': parent,
                         'dependencies': _dependencies()})
    return {**recipe, 'schema': 'snowex-build-lineage-v1',
            'artifact_id': str(uuid.uuid4()),
            'created_utc': datetime.now(timezone.utc).isoformat(),
            'recipe_sha256': hashlib.sha256(_json(recipe).encode('utf-8')).hexdigest(),
            'source_capture': 'producer_import_or_stage_start; assets_before_read',
            'source_status': 'changed_since_capture' if changed else 'unchanged_since_capture',
            'changed_source_files': changed,
            'prior_lineage_status': 'preserved_in_parent' if parent is not None else 'unknown_not_recorded'}


def store_lineage(attrs, record):
    attrs['build_provenance_json'] = _json(record)
    attrs['artifact_id'] = record['artifact_id']
