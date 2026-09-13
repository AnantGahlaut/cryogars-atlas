"""The approved, isolated logo/notes add-on; no HDF5 access or renderer edits.

python explorer_addon.py --rollout
Backs up and validates all eight existing pages before replacing any page.
"""
import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MARKER = '\n<!-- SnowEx logo and notes addon v1 -->\n'
PAYLOAD = re.compile(r'<script id="payload" type="application/json">(.*?)</script>', re.S)
FIELDS = ('source_dataset', 'source_filename', 'source_url', 'acquisition_date',
          'acquisition_date_end', 'source_native_resolution_m',
          'resampling_method', 'source_note', 'source_note_previous',
          'source_note_correction', 'units', 'derived_from', 'derived_from_stage',
          'derived_from_archive', 'derivation_version', 'derivation_nodata_note', 'method',
          'canopy_height_threshold_m', 'window_m', 'window_effective_m',
          'window_cells', 'window_note', 'coherence_threshold',
          'incidence_ge_90_fraction', 'incidence_ge_90_cell_count',
          'incidence_valid_cell_count', 'incidence_ge_90_status', 'incidence_ge_90_note',
          'radar_shadow_fraction')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact_metadata(payload):
    nodes = {n['path']: n for n in payload['tree'] if 'path' in n}
    metadata = {'site': payload['identification'].get('site_name', payload['site']),
                'dem': payload.get('dem_path', ''), 'grid': payload['grid']['res_m'],
                'epsg': payload['identification'].get('common_crs_epsg'),
                'origin': payload['grid'].get('origin'),
                'shape': payload['grid'].get('full'), 'layers': {}}
    for key, layer in payload['arrays'].items():
        attrs = nodes.get(layer.get('source', key), {}).get('attrs', {})
        metadata['layers'][key] = {
            'label': layer.get('label', key.rsplit('/', 1)[-1]),
            'date': layer.get('date'), 'pol': layer.get('pol'),
            'unit': layer.get('unit'), 'cell': layer.get('cell_m', metadata['grid']),
            'attrs': {k: attrs[k] for k in FIELDS if k in attrs}}
        if 'aggregation' in layer:
            metadata['layers'][key]['aggregation'] = layer['aggregation']
    return metadata


def original_page(html):
    if html.count(MARKER) > 1:
        raise ValueError('Duplicate add-on markers; no automatic replacement')
    baseline = html.split(MARKER, 1)[0]
    if 'id="nxn-script"' in baseline or 'id="nxn-style"' in baseline:
        raise ValueError('Unmarked existing add-on; refusing to duplicate it')
    return baseline


def append_addon(html):
    # Later note/logo refreshes must retain an already-installed comparison tool.
    from comparison_addon import MARKER as COMPARE_MARKER, append_comparison
    had_comparison = COMPARE_MARKER in html
    baseline = original_page(html)
    match = PAYLOAD.search(baseline)
    if not match:
        raise ValueError('Missing embedded data; nothing changed')
    metadata = compact_metadata(json.loads(match[1]))
    addon = (ROOT / 'ui_preview/logo_notes_addon.html').read_text(encoding='utf-8')
    encoded = json.dumps(metadata, ensure_ascii=False).replace('<', '\\u003c')
    logo = base64.b64encode((ROOT / 'assets/cryogars-logo.jpg').read_bytes()).decode('ascii')
    addon = addon.replace('__NXN_METADATA__', encoded).replace('__NXN_LOGO__', logo)
    result = baseline + MARKER + addon
    return append_comparison(result) if had_comparison else result


def rollout(viewer_dir=None):
    viewer = Path(viewer_dir or ROOT / 'viewer').resolve()
    paths = sorted(viewer.glob('*_explorer.html'))
    if len(paths) != 8:
        raise ValueError('Expected exactly eight site pages; no files changed')
    protected = [viewer / 'index.html', ROOT / 'explorer_template.html']
    protected_hashes = {str(p): sha(p.read_bytes()) for p in protected}
    jobs = []
    for path in paths:
        if path.resolve().parent != viewer:
            raise ValueError('Page resolves outside the viewer directory')
        before = path.read_bytes()
        text = before.decode('utf-8')
        baseline = original_page(text)
        match = PAYLOAD.search(baseline)
        if not match or path.name != json.loads(match[1])['site'] + '_explorer.html':
            raise ValueError('Site/file mismatch: ' + path.name)
        after = append_addon(text).encode('utf-8')
        if after.split(MARKER.encode(), 1)[0] != baseline.encode('utf-8'):
            raise ValueError('Original renderer changed unexpectedly')
        jobs.append((path, before, after, sha(match[1].encode('utf-8'))))
    if all(before == after for _, before, after, _ in jobs):
        print('All eight pages already have the approved add-on; no writes needed.')
        return None
    backup = ROOT / 'backups' / ('pre_logo_notes_rollout_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    staged = backup / 'validated_candidates'
    staged.mkdir(parents=True, exist_ok=False)
    checker = ROOT / 'ui_preview/check_logo_notes_rollout.js'
    for path, before, after, _ in jobs:
        saved = backup / path.name
        saved.write_bytes(before)
        candidate = staged / path.name
        candidate.write_bytes(after)
        subprocess.run(['node', str(checker), str(candidate), str(saved)], check=True)
    manifest = {
        'protected_files': protected_hashes,
        'addon_template_sha256': sha((ROOT / 'ui_preview/logo_notes_addon.html').read_bytes()),
        'pages': [{'file': path.name, 'before_sha256': sha(before),
                   'after_sha256': sha(after), 'payload_sha256': payload}
                  for path, before, after, payload in jobs]}
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    for path, before, _, _ in jobs:
        if path.read_bytes() != before:
            raise RuntimeError('Page changed during preparation; no pages replaced: ' + path.name)
    for path, expected in protected_hashes.items():
        if sha(Path(path).read_bytes()) != expected:
            raise RuntimeError('Protected file changed during preparation; no pages replaced')
    replaced = []
    try:
        for path, before, after, _ in jobs:
            if path.read_bytes() != before:
                raise RuntimeError('Page changed during commit: ' + path.name)
            (staged / path.name).replace(path)
            replaced.append(path)
            if sha(path.read_bytes()) != sha(after):
                raise RuntimeError('Final page hash mismatch: ' + path.name)
    except Exception:
        for path in replaced:
            shutil.copy2(backup / path.name, path)
        raise
    for path, expected in protected_hashes.items():
        if sha(Path(path).read_bytes()) != expected:
            raise RuntimeError('Protected file changed during rollout: ' + path)
    print('ROLLED OUT: 8 sites; original app/CSS/data preserved; index and template unchanged.')
    print('BACKUP:', backup)
    return backup


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rollout', action='store_true', help='Apply only the approved additive UI to all eight pages')
    args = parser.parse_args()
    if args.rollout:
        rollout()
    else:
        parser.print_help()
