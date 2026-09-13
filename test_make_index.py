"""Offline index checks: no HDF5, browser, or network required."""

import base64
import hashlib
import json
import re
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import make_index


def fixture(name="Example", key="example"):
    terrain = {"bits": 16, "lo": 100, "hi": 200,
               "b64": base64.b64encode(struct.pack("<4H", 0, 1, 32768, 65535)).decode()}
    return {"site": key, "identification": {"site_name": name, "state": "ID"},
            "grid": {"w": 2, "h": 2, "cell_m": 12, "res_m": 3, "full": [8, 8]},
            "tree": [{"type": "group", "attrs": {"source": "fixture"}}],
            "terrain": terrain, "arrays": {"science/LIDAR/SD/20200101/snow_depth": {}},
            "generated": "2026-09-01 12:00"}


class IndexTests(unittest.TestCase):
    def test_terrain_preserves_nodata_endpoints_and_little_endian(self):
        p = fixture()
        t = make_index.terrain_preview(p["terrain"], p["grid"])
        self.assertEqual(t["q"], [0, 1, 32768, 65535])
        self.assertEqual((t["lo"], t["hi"], t["cell_m"]), (100, 200, 12))

    def test_aspect_and_stride(self):
        p = fixture()
        p["grid"].update(w=8, h=4)
        p["terrain"]["b64"] = base64.b64encode(struct.pack("<32H", *range(32))).decode()
        t = make_index.terrain_preview(p["terrain"], p["grid"], max_side=4)
        self.assertEqual((t["w"], t["h"], t["cell_m"]), (4, 2, 24))
        self.assertEqual(t["q"], [0, 2, 4, 6, 16, 18, 20, 22])

    def test_bad_byte_count_rejected(self):
        p = fixture()
        p["grid"]["h"] = 3
        with self.assertRaises(ValueError):
            make_index.terrain_preview(p["terrain"], p["grid"])

    def test_empty_export_directory_preserves_index(self):
        with tempfile.TemporaryDirectory() as d:
            index = Path(d) / "index.html"
            index.write_text("previous page")
            with self.assertRaises(ValueError):
                make_index.build_index(d)
            self.assertEqual(index.read_text(), "previous page")

    def test_build_is_deterministic_does_not_touch_export_and_escapes_labels(self):
        with tempfile.TemporaryDirectory() as d:
            page = Path(d) / "example_explorer.html"
            p = fixture('Example <img src=x onerror="alert(1)">')
            page.write_text('<script id="payload" type="application/json">' + json.dumps(p) + '</script>')
            before = hashlib.sha256(page.read_bytes()).hexdigest()
            index = make_index.build_index(d)
            rendered = index.read_text(encoding="utf-8")
            self.assertIn('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', rendered)
            self.assertNotIn('__SITES__', rendered)
            self.assertNotIn('__LOGO_DATA_URI__', rendered)
            logo_match = re.search(r'class="brand-logo" src="data:image/jpeg;base64,([^"]+)"', rendered)
            self.assertIsNotNone(logo_match)
            self.assertEqual(base64.b64decode(logo_match.group(1)),
                             Path(make_index.__file__).with_name("assets").joinpath("cryogars-logo.jpg").read_bytes())
            self.assertNotIn('<img src=x', rendered)
            self.assertIn('href="example_explorer.html"', rendered)
            self.assertIn('"has_depth":true', rendered)
            self.assertIn('One 3 m reference grid per site.', rendered)
            self.assertIn('Same row, same column, same mapped location.', rendered)
            self.assertIn('not the native resolution of every instrument', rendered)
            make_index.build_index(d)
            self.assertEqual(index.read_text(encoding="utf-8"), rendered)
            self.assertEqual(hashlib.sha256(page.read_bytes()).hexdigest(), before)

    def test_full_explorer_build_calls_shared_index_builder(self):
        import make_explorer
        with patch("make_index.build_index", return_value=Path("index.html")) as build:
            make_explorer.write_index(Path("viewer"), [{"file": "a_explorer.html"}], "today")
        build.assert_called_once_with(Path("viewer"), files=["a_explorer.html"])


if __name__ == "__main__":
    unittest.main()
