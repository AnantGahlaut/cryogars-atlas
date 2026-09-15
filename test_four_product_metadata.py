"""Scientific note metadata only; packaging is covered by its existing tests."""
import unittest
from explorer_addon import compact_metadata


def payload():
    group = 'science/UAVSAR/20200201_20200202/LINE'
    return group, {'site': 'test', 'identification': {}, 'grid': {'res_m': 3},
        'tree': [{'path': group, 'attrs': {
            'flight_line': 'LINE', 'processing_level': 'AMPLITUDE_GRD',
            'acquisition_dates': ['2020-02-01', '2020-02-02'],
            'source_url': 'https://example.org/amp.zip', 'original_product_id': 'AMP',
            'interferometry_grd_acquisition_dates': ['2020-03-01', '2020-03-02'],
            'interferometry_grd_source_url': 'https://example.org/int.zip',
            'interferometry_grd_original_product_id': 'INT'}}], 'arrays': {}}


class FourProductMetadataTests(unittest.TestCase):
    def test_amplitude_and_magnitude_bind_their_own_package_and_dates(self):
        group, p = payload()
        for leaf in ('amp1', 'amp2', 'int'):
            source = group + '/HH/' + leaf
            p['tree'].append({'path': source, 'attrs': {'source_member': leaf + '.grd',
                'source_dataset': 'ASF UAVSAR ' + ('AMPLITUDE_GRD' if leaf != 'int' else 'INTERFEROMETRY_GRD')}})
            key = source + (' |magnitude|' if leaf == 'int' else '')
            p['arrays'][key] = {'source': source}
        layers = compact_metadata(p)['layers']
        for leaf in ('amp1', 'amp2'):
            radar = layers[group + '/HH/' + leaf]['radar']
            self.assertEqual(radar['source_url'], 'https://example.org/amp.zip')
            self.assertEqual(radar['source_product_id'], 'AMP')
            self.assertEqual(radar['acquisition_dates'], ['2020-02-01', '2020-02-02'])
        radar = layers[group + '/HH/int |magnitude|']['radar']
        self.assertEqual(radar['source_url'], 'https://example.org/int.zip')
        self.assertEqual(radar['acquisition_dates'], ['2020-03-01', '2020-03-02'])

    def test_amplitude_family_is_recorded_not_guessed_from_leaf(self):
        group, p = payload()
        key = group + '/HH/amp1'
        attrs = {'source_dataset': 'ASF UAVSAR INTERFEROMETRY_GRD'}
        p['tree'].append({'path': key, 'attrs': attrs})
        p['arrays'][key] = {'source': key}
        self.assertEqual(compact_metadata(p)['layers'][key]['radar']['source_url'],
                         'https://example.org/int.zip')
        attrs['source_dataset'] = 'unknown source'
        self.assertNotIn('source_url', compact_metadata(p)['layers'][key]['radar'])

    def test_snow_depth_history_is_copied_without_invented_defaults(self):
        _, p = payload()
        key = 'science/LIDAR/SD/20200201/snow_depth'
        attrs = {'negatives_clipped_to_zero': 0, 'negatives_set_to_nodata': 7,
                 'plausible_range': [0, 15], 'out_of_range_set_to_nodata': 2,
                 'speckle_cells_removed': 4}
        p['tree'].append({'path': key, 'attrs': attrs})
        p['arrays'][key] = {}
        self.assertEqual(compact_metadata(p)['layers'][key]['attrs'], attrs)


if __name__ == '__main__':
    unittest.main()
