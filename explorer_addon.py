"""The approved, isolated logo/notes add-on; no HDF5 access or renderer edits.

python explorer_addon.py --rollout
Backs up and validates all eight existing pages before replacing any page.
"""
import argparse
import base64
import hashlib
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from build_provenance import capture_sources

_SOURCE_SNAPSHOT = capture_sources(__file__)

ROOT = Path(__file__).resolve().parent
MARKER = '\n<!-- SnowEx logo and notes addon v1 -->\n'
PAYLOAD = re.compile(r'<script id="payload" type="application/json">(.*?)</script>', re.S)
FIELDS = ('source_dataset', 'source_filename', 'source_url', 'acquisition_date',
          'source_member', 'swath_mask_status', 'unw_zero_mask_status',
          'unw_zero_fill_masked', 'unw_zero_note',
          'negatives_clipped_to_zero', 'negatives_set_to_nodata',
          'out_of_range_set_to_nodata', 'speckle_cells_removed', 'plausible_range',
          'acquisition_date_end', 'source_native_resolution_m',
          'resampling_method', 'source_note', 'source_note_previous',
          'source_note_correction', 'units', 'derived_from', 'derived_from_stage',
          'derived_from_archive', 'derivation_version', 'derivation_nodata_note', 'method',
          'canopy_height_threshold_m', 'window_m', 'window_effective_m',
          'window_cells', 'window_note', 'coherence_threshold',
          'incidence_ge_90_fraction', 'incidence_ge_90_cell_count',
          'incidence_valid_cell_count', 'incidence_ge_90_status', 'incidence_ge_90_note',
          'radar_look_direction', 'look_side_mask_method', 'look_side_mask_note',
          'aspect_convention', 'heading_conversion_method', 'track_heading_grid_deg',
          'vertical_reference_status', 'vertical_reference_note',
          'dem_vertical_reference', 'dem_vertical_reference_status',
          'dem_vertical_reference_source', 'geometry_validation_status',
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
        source = layer.get('source', key)
        attrs = nodes.get(source, {}).get('attrs', {})
        metadata['layers'][key] = {
            'source': source, 'leaf': layer.get('leaf', key.rsplit('/', 1)[-1]),
            'label': layer.get('label', key.rsplit('/', 1)[-1]),
            'date': layer.get('date'), 'pol': layer.get('pol'),
            'unit': layer.get('unit'), 'cell': layer.get('cell_m', metadata['grid']),
            'attrs': {k: attrs[k] for k in FIELDS if k in attrs}}
        leaf = source.rsplit('/', 1)[-1]
        geometry = leaf in ('local_incidence_angle', 'incidence_angle_flat')
        radar_source = source
        if leaf == 'coherence_mask':
            radar_source = attrs.get('derived_from')
            if (isinstance(radar_source, str) and radar_source.startswith('science/UAVSAR/')
                    and radar_source.endswith('/cor') and radar_source in nodes):
                input_attrs = nodes[radar_source].get('attrs', {})
                metadata['layers'][key]['coherence'] = {
                    'source': radar_source,
                    'attrs': {k: input_attrs[k] for k in FIELDS if k in input_attrs}}
            else:
                radar_source = ''
        if radar_source.startswith('science/UAVSAR/') and (geometry or leaf in ('amp1', 'amp2', 'cor', 'int', 'unw', 'coherence_mask')):
            # Amplitude and interferometry packages share acquisition groups.
            # Use the recorded amplitude family, not whichever URL is unprefixed.
            level = ({'ASF UAVSAR AMPLITUDE_GRD': 'AMPLITUDE_GRD',
                      'ASF UAVSAR INTERFEROMETRY_GRD': 'INTERFEROMETRY_GRD'}
                     .get(attrs.get('source_dataset')) if leaf in ('amp1', 'amp2')
                     else None if geometry else 'INTERFEROMETRY_GRD')
            prefix = level.lower() + '_' if level else ''
            parent = radar_source.rsplit('/', 1)[0]
            context = {}
            while '/' in parent:
                ancestor = nodes.get(parent, {}).get('attrs', {})
                if 'flight_line' in ancestor or 'acquisition_date_pair' in ancestor:
                    for field in ('acquisition_dates', 'acquisition_date_pair', 'flight_line'):
                        prefixed = prefix + field
                        if prefixed in ancestor or field in ancestor:
                            context[field] = ancestor.get(prefixed, ancestor.get(field))
                    for field, target in (('source_url', 'source_url'),
                                          ('original_product_id', 'source_product_id')):
                        prefixed = prefix + field
                        if level and prefixed in ancestor:
                            context[target] = ancestor[prefixed]
                        elif (geometry or (level and ancestor.get('processing_level') == level)) and field in ancestor:
                            context[target] = ancestor[field]
                    if geometry:
                        for field in ('peg_latitude_deg', 'peg_longitude_deg', 'peg_heading_deg',
                                      'platform_altitude_m', 'radar_look_direction'):
                            if field in ancestor:
                                context[field] = ancestor[field]
                    break
                parent = parent.rsplit('/', 1)[0]
            if source.endswith('/unw'):
                group_attrs = nodes.get(source.rsplit('/', 1)[0], {}).get('attrs', {})
                if 'unw_zero_fill_masked' in group_attrs:
                    context['group_unw_zero_fill_masked'] = group_attrs['unw_zero_fill_masked']
            metadata['layers'][key]['radar'] = context
        if 'aggregation' in layer:
            metadata['layers'][key]['aggregation'] = layer['aggregation']
    return metadata


def _page_parts(html):
    """Split only the notes slot; the renderer bridge and comparison stay opaque."""
    compare = '\n<!-- SnowEx comparison addon v1 -->\n'
    bridge_start = '// BEGIN SnowEx comparison bridge v1\n'
    bridge_end = '// END SnowEx comparison bridge v1\n'
    for marker, label in ((MARKER, 'SnowEx logo and notes addon'),
                          (compare, 'SnowEx comparison addon'),
                          (bridge_start, 'BEGIN SnowEx comparison bridge'),
                          (bridge_end, 'END SnowEx comparison bridge')):
        if html.count(marker) > 1 or html.count(label) != html.count(marker):
            raise ValueError('Duplicate or malformed add-on markers; no automatic replacement')
    notes_at, compare_at = html.find(MARKER), html.find(compare)
    if notes_at >= 0 and compare_at >= 0 and compare_at < notes_at:
        raise ValueError('Reordered add-on markers; no automatic replacement')
    split_at = notes_at if notes_at >= 0 else compare_at if compare_at >= 0 else len(html)
    baseline = html[:split_at]
    suffix = html[compare_at:] if compare_at >= 0 else ''
    notes = html[notes_at + len(MARKER):compare_at if compare_at >= 0 else len(html)] if notes_at >= 0 else ''
    ids = lambda text, prefix: re.findall(r'\bid\s*=\s*[\'\"]?(' + prefix + r'-[\w-]+)', text, re.I)
    if ids(baseline + suffix, 'nxn') or (notes_at >= 0 and any(ids(notes, 'nxn').count(key) != 1 for key in ('nxn-style', 'nxn-script'))):
        raise ValueError('Unmarked or incomplete notes add-on; refusing replacement')
    if ids(baseline + notes, 'nxc'):
        raise ValueError('Unmarked comparison add-on; refusing replacement')
    start, end = html.find(bridge_start), html.find(bridge_end)
    if compare_at >= 0:
        if not (0 <= start < end < split_at):
            raise ValueError('Missing, incomplete, or misplaced comparison bridge')
        if any(ids(suffix, 'nxc').count(key) != 1 for key in ('nxc-style', 'nxc-panel')):
            raise ValueError('Incomplete comparison add-on')
    elif start >= 0 or end >= 0:
        raise ValueError('Comparison bridge without marked comparison add-on')
    outside_bridge = html[:start] + html[end + len(bridge_end):] if start >= 0 else html
    if re.search(r'window\s*\.\s*SnowCompareViewer\s*=', outside_bridge):
        raise ValueError('Unmarked comparison bridge; refusing replacement')
    return baseline, suffix


def original_page(html):
    return _page_parts(html)[0]


def append_addon(html):
    baseline, comparison = _page_parts(html)
    match = PAYLOAD.search(baseline)
    if not match:
        raise ValueError('Missing embedded data; nothing changed')
    metadata = compact_metadata(json.loads(match[1]))
    addon = (ROOT / 'ui_preview/logo_notes_addon.html').read_text(encoding='utf-8')
    encoded = json.dumps(metadata, ensure_ascii=False).replace('<', '\\u003c')
    logo = base64.b64encode((ROOT / 'assets/cryogars-logo.jpg').read_bytes()).decode('ascii')
    addon = addon.replace('__NXN_METADATA__', encoded).replace('__NXN_LOGO__', logo)
    return baseline + MARKER + addon + comparison


def _check_hashes(expected, label):
    for name, digest in expected.items():
        try:
            unchanged = sha(Path(name).read_bytes()) == digest
        except OSError:
            unchanged = False
        if not unchanged:
            raise RuntimeError(label + ' changed; no further pages replaced: ' + name)


def _source_hashes():
    sources = {name: item['sha256'] for name, item in _SOURCE_SNAPSHOT.items()}
    _check_hashes(sources, 'Imported source')
    for name in ('ui_preview/logo_notes_addon.html', 'assets/cryogars-logo.jpg',
                 'ui_preview/check_logo_notes_rollout.js',
                 'ui_preview/banner_summit_logo_notes_preview.html'):
        path = ROOT / name
        sources[str(path.resolve())] = sha(path.read_bytes())
    return sources


def rollout(viewer_dir=None, *, stage_only=False):
    viewer = Path(viewer_dir or ROOT / 'viewer').resolve()
    paths = sorted(viewer.glob('*_explorer.html'))
    if len(paths) != 8:
        raise ValueError('Expected exactly eight site pages; no files changed')
    protected = [viewer / 'index.html', ROOT / 'explorer_template.html']
    protected_hashes = {str(p): sha(p.read_bytes()) for p in protected}
    source_hashes = _source_hashes()
    jobs = []
    metadata = {}
    for path in paths:
        if path.resolve().parent != viewer:
            raise ValueError('Page resolves outside the viewer directory')
        before = path.read_bytes()
        text = before.decode('utf-8')
        baseline, comparison = _page_parts(text)
        match = PAYLOAD.search(baseline)
        if not match or path.name != json.loads(match[1])['site'] + '_explorer.html':
            raise ValueError('Site/file mismatch: ' + path.name)
        after = append_addon(text).encode('utf-8')
        if _page_parts(after.decode('utf-8')) != (baseline, comparison):
            raise ValueError('Original renderer or comparison changed unexpectedly')
        metadata[path.name] = compact_metadata(json.loads(match[1]))
        jobs.append((path, before, after, sha(match[1].encode('utf-8'))))
    if not stage_only and all(before == after for _, before, after, _ in jobs):
        print('All eight pages already have the approved add-on; no writes needed.')
        return None
    backup = ROOT / 'backups' / ('pre_logo_notes_rollout_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    staged = backup / 'validated_candidates'
    staged.mkdir(parents=True, exist_ok=False)
    checker = ROOT / 'ui_preview/check_logo_notes_rollout.js'
    metadata_file = backup / 'compact_metadata.json'
    metadata_file.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    metadata_sha256 = sha(metadata_file.read_bytes())
    for path, before, after, _ in jobs:
        saved = backup / path.name
        saved.write_bytes(before)
        candidate = staged / path.name
        candidate.write_bytes(after)
        subprocess.run(['node', str(checker), str(candidate), str(saved), str(metadata_file)], check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    manifest = {
        'schema': 'snowex-notes-stage-v1',
        'viewer_dir': str(viewer),
        'protected_files': protected_hashes,
        'source_files': source_hashes,
        'compact_metadata_sha256': metadata_sha256,
        'addon_template_sha256': source_hashes[str((ROOT / 'ui_preview/logo_notes_addon.html').resolve())],
        'pages': [{'file': path.name, 'before_sha256': sha(before),
                   'after_sha256': sha(after), 'payload_sha256': payload}
                  for path, before, after, payload in jobs]}
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    _staged_jobs(backup, manifest, viewer)
    if stage_only:
        print('STAGED: 8 candidates validated; production pages unchanged. BACKUP:', backup)
        return backup
    return install_staged(backup, viewer)


def _staged_jobs(backup, manifest, viewer):
    if manifest.get('schema') != 'snowex-notes-stage-v1' or Path(manifest['viewer_dir']).resolve() != viewer:
        raise ValueError('Staged manifest/viewer mismatch')
    names = [entry['file'] for entry in manifest['pages']]
    if len(names) != 8 or len(set(names)) != 8 or any(Path(name).name != name for name in names):
        raise ValueError('Expected exactly eight distinct staged site filenames')
    if sorted(names) != sorted(path.name for path in viewer.glob('*_explorer.html')):
        raise ValueError('Viewer site pages changed since staging')
    expected_protected = {str(viewer / 'index.html'), str(ROOT / 'explorer_template.html')}
    if set(manifest['protected_files']) != expected_protected:
        raise ValueError('Protected file manifest mismatch')
    if set(manifest['source_files']) != set(_source_hashes()):
        raise ValueError('Source file manifest mismatch')
    _check_hashes(manifest['source_files'], 'Source')
    _check_hashes(manifest['protected_files'], 'Protected file')
    _check_hashes({str(backup / 'compact_metadata.json'): manifest['compact_metadata_sha256']}, 'Metadata snapshot')
    jobs = []
    for entry in manifest['pages']:
        path, saved = viewer / entry['file'], backup / entry['file']
        candidate = backup / 'validated_candidates' / entry['file']
        if path.resolve().parent != viewer or saved.resolve().parent != backup or candidate.resolve().parent != backup / 'validated_candidates':
            raise ValueError('Page or staged file resolves outside its expected directory')
        _check_hashes({str(path): entry['before_sha256'], str(saved): entry['before_sha256'],
                       str(candidate): entry['after_sha256']}, 'Page, backup, or candidate')
        before, after = saved.read_bytes(), candidate.read_bytes()
        if sha(before) != entry['before_sha256'] or sha(after) != entry['after_sha256']:
            raise RuntimeError('Backup or candidate changed while reading validated bytes')
        if _page_parts(before.decode('utf-8')) != _page_parts(after.decode('utf-8')):
            raise ValueError('Staged candidate changed renderer or comparison')
        match = PAYLOAD.search(after.decode('utf-8'))
        if not match or sha(match[1].encode('utf-8')) != entry['payload_sha256']:
            raise ValueError('Staged candidate changed payload')
        jobs.append((path, before, after))
    return jobs


def install_staged(backup_dir, viewer_dir=None):
    """Install the exact reviewed files after rechecking every recorded input."""
    backup = Path(backup_dir).resolve()
    manifest_bytes = (backup / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    viewer = Path(viewer_dir or manifest['viewer_dir']).resolve()
    _staged_jobs(backup, manifest, viewer)
    checker = ROOT / 'ui_preview/check_logo_notes_rollout.js'
    for entry in manifest['pages']:
        subprocess.run(['node', str(checker), str(backup / 'validated_candidates' / entry['file']),
                        str(backup / entry['file']), str(backup / 'compact_metadata.json')], check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    jobs = _staged_jobs(backup, manifest, viewer)
    if (backup / 'manifest.json').read_bytes() != manifest_bytes:
        raise RuntimeError('Manifest changed during validation; no pages replaced')
    replaced = []
    try:
        for path, before, after in jobs:
            _check_hashes(manifest['source_files'], 'Source')
            _check_hashes(manifest['protected_files'], 'Protected file')
            if path.read_bytes() != before:
                raise RuntimeError('Page changed during commit: ' + path.name)
            temporary = backup / (path.name + '.installing')
            try:
                temporary.write_bytes(after)
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
            replaced.append((path, before))
            if sha(path.read_bytes()) != sha(after):
                raise RuntimeError('Final page hash mismatch: ' + path.name)
        _check_hashes({str(viewer / entry['file']): entry['after_sha256']
                       for entry in manifest['pages']}, 'Final page')
        _check_hashes(manifest['source_files'], 'Source')
        _check_hashes(manifest['protected_files'], 'Protected file')
    except BaseException:
        for path, before in replaced:
            path.write_bytes(before)
        raise
    print('ROLLED OUT: 8 sites; original app/CSS/data/comparison preserved; index and template unchanged.')
    print('BACKUP:', backup)
    return backup


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--rollout', action='store_true', help='Stage, validate, and apply the approved notes to all eight pages')
    mode.add_argument('--stage-only', action='store_true', help='Create eight validated candidates and backups without replacing pages')
    mode.add_argument('--install-staged', metavar='BACKUP_DIR', help='Verify and install an existing reviewed candidate set')
    args = parser.parse_args()
    if args.install_staged:
        install_staged(args.install_staged)
    elif args.rollout or args.stage_only:
        rollout(stage_only=args.stage_only)
    else:
        parser.print_help()
