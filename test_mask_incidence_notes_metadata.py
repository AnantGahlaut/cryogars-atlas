"""Notes metadata contracts, using tiny payloads without reading science arrays."""
import unittest

from explorer_addon import compact_metadata
from test_four_product_metadata import payload


class MaskIncidenceMetadataTests(unittest.TestCase):
    def test_mask_context_follows_exact_coherence_input_even_without_display_array(self):
        group, p = payload()
        mask = group + '/HH/coherence_mask'
        cor = group + '/VH/cor'
        p['tree'] += [
            {'path': mask, 'attrs': {'derived_from': cor, 'coherence_threshold': .42}},
            {'path': cor, 'attrs': {'source_member': 'exact-vh.cor.grd',
                'source_dataset': 'ASF UAVSAR INTERFEROMETRY_GRD',
                'swath_mask_status': 'applied'}},
            {'path': group + '/HH/cor', 'attrs': {'source_member': 'wrong-hh.cor.grd'}},
        ]
        p['arrays'][mask] = {'source': mask, 'leaf': 'coherence_mask'}
        layer = compact_metadata(p)['layers'][mask]
        self.assertEqual(layer['attrs']['coherence_threshold'], .42)
        self.assertIn('coherence', layer)
        self.assertEqual(layer['coherence']['source'], cor)
        self.assertEqual(layer['coherence']['attrs']['source_member'], 'exact-vh.cor.grd')
        self.assertEqual(layer['radar']['source_url'], 'https://example.org/int.zip')
        self.assertEqual(layer['radar']['acquisition_dates'], ['2020-03-01', '2020-03-02'])

    def test_missing_or_invalid_mask_lineage_cannot_borrow_a_sibling_source(self):
        group, p = payload()
        mask = group + '/HH/coherence_mask'
        attrs = {}
        p['tree'] += [{'path': mask, 'attrs': attrs},
                      {'path': group + '/HH/cor', 'attrs': {'source_member': 'sibling.cor.grd'}}]
        p['arrays'][mask] = {}
        for source in (None, group + '/HH/missing', group + '/HH/amp1', 7):
            attrs['derived_from'] = source
            with self.subTest(source=source):
                layer = compact_metadata(p)['layers'][mask]
                self.assertNotIn('coherence', layer)
                self.assertNotIn('radar', layer)
                self.assertNotIn('coherence_threshold', layer['attrs'])

    def test_geometry_keeps_acquisition_annotation_context_without_inventing_corrections(self):
        group, p = payload()
        scalars = {'peg_latitude_deg': 40.1, 'peg_longitude_deg': -106.2,
                   'peg_heading_deg': 262, 'platform_altitude_m': 12000,
                   'radar_look_direction': 'Left'}
        p['tree'][0]['attrs'].update(scalars)
        for leaf in ('local_incidence_angle', 'incidence_angle_flat'):
            key = group + '/GEOMETRY/' + leaf
            p['tree'].append({'path': key, 'attrs': {'method': 'recorded-method'}})
            p['arrays'][key] = {}
        for layer in compact_metadata(p)['layers'].values():
            self.assertIn('radar', layer)
            radar = layer['radar']
            self.assertEqual(radar['acquisition_dates'], ['2020-02-01', '2020-02-02'])
            self.assertEqual(radar['source_url'], 'https://example.org/amp.zip')
            self.assertEqual(radar['source_product_id'], 'AMP')
            for field, value in scalars.items():
                self.assertEqual(radar[field], value)
            self.assertNotIn('heading_conversion_method', layer['attrs'])
            self.assertNotIn('look_side_mask_method', layer['attrs'])


if __name__ == '__main__':
    unittest.main()
