"""Offline W1 writer checks using real native readers and generated fixtures."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from assetc_web import ROOT, Compiler, compile_assets, image_info, validate_scene


class AssetCompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = ROOT / 'build/fixtures/source'
        cls.web = ROOT / 'build/assets-web'
        cls.bridge = ROOT / 'build/native/Release/harfang_web_asset_bridge.exe'
        cls.room = json.loads((cls.source / 'scenes/room.scn').read_text())
        cls.manifest = json.loads((cls.web / 'manifest.json').read_text())

    def test_unchanged_scene_and_integrity_of_every_payload(self):
        for entry in self.manifest['assets'].values():
            data = (self.web / entry['uri']).read_bytes()
            self.assertEqual(len(data), entry['byteLength'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
        entry = self.manifest['assets']['scenes/room.scn']
        self.assertEqual((self.source / 'scenes/room.scn').read_bytes(), (self.web / entry['uri']).read_bytes())
        reports = {r['scene']: r for r in self.manifest['reports']}
        self.assertTrue(reports['scenes/room-binary.scn']['binaryConverted'])
        self.assertTrue(reports['materials/materials.scn']['sourceJSONUnchanged'])

    def test_native_mesh_seams_winding_slots_and_bounds(self):
        entry = self.manifest['assets']['models/seamed-cube.geo']
        mesh = json.loads((self.web / entry['uri']).read_text())
        data = (self.web / self.manifest['assets'][mesh['buffer']]['uri']).read_bytes()
        self.assertEqual((mesh['vertexCount'], mesh['indexCount'], mesh['stride']), (24,36,32))
        self.assertEqual(mesh['submeshes'], [dict(material=0,firstIndex=0,indexCount=18),dict(material=1,firstIndex=18,indexCount=18)])
        self.assertEqual(struct.unpack_from('<3H', data, mesh['indexOffset']), (0,2,1))
        positions = {struct.unpack_from('<3f', data, i * 32) for i in range(24)}
        self.assertEqual(len(positions), 8)  # shared source vertices split at corner UV/normal seams
        self.assertEqual(mesh['bounds'], dict(min=[-.5,-.5,-.5],max=[.5,.5,.5]))

    def test_reject_required_features_and_invalid_hierarchy(self):
        for field in ['instances','anims','scene_anims','rigid_bodies','collisions','scripts','videos']:
            scene = copy.deepcopy(self.room); scene[field] = [{}]
            with self.subTest(field=field), self.assertRaises(ValueError): validate_scene(scene, 'room')
        for change in [lambda s: s['objects'][0].update(bones=[0]),
                       lambda s: s['transforms'][5].update(parent=52),
                       lambda s: s['nodes'][1].update(idx=s['nodes'][0]['idx']),
                       lambda s: s['objects'][0]['materials'][0].update(program='custom.hps'),
                       lambda s: s.update(requires=['video'])]:
            scene = copy.deepcopy(self.room); change(scene)
            with self.assertRaises(ValueError): validate_scene(scene, 'room')

    def test_failed_compile_keeps_previous_output_and_names_missing_asset(self):
        with tempfile.TemporaryDirectory(prefix='hg-compiler-test-') as tmp:
            root = Path(tmp); source = root / 'source'; source.mkdir()
            scene = copy.deepcopy(self.room); scene['objects'][2]['name'] = 'models/missing.geo'
            (source / 'bad.scn').write_text(json.dumps(scene))
            output = root / 'assets'; output.mkdir(); (output / '.harfang-web-output').write_text('assetc-web/1')
            (output / 'previous').write_text('preserve me')
            with self.assertRaisesRegex(ValueError, 'models/missing.geo'):
                compile_assets([source, self.source], output, self.bridge, ['bad.scn'])
            self.assertEqual((output / 'previous').read_text(), 'preserve me')

    def test_reject_compiled_bgfx_geometry_and_missing_material_slot(self):
        with tempfile.TemporaryDirectory(prefix='hg-compiler-test-') as tmp:
            root = Path(tmp); compiler = Compiler([ROOT / 'build/assets-native'], root / 'output', self.bridge)
            with self.assertRaisesRegex(ValueError, 'native reader failed'): compiler.mesh('models/seamed-cube.geo')
            source = root / 'source'; source.mkdir()
            scene = copy.deepcopy(self.room); scene['objects'][0]['materials'].pop()
            (source / 'bad.scn').write_text(json.dumps(scene))
            with self.assertRaisesRegex(ValueError, 'missing material slot'):
                compile_assets([source,self.source], root / 'output', self.bridge, ['bad.scn'])

    def test_deterministic_compilation_and_directory_boundaries(self):
        with tempfile.TemporaryDirectory(prefix='hg-compiler-test-') as tmp:
            root = Path(tmp)
            first = compile_assets([self.source], root / 'one', self.bridge, ['scenes/room.scn'])
            second = compile_assets([self.source], root / 'two', self.bridge, ['scenes/room.scn'])
            self.assertEqual(first, second)
            with self.assertRaisesRegex(ValueError, 'separate'):
                compile_assets([self.source], self.source / 'output', self.bridge, [])
            unmarked = root / 'unmarked'; unmarked.mkdir(); (unmarked / 'keep').write_text('keep')
            with self.assertRaisesRegex(ValueError, 'unmarked'):
                compile_assets([self.source], unmarked, self.bridge, [])
            self.assertTrue((unmarked / 'keep').is_file())

    def test_images_and_explicit_structural_mode(self):
        for name in ['pictures/white.png','pictures/quadrants.png','pictures/owl.jpg']:
            entry = self.manifest['assets'][name]
            self.assertEqual(image_info((self.web / entry['uri']).read_bytes()), (entry['width'],entry['height'],entry['mime']))
        pbr = self.manifest['assets']['materials/materials.scn']; scene = json.loads((self.web / pbr['uri']).read_text())
        with self.assertRaises(ValueError): validate_scene(scene,'pbr')
        validate_scene(scene,'pbr',structure=True)
        self.assertEqual(pbr['mode'],'structure')


if __name__ == '__main__':
    unittest.main()
