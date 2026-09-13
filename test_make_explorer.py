"""Focused regression tests for the standalone SnowEx viewer generator."""

import base64
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

import make_explorer as explorer
from explorer_addon import PAYLOAD, compact_metadata


class _Dataset:
    def __init__(self, attrs):
        self.attrs = attrs


class DeclaredNodataTests(unittest.TestCase):
    def test_uint8_mask_uses_255_only_as_nodata(self):
        raw = np.array([[0, 1, 255], [1, 0, 255]], dtype=np.uint8)

        clean = explorer.declared_nodata_to_nan(
            _Dataset({"nodata": 255, "nodata_value": 255}), raw
        )

        self.assertEqual(clean.dtype, np.float32)
        np.testing.assert_array_equal(clean[:, :2], raw[:, :2])
        self.assertTrue(np.isnan(clean[:, 2]).all())
        self.assertEqual(int(np.isfinite(clean).sum()), 4)

    def test_nan_nodata_needs_no_copy(self):
        raw = np.array([[0.0, np.nan], [1.0, 0.5]], dtype=np.float32)

        clean = explorer.declared_nodata_to_nan(_Dataset({"nodata": np.nan}), raw)

        self.assertIs(clean, raw)

    def test_clean_mask_quantises_to_science_range(self):
        raw = np.array([[0, 1, 255], [1, 0, 255]], dtype=np.uint8)
        clean = explorer.declared_nodata_to_nan(_Dataset({"nodata": 255}), raw)

        packed = explorer.quantise(clean)

        self.assertEqual(packed["lo"], 0.0)
        self.assertEqual(packed["hi"], 1.0)
        self.assertEqual(packed["valid"], 4)


class AspectExportTests(unittest.TestCase):
    def test_real_export_averages_aspect_circularly_and_preserves_other_products(self):
        import h5py

        aspect = np.repeat([[359, 1, 90, 270, 20, 40, np.nan, 50],
                            [350, 10, 0, 180, 40, 60, np.nan, np.nan]], 2, axis=0).astype('float32')
        scalar = np.tile([0, 180, 0, 100, 2, 4, np.nan, 8], (4, 1)).astype('float32')
        radar = np.tile([2 + 0j, 1j], (4, 4)).astype('complex64')
        aspect_path = 'science/LIDAR/DERIVED/aspect'
        scalar_path = 'science/LIDAR/SD/20200201/snow_depth'
        radar_path = 'science/UAVSAR/20200201_20200202/line/HH/int'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'example.enriched.h5'
            with h5py.File(source, 'w') as archive:
                archive.create_group('identification').attrs.update(
                    common_grid_shape=(4, 8), common_grid_transform=(3, 0, 0, 0, -3, 12),
                    common_grid_resolution_m=3, site_name='Example')
                archive.create_dataset(explorer.DEM_PATH, data=np.full((4, 8), 2000., dtype='float32'))
                archive.create_dataset(aspect_path, data=aspect)
                archive.create_dataset(scalar_path, data=scalar)
                archive.create_dataset(radar_path, data=radar)
            before = source.read_bytes()
            args = SimpleNamespace(terrain_stride=2, stride=2, viewer_dir=root / 'viewer',
                                   template=Path(explorer.__file__).with_name('explorer_template.html'))
            code, _ = explorer.build_site('example', source, args, ['example'])
            self.assertEqual(code, 0)
            payload = json.loads(PAYLOAD.search((args.viewer_dir / 'example_explorer.html').read_text(encoding='utf-8'))[1])
            self.assertEqual(source.read_bytes(), before)

        def decode(layer):
            values = np.frombuffer(base64.b64decode(layer['b64']), dtype=np.uint8).reshape(layer['h'], layer['w'])
            return np.where(values == 0, np.nan, layer['lo'] + (values.astype(float) - 1) / 254 * (layer['hi'] - layer['lo']))

        arrays = payload['arrays']
        np.testing.assert_allclose(decode(arrays[aspect_path]),
                                   [[0, np.nan, 30, 50], [0, np.nan, 50, np.nan]], atol=0.2)
        np.testing.assert_allclose(decode(arrays[scalar_path]), [[90, 50, 3, 8]] * 2, atol=0.35)
        np.testing.assert_allclose(decode(arrays[radar_path + ' ∠phase']), 0.463647609, atol=1e-6)
        np.testing.assert_allclose(decode(arrays[radar_path + ' |magnitude|']), 1.5, atol=1e-6)
        self.assertEqual(arrays[aspect_path]['valid'], int(np.isfinite(aspect).sum()))
        aggregation = arrays[aspect_path]['aggregation']
        self.assertEqual(aggregation['method'], 'circular_mean_degrees')
        self.assertEqual(compact_metadata(payload)['layers'][aspect_path]['aggregation'], aggregation)
        self.assertNotIn('aggregation', arrays[scalar_path])


if __name__ == "__main__":
    unittest.main()
