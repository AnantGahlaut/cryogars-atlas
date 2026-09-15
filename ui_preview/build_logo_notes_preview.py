"""One additive Banner Summit preview. Never writes the working viewer/template.

Run from any directory: python ui_preview/build_logo_notes_preview.py
The source styles, app script and embedded scientific payload stay byte-identical.
"""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from explorer_addon import compact_metadata

OUT = Path(__file__).resolve().parent
SOURCE = ROOT / 'viewer/banner_summit_explorer.html'
TARGET = OUT / 'banner_summit_logo_notes_preview.html'
BASE = '<base href="../viewer/">\n'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    protected = [ROOT / 'explorer_template.html', ROOT / 'viewer/index.html',
                 *sorted((ROOT / 'viewer').glob('*_explorer.html'))]
    before = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in protected}
    original = SOURCE.read_bytes().decode('utf-8')
    comparison_marker = '\n<!-- SnowEx comparison addon v1 -->\n'
    if original.count(comparison_marker) > 1:
        raise ValueError('Duplicate comparison add-ons; no preview written')
    comparison = comparison_marker + original.split(comparison_marker, 1)[1] if comparison_marker in original else ''
    # A working page may already have the approved production add-on. Replace
    # that isolated suffix in the preview rather than creating duplicate IDs.
    marker = '\n<!-- SnowEx logo and notes addon v1 -->\n'
    if original.count(marker) > 1:
        raise ValueError('Duplicate existing add-ons; no preview written')
    original = original.split(marker, 1)[0]
    if 'id="nxn-script"' in original:
        raise ValueError('Unmarked existing add-on; no preview written')
    match = re.search(r'<script id="payload" type="application/json">(.*?)</script>', original, re.S)
    if not match:
        raise ValueError('Missing existing payload; no preview written')
    payload = json.loads(match[1])
    metadata = compact_metadata(payload)
    encoded = json.dumps(metadata, ensure_ascii=False).replace('<', '\\u003c')
    addon = (OUT / 'logo_notes_addon.html').read_text(encoding='utf-8')
    addon = addon.replace('__NXN_METADATA__', encoded).replace(
        '__NXN_LOGO__', base64.b64encode((ROOT / 'assets/cryogars-logo.jpg').read_bytes()).decode())
    # Only base URL handling and the isolated add-on are added. All existing
    # navigation leaves the preview for the unchanged working viewer directory.
    suffix = '\n' + addon + comparison
    preview = original.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + BASE, 1) + suffix
    restored = preview[:-len(suffix)].replace('<meta charset="utf-8">\n' + BASE, '<meta charset="utf-8">', 1)
    if restored != original:
        raise ValueError('Unexpected modification to original viewer')
    TARGET.write_bytes(preview.encode('utf-8'))
    after = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in protected}
    if before != after:
        raise RuntimeError('A protected working file changed during preview build')
    manifest = {'source': str(SOURCE.relative_to(ROOT)), 'preview': TARGET.name,
                'source_sha256': sha(original.encode('utf-8')),
                'payload_sha256': sha(match[1].encode('utf-8')),
                'protected_files': before}
    (OUT / 'logo_notes_preview_manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Preview created:', TARGET)
    print('Original app, styles and payload preserved. All 10 working files unchanged.')
    print('Elevation source:', json.dumps(metadata['layers'][metadata['dem']]['attrs'], ensure_ascii=True))


if __name__ == '__main__':
    main()
