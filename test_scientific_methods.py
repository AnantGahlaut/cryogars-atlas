"""Tiny synthetic checks of the documented current methods; no archive I/O.

Extract only the named functions from the generator AST, avoiding its CLI and
archive pipeline. These tests cover corrected downhill aspect and the retained
nominal-window behavior documented in the viewer.
Circular display averaging tests assert the corrected SNEX-002 behavior.
"""
import ast
import math
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from make_explorer import block_mean, block_circular_mean_degrees, quantise


source = ast.parse(Path(__file__).with_name('enrich_hdf5.py').read_text(encoding='utf-8'))
namespace = {'math': math}
names = {'slope_aspect', 'box_fraction', 'surface_normals', 'local_incidence', 'projected_peg_track'}
module = ast.Module(body=[n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
exec(compile(module, 'isolated_enrichment_methods', 'exec'), namespace)


class ScientificMethodTests(unittest.TestCase):
    def test_slope_and_downhill_aspect_convention(self):
        north_rising = np.repeat(np.arange(6, -1, -1)[:, None], 7, axis=1).astype(float) * 3
        slope, aspect = namespace['slope_aspect'](north_rising, 3)
        self.assertAlmostEqual(float(slope[3, 3]), 45)
        self.assertEqual(float(aspect[3, 3]), 180)
        _, flat = namespace['slope_aspect'](np.ones((5, 5)), 3)
        self.assertTrue(np.isnan(flat).all())

    def test_nominal_ten_cell_window_is_eleven_inclusive(self):
        hit = np.zeros((21, 21), dtype=bool); hit[10, 10] = True
        valid = np.ones_like(hit)
        f = namespace['box_fraction'](hit, valid, 10)
        self.assertAlmostEqual(float(f[10, 10]), 1 / 121)
        self.assertTrue(np.isnan(namespace['box_fraction'](hit, ~valid, 10)).all())

    def test_eight_downhill_aspect_bearings(self):
        rows, cols = np.indices((7, 7), dtype=float)
        for bearing in range(0, 360, 45):
            for gradient in (0.1, 1., 3.):
                with self.subTest(bearing=bearing, gradient=gradient):
                    # A plane descends toward the requested east/north bearing.
                    dem = gradient * (-cols * 3 * math.sin(math.radians(bearing))
                                      + rows * 3 * math.cos(math.radians(bearing)))
                    slope, aspect = namespace['slope_aspect'](dem, 3)
                    self.assertAlmostEqual(float(slope[3, 3]), math.degrees(math.atan(gradient)), places=5)
                    self.assertAlmostEqual(float(aspect[3, 3]), bearing, places=4)

    def test_float32_aspect_rounding_never_emits_360(self):
        rows, cols = np.indices((7, 7), dtype=float)
        _, aspect = namespace['slope_aspect'](rows * 3 + cols * 3e-9, 3)
        self.assertEqual(float(aspect[3, 3]), 0.)
        self.assertTrue(((aspect >= 0) & (aspect < 360)).all())

    def test_aspect_sine_cosine_encoding_preserves_wrap(self):
        theta = np.deg2rad([359., 0.])
        features = np.column_stack((np.sin(theta), np.cos(theta)))
        np.testing.assert_allclose(features[0], [-0.0174524064, 0.9998476952], atol=1e-9)
        np.testing.assert_allclose(features[1], [0, 1], atol=1e-9)
        self.assertLess(float(np.linalg.norm(features[1] - features[0])), 0.018)
        delta = np.arctan2(np.sin(theta[1] - theta[0]), np.cos(theta[1] - theta[0]))
        self.assertAlmostEqual(float(np.rad2deg(delta)), 1)
        self.assertTrue(np.isnan(np.sin(np.deg2rad(np.nan))))

    def test_aspect_display_mean_handles_wrap_and_ordinary_bearings(self):
        for dtype in (np.float32, np.float64):
            for pair, expected in [([359, 1], 0), ([350, 10], 0), ([20, 40], 30),
                                   ([80, 100], 90), ([170, 190], 180), ([260, 280], 270)]:
                with self.subTest(dtype=dtype, pair=pair):
                    values = np.array([pair, pair], dtype=dtype)
                    original = values.copy()
                    result = block_circular_mean_degrees(values, 2)
                    self.assertAlmostEqual(float(result[0, 0]), expected)
                    self.assertTrue(((result >= 0) & (result < 360)).all())
                    np.testing.assert_array_equal(values, original)

    def test_aspect_display_mean_rejects_cancellation_but_not_broad_directions(self):
        for pair in ([90, 270], [0, 180], [45, 225]):
            self.assertTrue(np.isnan(block_circular_mean_degrees(np.tile(pair, (2, 1)), 2)).all())
        # Small but real resultant: this is not a scientific dispersion cutoff.
        values = np.tile([90., 269.999], (2, 1))
        self.assertAlmostEqual(float(block_circular_mean_degrees(values, 2)[0, 0]), 179.9995, places=6)
        values = np.tile([0., 180. - 1e-11], (2, 1))
        self.assertTrue(np.isnan(block_circular_mean_degrees(values, 2)).all())

    def test_aspect_display_mean_masks_all_nonfinite_values(self):
        values = np.array([[350, np.inf], [10, np.nan]])
        self.assertAlmostEqual(float(block_circular_mean_degrees(values, 2)[0, 0]), 0)
        missing = np.array([[np.nan, np.inf], [-np.inf, np.nan]])
        result = block_circular_mean_degrees(missing, 2)
        self.assertTrue(np.isnan(result).all())
        self.assertIsNone(quantise(result))

    def test_aspect_display_stride_one_and_partial_edges(self):
        values = np.array([[0., 360., -1., 721., np.nan, np.inf]])
        original = values.copy()
        np.testing.assert_allclose(block_circular_mean_degrees(values, 1), [[0, 0, 359, 1, np.nan, np.nan]])
        np.testing.assert_array_equal(values, original)
        values = np.full((5, 7), 90., dtype='float32')
        values[-1, :] = 270
        values[:, -1] = 270
        np.testing.assert_array_equal(block_circular_mean_degrees(values, 2), np.full((2, 3), 90))
        self.assertEqual(block_circular_mean_degrees(values, 8).shape, (0, 0))

    def test_horn_edges_and_missing_neighbours(self):
        rows = np.indices((7, 7), dtype=float)[0]
        dem = -rows * 3
        slope, _ = namespace['slope_aspect'](dem, 3)
        self.assertAlmostEqual(float(slope[0, 3]), math.degrees(math.atan(0.5)), places=5)
        dem[3, 3] = np.nan
        slope, aspect = namespace['slope_aspect'](dem, 3)
        self.assertTrue(np.isnan(slope[2:5, 2:5]).all())
        self.assertTrue(np.isnan(aspect[2:5, 2:5]).all())
        self.assertTrue(np.isfinite(slope[1, 1]))

    def test_missing_centre_can_receive_canopy_fraction(self):
        valid = np.ones((11, 11), dtype=bool); valid[5, 5] = False
        f = namespace['box_fraction'](valid, valid, 10)
        self.assertEqual(float(f[5, 5]), 1)

    def test_flat_incidence_respects_look_side(self):
        # Unit-test track/vector math with a fixed projected peg. This does not
        # validate pyproj's geographic transform or require the archive runtime.
        east, north = 0., 0.
        transformer = SimpleNamespace(from_crs=lambda *a, **k: SimpleNamespace(transform=lambda *a: (east, north)))
        dem = np.full((5, 5), 2000.)
        transform = (3, 0, east - 7.5, 0, -3, north + 7.5)
        args = (dem, transform, 32612, 44, -115, 0, 12000)
        with patch.dict(namespace, {'projected_peg_track': lambda *a: (east, north, 0.)}):
            local, flat = namespace['local_incidence'](*args, 'Left')
            right, _ = namespace['local_incidence'](*args, 'Right')
        np.testing.assert_allclose(local, flat, atol=1e-5)
        self.assertTrue(np.isfinite(local[:, :2]).all())
        self.assertTrue(np.isnan(local[:, 2:]).all())
        self.assertTrue(np.isnan(right[:, :3]).all())
        self.assertTrue(np.isfinite(right[:, 3:]).all())
        np.testing.assert_allclose(local[:, :2], right[:, :2:-1], atol=1e-5)

    def test_complex_phase_and_magnitude_are_distinct_averages(self):
        angles = np.deg2rad(np.array([[179., -179.], [179., -179.]]))
        samples = np.exp(1j * angles)
        phase = np.angle(block_mean(samples, 2))[0, 0]
        self.assertAlmostEqual(abs(float(phase)), np.pi)
        magnitude = block_mean(np.abs(samples), 2)[0, 0]
        self.assertAlmostEqual(float(magnitude), 1)
        self.assertGreater(magnitude, abs(block_mean(samples, 2)[0, 0]))

    def test_export_drops_incomplete_edges_and_reserves_zero(self):
        values = np.arange(25, dtype=float).reshape(5, 5)
        self.assertEqual(block_mean(values, 2).shape, (2, 2))
        packed = quantise(np.array([[0., 1., np.nan]]))
        import base64
        self.assertEqual(list(base64.b64decode(packed['b64'])), [1, 255, 0])


if __name__ == '__main__':
    unittest.main()
