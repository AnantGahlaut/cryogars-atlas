"""Offline add-on integration checks using tiny payloads, never HDF5 files."""
import base64
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import explorer_addon
from explorer_addon import MARKER, PAYLOAD, append_addon, compact_metadata, original_page


def page():
    payload = {'site': 'example', 'identification': {'site_name': 'Example', 'common_crs_epsg': 32612},
               'dem_path': 'dem', 'grid': {'res_m': 3, 'origin': [637332.5, 4911543], 'full': [5515, 5059]},
               'tree': [{'path': 'dem', 'attrs': {'source_dataset': 'test', 'source_filename': '<source>.tif',
                         'source_url': 'https://example.org/<source>.tif?a=1&b=2'}}],
               'arrays': {'dem': {'cell_m': 24, 'label': 'Elevation'}}}
    return '<style>/* original */</style>\r\n<script id="payload" type="application/json">' + json.dumps(payload) + '</script>\r\n<script>/* original app */</script>\r\n'


class AddonTests(unittest.TestCase):
    def test_notes_refresh_preserves_historical_comparison_bytes(self):
        from comparison_addon import BRIDGE_START, BRIDGE_END, HOOK, MARKER as comparison_marker
        bridge = BRIDGE_START + 'window.SnowCompareViewer={historical:true};\r\n' + BRIDGE_END
        baseline = page().replace('/* original app */', bridge + HOOK)
        suffix = comparison_marker + '<style id="nxc-style">/* historical */</style>\r\n<dialog id="nxc-panel"></dialog><script id="nxc-ui">/* historical */</script>\r\n'
        old_notes = '<style id="nxn-style">/* old */</style><script id="nxn-script">/* old */</script>\r\n'
        updated = append_addon(baseline + MARKER + old_notes + suffix)
        self.assertEqual(updated.split(MARKER, 1)[0], baseline)
        self.assertEqual(updated[updated.index(comparison_marker):], suffix)
        self.assertEqual(append_addon(updated), updated)
        self.assertEqual(append_addon(baseline + suffix), updated)

    def test_reject_malformed_or_reordered_addons(self):
        from comparison_addon import BRIDGE_START, BRIDGE_END, MARKER as comparison_marker
        notes = '<style id="nxn-style"></style><script id="nxn-script"></script>'
        suffix = comparison_marker + '<style id="nxc-style"></style><dialog id="nxc-panel"></dialog>'
        bridge = BRIDGE_START + 'window.SnowCompareViewer={};\n' + BRIDGE_END
        base = page().replace('/* original app */', bridge + '/* original app */')
        malformed = [
            base + MARKER + notes + suffix + suffix,
            base + suffix + MARKER + notes,
            base + MARKER + notes,
            page() + MARKER + notes + suffix,
            base.replace(BRIDGE_END, '') + MARKER + notes + suffix,
            base.replace(BRIDGE_START, BRIDGE_START + BRIDGE_START) + MARKER + notes + suffix,
            base + MARKER + notes + suffix.replace(comparison_marker, ''),
            page() + MARKER.replace('v1', 'v2') + notes,
            page() + MARKER + '<style id="nxn-style"></style>',
            page() + '<script id=\'nxn-script\'></script>',
            page() + '<dialog id=\'nxc-panel\'></dialog>',
        ]
        for source in malformed:
            with self.subTest(source=source[-120:]), self.assertRaises(ValueError):
                append_addon(source)

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

    def test_radar_notes_bind_the_interferometry_source_and_scoped_zero_history(self):
        payload = json.loads(PAYLOAD.search(page())[1])
        acq = 'science/UAVSAR/20200201_20200202/LINE'
        source = acq + '/HH/int'
        key = source + ' ∠phase'
        payload['tree'] += [
            {'path': acq, 'attrs': {'acquisition_dates': ['2020-02-01', '2020-02-02'],
                'flight_line': 'LINE', 'processing_level': 'AMPLITUDE_GRD',
                'source_url': 'https://example.org/amplitude.zip',
                'interferometry_grd_source_url': 'https://example.org/interferometry.zip',
                'interferometry_grd_original_product_id': 'INTERFEROMETRY-ID'}},
            {'path': acq + '/HH', 'attrs': {'unw_zero_fill_masked': 17}},
            {'path': source, 'attrs': {'source_member': 'exact.int.grd'}},
            {'path': acq + '/HH/unw', 'attrs': {'unw_zero_mask_status': 'skipped_swath_mask_unavailable'}},
        ]
        payload['arrays'][key] = {'source': source, 'leaf': 'int ∠phase', 'unit': 'rad', 'pol': 'HH'}
        payload['arrays'][acq + '/HH/unw'] = {'leaf': 'unw', 'unit': 'rad', 'pol': 'HH'}
        layers = compact_metadata(payload)['layers']
        self.assertEqual(layers[key]['source'], source)
        self.assertEqual(layers[key]['leaf'], 'int ∠phase')
        self.assertEqual(layers[key]['attrs']['source_member'], 'exact.int.grd')
        self.assertEqual(layers[key]['radar']['source_url'], 'https://example.org/interferometry.zip')
        self.assertEqual(layers[key]['radar']['source_product_id'], 'INTERFEROMETRY-ID')
        self.assertEqual(layers[key]['radar']['acquisition_dates'], ['2020-02-01', '2020-02-02'])
        self.assertNotIn('group_unw_zero_fill_masked', layers[key]['radar'])
        self.assertEqual(layers[acq + '/HH/unw']['radar']['group_unw_zero_fill_masked'], 17)
        self.assertEqual(layers[acq + '/HH/unw']['attrs']['unw_zero_mask_status'],
                         'skipped_swath_mask_unavailable')
        del payload['tree'][1]['attrs']['interferometry_grd_source_url']
        self.assertNotIn('source_url', compact_metadata(payload)['layers'][key]['radar'])

    def test_incidence_look_side_metadata_survives_compacting(self):
        payload = json.loads(PAYLOAD.search(page())[1])
        attrs = {'radar_look_direction': 'Left',
                 'look_side_mask_method': 'projected_peg_track_half_plane_v1',
                 'look_side_mask_note': 'Approximate side restriction; not a swath mask.',
                 'dem_vertical_reference': 'NAVD88 orthometric height (GEOID12b)',
                 'dem_vertical_reference_status': 'confirmed_provider_guide',
                 'dem_vertical_reference_source': 'https://example.org/guide',
                 'vertical_reference_note': 'Compatibility unverified; no conversion.',
                 'geometry_validation_status': 'approximate_not_navigation_validated'}
        payload['tree'][0]['attrs'].update(attrs)
        compact = compact_metadata(payload)['layers']['dem']['attrs']
        for key, value in attrs.items():
            self.assertEqual(compact[key], value)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.viewer = self.root / 'viewer'
        self.viewer.mkdir()
        for name in ('ui_preview', 'assets'):
            (self.root / name).mkdir()
        for name in ('ui_preview/logo_notes_addon.html', 'assets/cryogars-logo.jpg'):
            shutil.copyfile(explorer_addon.ROOT / name, self.root / name)
        (self.root / 'ui_preview/banner_summit_logo_notes_preview.html').write_text('approved baseline')
        (self.root / 'ui_preview/check_logo_notes_rollout.js').write_text(
            'const fs=require("node:fs"),assert=require("node:assert/strict");'
            'const [candidate,backup,metadata]=process.argv.slice(2);'
            'const html=fs.readFileSync(candidate,"utf8"),before=fs.readFileSync(backup,"utf8");'
            'assert(html.startsWith(before));'
            'assert.equal(html.split("id=\\"nxn-script\\"").length,2);'
            'const expected=JSON.parse(fs.readFileSync(metadata,"utf8"));'
            'const actual=JSON.parse(html.match(/<script id="nxn-metadata"[^>]*>([\\s\\S]*?)<\\/script>/)[1]);'
            'assert.deepEqual(actual,expected[require("node:path").basename(candidate)]);'
        )
        (self.viewer / 'index.html').write_bytes(b'protected index\r\n')
        (self.root / 'explorer_template.html').write_bytes(b'protected renderer\r\n')
        self.originals = {}
        for number in range(8):
            filename = f'site{number}_explorer.html'
            raw = page().replace('"example"', f'"site{number}"').encode('utf-8')
            (self.viewer / filename).write_bytes(raw)
            self.originals[filename] = raw
        self.root_patch = patch.object(explorer_addon, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def assert_pages_unchanged(self):
        for name, original in self.originals.items():
            self.assertEqual((self.viewer / name).read_bytes(), original)

    def test_stage_only_keeps_originals_and_records_viewable_candidates(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        self.assert_pages_unchanged()
        manifest = json.loads((backup / 'manifest.json').read_text())
        self.assertEqual(len(manifest['pages']), 8)
        self.assertEqual(Path(manifest['viewer_dir']), self.viewer.resolve())
        for name, original in self.originals.items():
            self.assertEqual((backup / name).read_bytes(), original)
            candidate = (backup / 'validated_candidates' / name).read_bytes()
            self.assertTrue(candidate.startswith(original))
            self.assertNotIn(b'<base', candidate)
        self.assertEqual(len(json.loads((backup / 'compact_metadata.json').read_text())), 8)

    def test_install_uses_the_validated_candidates_and_keeps_the_review_files(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        candidates = {name: (backup / 'validated_candidates' / name).read_bytes() for name in self.originals}
        explorer_addon.install_staged(backup)
        for name, expected in candidates.items():
            self.assertEqual((self.viewer / name).read_bytes(), expected)
            self.assertEqual((backup / 'validated_candidates' / name).read_bytes(), expected)
            self.assertEqual((backup / name).read_bytes(), self.originals[name])

    def test_install_aborts_when_reviewed_inputs_change(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        paths = [self.root / 'ui_preview/logo_notes_addon.html',
                 self.viewer / 'site3_explorer.html',
                 self.viewer / 'index.html', self.root / 'explorer_template.html',
                 backup / 'validated_candidates/site3_explorer.html',
                 backup / 'site3_explorer.html', backup / 'compact_metadata.json']
        for path in paths:
            original = path.read_bytes()
            path.write_bytes(original + b'\nchanged during review')
            try:
                with self.subTest(path=path), self.assertRaises((ValueError, RuntimeError)):
                    explorer_addon.install_staged(backup)
                for name, expected in self.originals.items():
                    if self.viewer / name != path:
                        self.assertEqual((self.viewer / name).read_bytes(), expected)
            finally:
                path.write_bytes(original)
        self.assert_pages_unchanged()

    def test_stage_detects_changes_during_validation_without_installing(self):
        checker = self.root / 'ui_preview/check_logo_notes_rollout.js'
        checker.write_text(checker.read_text() +
                           'fs.appendFileSync(require("node:path").join(__dirname,"logo_notes_addon.html"),"\\nchanged");')
        with self.assertRaisesRegex(RuntimeError, 'Source|source'):
            explorer_addon.rollout(self.viewer, stage_only=True)
        self.assert_pages_unchanged()

    def test_stage_rejects_metadata_changed_by_validation(self):
        checker = self.root / 'ui_preview/check_logo_notes_rollout.js'
        checker.write_text(checker.read_text() + 'fs.appendFileSync(metadata,"\\n");')
        with self.assertRaisesRegex(RuntimeError, 'Metadata'):
            explorer_addon.rollout(self.viewer, stage_only=True)
        self.assert_pages_unchanged()

    def test_candidate_change_between_hash_and_read_cannot_be_installed(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        candidate = backup / 'validated_candidates/site0_explorer.html'
        real_read = Path.read_bytes
        reads = 0
        def change_after_hash(path):
            nonlocal reads
            raw = real_read(path)
            if path == candidate:
                reads += 1
                if reads == 3:
                    path.write_bytes(raw + b'<script>/* unreviewed notes change */</script>')
            return raw
        with patch.object(Path, 'read_bytes', change_after_hash):
            with self.assertRaisesRegex(RuntimeError, 'candidate|Candidate'):
                explorer_addon.install_staged(backup)
        self.assert_pages_unchanged()

    def test_install_rolls_back_already_replaced_pages_after_replace_failure(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        real_replace = Path.replace
        def fail_second(source, target):
            if Path(target).name == 'site1_explorer.html':
                raise OSError('simulated replace failure')
            return real_replace(source, target)
        with patch.object(Path, 'replace', fail_second):
            with self.assertRaisesRegex(OSError, 'simulated replace failure'):
                explorer_addon.install_staged(backup)
        self.assert_pages_unchanged()
        self.assertEqual(sorted(p.name for p in self.viewer.iterdir()),
                         ['index.html'] + sorted(self.originals))

    def test_install_rechecks_all_pages_after_the_last_replacement(self):
        backup = explorer_addon.rollout(self.viewer, stage_only=True)
        real_replace = Path.replace
        def mutate_previous_page(source, target):
            result = real_replace(source, target)
            if Path(target).name == 'site1_explorer.html':
                (self.viewer / 'site0_explorer.html').write_bytes(b'changed after its immediate check')
            return result
        with patch.object(Path, 'replace', mutate_previous_page):
            with self.assertRaisesRegex(RuntimeError, 'Final page'):
                explorer_addon.install_staged(backup)
        self.assert_pages_unchanged()


if __name__ == '__main__':
    unittest.main()
