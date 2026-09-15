#!/usr/bin/env python3
"""Refresh standalone explorer UI without rereading or altering HDF5 data.

Reuses the exact embedded JSON bytes from each existing export. Every replaced
page is backed up first. Run: python refresh_explorers.py
"""
import argparse
import base64
import hashlib
import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from make_index import PAYLOAD, build_index, _SOURCE_SNAPSHOT as _INDEX_SOURCES
from explorer_addon import append_addon, _SOURCE_SNAPSHOT as _ADDON_SOURCES
from comparison_addon import append_comparison, _SOURCE_SNAPSHOT as _COMPARISON_SOURCES
from build_provenance import capture_sources, file_identity, new_record

_RENDER_SOURCES = {**capture_sources(__file__), **_INDEX_SOURCES,
                   **_ADDON_SOURCES, **_COMPARISON_SOURCES}


def render_explorer(payload_text, template=None, parent=None):
    root = Path(__file__).resolve().parent
    template = Path(template or root / "explorer_template.html")
    # Executable modules were captured at import; dynamic assets before reads.
    assets = [template, root / 'product_guide.js', root / 'assets/cryogars-logo.jpg',
              root / 'ui_preview/logo_notes_addon.html', root / 'viewer_compare/panel.html']
    assets += [root / 'viewer_compare' / (name + '.js')
               for name in ('bridge', 'core', 'tiff', 'export', 'mask', 'panel')]
    assets += [root / 'assets/vendor' / name for name in
               ('geotiff-2.1.3.js', 'geotiff-LICENSE', 'proj4-2.12.1.js', 'proj4-LICENSE.md')]
    sources = {**capture_sources(*assets), **_RENDER_SOURCES}
    source = template.read_text(encoding="utf-8")
    if source.count("__PAYLOAD__") != 1:
        raise ValueError("Expected exactly one payload placeholder")
    source = source.replace("__PRODUCT_GUIDE__", (root / "product_guide.js").read_text(encoding="utf-8"))
    logo = base64.b64encode((root / "assets/cryogars-logo.jpg").read_bytes()).decode("ascii")
    source = source.replace("__LOGO_DATA_URI__", "data:image/jpeg;base64," + logo)
    # Keep the approved logo/notes isolated from the stable rendering template.
    rendered = append_comparison(append_addon(source.replace("__PAYLOAD__", payload_text)))
    payload = json.loads(payload_text)
    record = new_record('explorer_render', sources,
                        {'template': str(template.resolve()), 'addons': ['logo_notes', 'comparison'],
                         'browser_runtime': 'client-dependent; not known during HTML generation',
                         'external_fonts': 'remote Google Fonts; bytes not bundled or hashed'},
                        inputs=[{'kind': 'embedded_payload_utf8',
                                 'sha256': hashlib.sha256(payload_text.encode('utf-8')).hexdigest()}],
                        parent=parent or payload.get('build_provenance',
                            {'status': 'unknown_not_recorded', 'file': payload.get('file')}))
    encoded = json.dumps(record, sort_keys=True).replace('<', '\\u003c')
    return rendered + '\n<script id="render-provenance" type="application/json">' + encoded + '</script>\n'



def refresh(viewer_dir, template=None):
    viewer_dir = Path(viewer_dir).resolve()
    paths = sorted(viewer_dir.glob("*_explorer.html"))
    if not paths:
        raise ValueError("No existing explorer pages; nothing was changed")
    # Resolve all targets and prepare/check every replacement before publishing any.
    jobs = []
    for path in paths:
        if path.resolve().parent != viewer_dir:
            raise ValueError("Explorer target is outside viewer directory")
        original = path.read_text(encoding="utf-8")
        match = PAYLOAD.search(original)
        if not match:
            raise ValueError(f"Missing payload: {path.name}")
        raw = match.group(1)
        p = json.loads(raw)
        if path.name != p["site"] + "_explorer.html":
            raise ValueError(f"Site/file mismatch: {path.name}")
        revised = render_explorer(raw, template, parent={
            'file': {**file_identity(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'identity_method': 'sha256_of_original_page_bytes'},
            'data_lineage': p.get('build_provenance', {'status': 'unknown_not_recorded'})})
        if PAYLOAD.search(revised).group(1) != raw:
            raise ValueError("Embedded data changed during refresh")
        jobs.append((path, revised, hashlib.sha256(path.read_bytes()).hexdigest(),
                     hashlib.sha256(raw.encode("utf-8")).hexdigest()))
    backup = viewer_dir.parent / "backups" / ("pre_atlas_explorer_" + datetime.now().strftime("%Y%m%d_%H%M%S_%f"))
    backup.mkdir(parents=True, exist_ok=False)
    staged = backup / "validated_new_pages"
    staged.mkdir()
    checker = Path(__file__).with_name("ui_preview") / "check_preview.js"
    for path, revised, _, _ in jobs:
        shutil.copy2(path, backup / path.name)
        candidate = staged / path.name
        candidate.write_text(revised, encoding="utf-8")
        subprocess.run(["node", str(checker), str(candidate)], check=True,
                       capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    # Preserve an editable copy of the previous UI as well as the complete pages.
    previous = (backup / jobs[0][0].name).read_text(encoding="utf-8")
    old_payload = PAYLOAD.search(previous)
    previous = previous[:old_payload.start(1)] + "__PAYLOAD__" + previous[old_payload.end(1):]
    (backup / "previous_explorer_template.html").write_text(previous, encoding="utf-8")
    if (viewer_dir / "index.html").exists():
        shutil.copy2(viewer_dir / "index.html", backup / "index.html")
    manifest = {"pages": [{"file": p.name, "original_sha256": old, "payload_sha256": payload}
                           for p, _, old, payload in jobs]}
    (backup / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # Detect another agent/user editing a page while validation ran.
    for path, _, old, _ in jobs:
        if hashlib.sha256(path.read_bytes()).hexdigest() != old:
            raise RuntimeError(f"{path.name} changed during preparation; no pages replaced")
    for path, _, _, payload_hash in jobs:
        (staged / path.name).replace(path)
        verified = PAYLOAD.search(path.read_text(encoding="utf-8")).group(1)
        if hashlib.sha256(verified.encode("utf-8")).hexdigest() != payload_hash:
            raise RuntimeError(f"Payload verification failed; restore from {backup}")
    build_index(viewer_dir)
    print(f"Refreshed {len(jobs)} explorers; exact embedded data preserved. Backup: {backup}")
    return backup


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--viewer-dir", type=Path, default=Path(__file__).with_name("viewer"))
    parser.add_argument("--template", type=Path)
    args = parser.parse_args()
    refresh(args.viewer_dir, args.template)
