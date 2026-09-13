"""Offline add-on integration checks using tiny payloads, never HDF5 files."""
import base64
import json
import re
import unittest
from pathlib import Path

from explorer_addon import MARKER, PAYLOAD, append_addon, compact_metadata, original_page


def page():
    payload = {'site': 'example', 'identification': {'site_name': 'Example', 'common_crs_epsg': 32612},
               'dem_path': 'dem', 'grid': {'res_m': 3, 'origin': [637332.5, 4911543], 'full': [5515, 5059]},
               'tree': [{'path': 'dem', 'attrs': {'source_dataset': 'test', 'source_filename': '<source>.tif',
                         'source_url': 'https://example.org/<source>.tif?a=1&b=2'}}],
               'arrays': {'dem': {'cell_m': 24, 'label': 'Elevation'}}}
    return '<style>/* original */</style>\r\n<script id="payload" type="application/json">' + json.dumps(payload) + '</script>\r\n<script>/* original app */</script>\r\n'


class AddonTests(unittest.TestCase):
    def test_supplied_logo_is_embedded_without_cropping_or_resizing_its_slot(self):
        result = append_addon(page())
        logo = re.search(r'id="nxn-logo"[^>]*><img src="data:image/jpeg;base64,([^"]+)"', result)
        self.assertIsNotNone(logo)
        self.assertEqual(base64.b64decode(logo[1]),
                         Path(__file__).with_name('assets').joinpath('cryogars-logo.jpg').read_bytes())
        self.assertIn('width:88px;height:35.2px;', result)
        self.assertIn('height:100%;object-fit:contain;', result)
        self.assertNotIn('top:-75%', result)

    def test_append_preserves_original_bytes_and_data(self):
        source = page(); result = append_addon(source)
        self.assertEqual(original_page(result), source)
        self.assertEqual(PAYLOAD.search(result)[1], PAYLOAD.search(source)[1])
        self.assertNotIn('<base', result)
        self.assertEqual(result.count('id="nxn-script"'), 1)

    def test_repeat_is_idempotent(self):
        first = append_addon(page())
        self.assertEqual(append_addon(first), first)
        self.assertEqual(first.count(MARKER), 1)

    def test_reject_ambiguous_existing_addon(self):
        with self.assertRaises(ValueError):
            append_addon(page() + '<script id="nxn-script"></script>')
        with self.assertRaises(ValueError):
            original_page(page() + MARKER + MARKER)

    def test_metadata_is_site_specific_and_safe_in_script(self):
        source = page(); result = append_addon(source)
        metadata = compact_metadata(json.loads(PAYLOAD.search(source)[1]))
        self.assertEqual(metadata['site'], 'Example')
        self.assertEqual(metadata['layers']['dem']['attrs']['source_filename'], '<source>.tif')
        self.assertIn('\\u003csource>.tif', result)

    def test_dem_metadata_preserves_exact_source_and_grid(self):
        payload = json.loads(PAYLOAD.search(page())[1])
        metadata = compact_metadata(payload)
        self.assertEqual(metadata['origin'], [637332.5, 4911543])
        self.assertEqual(metadata['shape'], [5515, 5059])
        self.assertEqual(metadata['layers']['dem']['attrs']['source_url'],
                         'https://example.org/<source>.tif?a=1&b=2')
        self.assertNotIn('crs_wkt', metadata['layers']['dem']['attrs'])

    def test_older_export_without_grid_details_is_supported(self):
        payload = json.loads(PAYLOAD.search(page())[1])
        payload['grid'] = {'res_m': 3}
        metadata = compact_metadata(payload)
        self.assertIsNone(metadata['origin'])
        self.assertIsNone(metadata['shape'])


if __name__ == '__main__':
    unittest.main()
