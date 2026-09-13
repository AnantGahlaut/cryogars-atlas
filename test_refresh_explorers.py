"""Tests for UI-only rebuilds, with tiny fixtures and no archive access."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from make_index import PAYLOAD
from refresh_explorers import render_explorer, refresh
from test_make_index import fixture


class RefreshTests(unittest.TestCase):
    def test_renderer_keeps_exact_payload_and_stable_viewer_features(self):
        raw=json.dumps(fixture(),indent=2)
        rendered=render_explorer(raw)
        self.assertEqual(PAYLOAD.search(rendered).group(1),raw)
        for token in ('__PAYLOAD__','__LOGO_DATA_URI__','__PRODUCT_GUIDE__'):
            self.assertNotIn(token,rendered)
        self.assertIn('savedPalettes',rendered)
        self.assertIn('syncShownResolution',rendered)
        self.assertNotIn('class="atlas-brand"',rendered)

    def test_empty_folder_does_not_create_files(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):refresh(d)
            self.assertEqual(list(Path(d).iterdir()),[])

    def test_refresh_backs_up_and_preserves_payload(self):
        with tempfile.TemporaryDirectory() as d:
            viewer=Path(d)/'viewer';viewer.mkdir()
            raw=json.dumps(fixture(),indent=2)
            original='<script id="payload" type="application/json">'+raw+'</script>'
            page=viewer/'example_explorer.html';page.write_text(original,encoding='utf-8')
            with patch('refresh_explorers.subprocess.run') as check:
                backup=refresh(viewer)
            check.assert_called_once()
            self.assertEqual((backup/page.name).read_text(encoding='utf-8'),original)
            self.assertEqual(PAYLOAD.search(page.read_text(encoding='utf-8')).group(1),raw)
            self.assertTrue((backup/'manifest.json').exists())

    def test_validation_failure_never_replaces_page(self):
        with tempfile.TemporaryDirectory() as d:
            viewer=Path(d)/'viewer';viewer.mkdir()
            original='<script id="payload" type="application/json">'+json.dumps(fixture())+'</script>'
            page=viewer/'example_explorer.html';page.write_text(original,encoding='utf-8')
            with patch('refresh_explorers.subprocess.run',side_effect=RuntimeError('syntax failed')):
                with self.assertRaises(RuntimeError):refresh(viewer)
            self.assertEqual(page.read_text(encoding='utf-8'),original)


if __name__=='__main__':unittest.main()
