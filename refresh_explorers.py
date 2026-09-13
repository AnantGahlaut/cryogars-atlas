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

from make_index import PAYLOAD, build_index
from explorer_addon import append_addon
from comparison_addon import append_comparison


def render_explorer(payload_text, template=None):
    root = Path(__file__).resolve().parent
    source = Path(template or root / "explorer_template.html").read_text(encoding="utf-8")
    if source.count("__PAYLOAD__") != 1:
        raise ValueError("Expected exactly one payload placeholder")
    source = source.replace("__PRODUCT_GUIDE__", (root / "product_guide.js").read_text(encoding="utf-8"))
    logo = base64.b64encode((root / "assets/cryogars-logo.jpg").read_bytes()).decode("ascii")
    source = source.replace("__LOGO_DATA_URI__", "data:image/jpeg;base64," + logo)
    # Keep the approved logo/notes isolated from the stable rendering template.
    return append_comparison(append_addon(source.replace("__PAYLOAD__", payload_text)))


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
        revised = render_explorer(raw, template)
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
        subprocess.run(["node", str(checker), str(candidate)], check=True, capture_output=True, text=True)
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
