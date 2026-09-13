#!/usr/bin/env python3
"""Build the Field Atlas entrance from existing exports, never from HDF5.

    python make_index.py
    python make_index.py --viewer-dir path/to/viewer

Only index.html is written. No scientific layers or viewer preferences change.
This intentionally uses the standard library so UI updates need no science stack.
"""

import argparse
import base64
import html
import json
import math
import re
import struct
from pathlib import Path


PAYLOAD = re.compile(r'<script\b[^>]*\bid=["\']payload["\'][^>]*>(.*?)</script>', re.S)
STATES = {"CO": "Colorado", "ID": "Idaho", "UT": "Utah"}


def terrain_preview(terrain, grid, max_side=82):
    """Sample an existing display mesh; preserve zero/nodata and its quantisation."""
    w, h = int(grid["w"]), int(grid["h"])
    bits = int(terrain["bits"])
    if bits not in (8, 16) or min(w, h) < 1:
        raise ValueError("Invalid exported terrain dimensions or encoding")
    raw = base64.b64decode(terrain["b64"], validate=True)
    if len(raw) != w * h * (bits // 8):
        raise ValueError("Terrain byte count does not match its display grid")
    step = max(1, math.ceil(max(w, h) / max_side))
    xs, ys = list(range(0, w, step)), list(range(0, h, step))
    values = [struct.unpack_from("<H", raw, 2 * (y * w + x))[0]
              if bits == 16 else raw[y * w + x] for y in ys for x in xs]
    return {"w": len(xs), "h": len(ys), "q": values, "bits": bits,
            "lo": terrain["lo"], "hi": terrain["hi"],
            "cell_m": grid["cell_m"] * step}


def read_site(path):
    match = PAYLOAD.search(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"Missing exported payload in {path.name}")
    p = json.loads(match.group(1))
    ident, grid, tree = p["identification"], p["grid"], p["tree"]
    state = ident.get("state", "")
    return {"key": p["site"], "name": ident.get("site_name", p["site"]),
            "state": state, "region": STATES.get(state, state), "file": path.name,
            "layers": len(p["arrays"]), "mib": round(path.stat().st_size / 1024**2, 1),
            "grid": grid["full"], "res_m": grid["res_m"],
            "mesh": [grid["h"], grid["w"]], "mesh_m": grid["cell_m"],
            "groups": sum(t["type"] == "group" for t in tree),
            "datasets": sum(t["type"] == "dataset" for t in tree),
            "attrs": sum(len(t.get("attrs", {})) for t in tree) + len(ident),
            "generated": p.get("generated", ""),
            "has_depth": any(k.endswith("/snow_depth") for k in p["arrays"]),
            "terrain": terrain_preview(p["terrain"], grid)}


def build_index(viewer_dir, files=None, template=None):
    viewer_dir = Path(viewer_dir)
    paths = ([viewer_dir / name for name in files] if files is not None
             else sorted(viewer_dir.glob("*_explorer.html")))
    sites = sorted((read_site(p) for p in paths), key=lambda s: -s["layers"])
    if not sites:
        raise ValueError("No existing *_explorer.html exports found; index left unchanged")
    template = template or Path(__file__).with_name("index_template.html")
    source = Path(template).read_text(encoding="utf-8")
    rows = []
    for i, s in enumerate(sites):
        name, file = html.escape(s["name"]), html.escape(s["file"], quote=True)
        rows.append(
            f'<li class="site-row"><button class="site-select" data-site="{i}" '
            f'aria-pressed="{str(i == 0).lower()}" aria-controls="site-detail">'
            f'<span class="site-number">{i+1:02}</span><span class="site-label">'
            f'<strong>{name}</strong><span>{html.escape(s["region"])} '
            f'&nbsp; / &nbsp; {s["layers"]} layers</span></span>'
            f'<span class="selected-mark" aria-hidden="true">&#8599;</span></button>'
            f'<a class="site-open" href="{file}" aria-label="Open {name} explorer" '
            f'title="Open {name} explorer">&#8599;</a></li>')
    # Escape script-closing strings even when labels originate in source metadata.
    data = json.dumps(sites, separators=(",", ":"), ensure_ascii=True).replace("<", "\\u003c")
    # Embed the unmodified supplied artwork so the landing page stays portable.
    logo = Path(__file__).with_name("assets") / "cryogars-logo.jpg"
    logo_uri = "data:image/jpeg;base64," + base64.b64encode(logo.read_bytes()).decode("ascii")
    replacements = {"__SITES__": data, "__ROWS__": "\n".join(rows),
                    "__LOGO_DATA_URI__": logo_uri,
                    "__COUNT__": str(len(sites)),
                    "__LAYERS__": f'{sum(s["layers"] for s in sites):,}',
                    "__TOTAL_MIB__": f'{sum(s["mib"] for s in sites):.0f}',
                    "__FIRST_NAME__": html.escape(sites[0]["name"]),
                    "__FIRST_FILE__": html.escape(sites[0]["file"], quote=True)}
    for token, value in replacements.items():
        source = source.replace(token, value)
    out = viewer_dir / "index.html"
    out.write_text(source, encoding="utf-8")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--viewer-dir", type=Path, default=Path(__file__).with_name("viewer"))
    args = parser.parse_args()
    print(build_index(args.viewer_dir))


if __name__ == "__main__":
    main()
