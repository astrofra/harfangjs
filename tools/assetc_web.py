"""Initial assetc web writer: native readers, unchanged scene JSON, explicit buffers.

This standalone frontend is intentionally offline. It reuses HARFANG's C++ scene
and geometry readers through the bridge instead of parsing native binary layouts.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NULL = (None, 4294967295)
CAPABILITIES = {'math.foundation', 'scene.handles', 'scripts.factory', 'assets.bytes', 'host.async-init',
                'input.keyboard', 'input.mouse', 'render.lines', 'scene.static', 'scene.hierarchy', 'scene.camera',
                'render.mesh', 'material.unlit', 'assets.images'}


def check(ok, message):
    if not ok:
        raise ValueError(message)


def logical(name):
    check(isinstance(name, str) and name and not re.search(r'[\\:%?#\x00-\x20]', name)
          and all(part not in ('', '.', '..') for part in name.split('/')), f'Invalid logical path: {name}')
    return name


def requires(values, path):
    check(isinstance(values, list), f'{path}: requires must be an array')
    for value in values:
        check(value in CAPABILITIES, f'{path}: unsupported required capability {value}')


def material(mat, path, structure):
    check(isinstance(mat, dict), f'{path}: material must be an object')
    check(set(mat) <= set('program values textures flags face_culling depth_test blend_mode write_r write_g write_b write_a write_z'.split()), f'{path}: unsupported material field')
    diagnostic = structure and mat.get('program') == 'core/shader/pbr.hps'
    check(mat.get('program') == 'shaders/unlit.hps' or diagnostic, f'{path}: unsupported program {mat.get("program")}')
    check(not mat.get('flags'), f'{path}: material flags require a later slice')
    for key in ('values', 'textures', 'flags'):
        check(key not in mat or isinstance(mat[key], list), f'{path}: {key} must be an array')
    check(diagnostic or mat.get('blend_mode', 'opaque') == 'opaque', f'{path}: W1 requires opaque materials')
    check(mat.get('face_culling', 'cw') in ('disabled', 'cw', 'ccw') and mat.get('depth_test', 'less') in ('less', 'leq', 'always', 'disabled'), f'{path}: unsupported render state')
    for key in ('write_r', 'write_g', 'write_b', 'write_a', 'write_z'):
        check(key not in mat or type(mat[key]) is bool, f'{path}: invalid {key}')
    names, samplers = set(), set()
    for uniform in mat.get('values', []):
        check(uniform.get('type') == 'vec4' and uniform.get('count', 1) == 1, f'{path}: unsupported uniform type')
        vector(uniform.get('value'), 4, path)
        check(diagnostic or uniform.get('name') == 'uColor', f'{path}: unknown uniform {uniform.get("name")}')
        check(uniform.get('name') not in names, f'{path}: duplicate uniform'); names.add(uniform.get('name'))
    for texture in mat.get('textures', []):
        check(isinstance(texture, dict) and set(texture) <= {'name','path','stage'} and isinstance(texture.get('name'), str) and
              type(texture.get('stage')) is int and 0 <= texture['stage'] < 16 and texture['name'] not in samplers, f'{path}: invalid/duplicate texture reference')
        samplers.add(texture['name'])
        check(diagnostic or (texture.get('name') == 'uColorMap' and texture.get('stage') == 0), f'{path}: unsupported texture slot')
        if texture.get('path'):
            logical(texture['path'])


def vector(value, size, path):
    check(isinstance(value, list) and len(value) == size and all(type(n) in (int, float) and math.isfinite(n) for n in value), f'{path}: invalid vector')


def validate_scene(scene, path, structure=False):
    check(isinstance(scene, dict), f'{path}: expected scene object')
    requires(scene.get('requires', []), path)
    arrays = ('nodes', 'transforms', 'cameras', 'objects', 'lights', 'instances', 'anims', 'scene_anims', 'rigid_bodies', 'collisions', 'scripts', 'scene_scripts')
    check(set(scene) <= set(arrays) | {'canvas', 'environment', 'key_values', 'requires'}, f'{path}: unsupported scene field {set(scene) - set(arrays) - {"canvas", "environment", "key_values", "requires"}}')
    for key in arrays:
        check(scene.get(key) is None or isinstance(scene[key], list), f'{path}: {key} must be an array')
    for key in ('instances', 'anims', 'scene_anims', 'rigid_bodies', 'collisions', 'scripts', 'scene_scripts'):
        check(not scene.get(key), f'{path}: {key} requires a later or excluded capability')
    check(structure or not scene.get('lights'), f'{path}: lights require W2')
    nodes, transforms, cameras, objects = (scene.get(key) or [] for key in ('nodes', 'transforms', 'cameras', 'objects'))
    check(len(nodes) <= 10000, f'{path}: node budget exceeded')
    ids = {}
    def only(obj, keys):
        check(isinstance(obj, dict) and set(obj) <= set(keys.split()), f'{path}: unsupported component field')
    for node in nodes:
        only(node, 'idx name disabled components instance collisions scripts')
        check(type(node.get('idx')) is int and 0 <= node['idx'] < 4294967295 and node['idx'] not in ids and isinstance(node.get('name'), str), f'{path}: duplicate/invalid node index or name')
        ids[node['idx']] = node
        check(isinstance(node.get('components'), list) and len(node['components']) == 5, f'{path}: invalid component slots')
        for index, table in zip(node['components'], (transforms, cameras, objects, scene.get('lights') or [], [])):
            check(index in NULL or (type(index) is int and 0 <= index < len(table)), f'{path}: invalid component index in {node["name"]}')
        check(node.get('instance') in NULL and not node.get('scripts') and not node.get('collisions'), f'{path}: unsupported node component')
        check('disabled' not in node or type(node['disabled']) is bool, f'{path}: disabled must be boolean')
        if node['components'][1] not in NULL or node['components'][2] not in NULL:
            check(node['components'][0] not in NULL, f'{path}: camera/object requires a transform')
    for t in transforms:
        only(t, 'pos rot scl parent')
        for field in ('pos', 'rot', 'scl'):
            vector(t.get(field), 3, path)
        check(t.get('parent') in NULL or t['parent'] in ids, f'{path}: missing parent')
    for node in nodes:
        seen, current = set(), node
        while current and current['components'][0] not in NULL:
            check(current['idx'] not in seen and len(seen) < 128, f'{path}: cyclic/deep hierarchy')
            seen.add(current['idx'])
            current = ids.get(transforms[current['components'][0]].get('parent'))
    for c in cameras:
        only(c, 'zrange fov ortho size')
        near, far = c.get('zrange', {}).get('znear', .01), c.get('zrange', {}).get('zfar', 1000)
        check(type(c.get('ortho', False)) is bool, f'{path}: invalid camera projection')
        check(all(type(n) in (int,float) and math.isfinite(n) for n in (near,far)) and near >= 0 and (c.get('ortho') or near > 0) and far > near, f'{path}: invalid camera range')
        fov, size = c.get('fov', math.radians(40)), c.get('size', 1)
        check(all(type(n) in (int,float) and math.isfinite(n) for n in (fov,size)) and 0 < fov < math.pi and size > 0, f'{path}: invalid camera FOV/size')
    for i, obj in enumerate(objects):
        only(obj, 'name materials material_infos bones')
        logical(obj['name']); check(not obj.get('bones'), f'{path}: skinning is outside W1')
        check(isinstance(obj.get('materials'), list) and obj['materials'], f'{path}: missing materials')
        for slot, mat in enumerate(obj['materials']):
            material(mat, f'{path}.objects[{i}].materials[{slot}]', structure)
    env = scene.get('environment') or {}
    camera = env.get('current_camera')
    check(camera in NULL or (camera in ids and ids[camera]['components'][1] not in NULL), f'{path}: invalid current camera')
    if not structure:
        check(not any(env.get(key) for key in ('fog_far', 'brdf_map', 'irradiance_map', 'radiance_map')) and
              not any(env.get('probe', {}).get(key) for key in ('irradiance_map', 'radiance_map')), f'{path}: environment lighting requires W2')
    canvas = scene.get('canvas') or {}
    if 'color' in canvas:
        vector(canvas['color'], 4, path)
    for key in ('clear_color', 'clear_z'):
        check(key not in canvas or type(canvas[key]) is bool, f'{path}: invalid canvas flag')
    metadata = scene.get('key_values')
    check(metadata is None or (isinstance(metadata, dict) and all(isinstance(v,str) for v in metadata.values())), f'{path}: invalid key_values')
    return scene


def image_info(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        width, height = struct.unpack('>II', data[16:24])
        return width, height, 'image/png'
    check(data.startswith(b'\xff\xd8'), 'Only PNG/JPEG images are supported')
    offset = 2
    while offset < len(data):
        check(data[offset] == 255, 'Invalid JPEG marker')
        while data[offset] == 255:
            offset += 1
        marker = data[offset]; offset += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        length = struct.unpack('>H', data[offset:offset + 2])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack('>HH', data[offset + 3:offset + 7])
            return width, height, 'image/jpeg'
        check(length >= 2, 'Invalid JPEG segment')
        offset += length
    raise ValueError('JPEG dimensions are missing')


class Compiler:
    def __init__(self, roots, output, bridge):
        self.roots, self.output, self.bridge = [p.resolve() for p in roots], output, bridge.resolve()
        self.assets, self.reports, self.meshes = {}, [], {}

    def source(self, name):
        logical(name)
        for root in self.roots:
            path = (root / name).resolve()
            check(path.is_relative_to(root), f'{name}: source escapes root')
            if path.is_file():
                return path
        raise ValueError(f'{name}: missing source dependency')

    def native(self, command, source, destination):
        result = subprocess.run([str(self.bridge), command, str(source), str(destination)], capture_output=True, text=True)
        check(result.returncode == 0, f'{source}: native reader failed: {result.stderr}\n{result.stdout}')

    def emit(self, name, data, suffix, kind, dependencies=None, **extra):
        check(len(data) <= 67108864, f'{name}: compiled payload exceeds the 64 MiB byte budget')
        digest = hashlib.sha256(data).hexdigest()
        uri = f'objects/{digest[:24]}.{suffix}'
        path = self.output / uri; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        self.assets[name] = dict(kind=kind, uri=uri, byteLength=len(data), sha256=digest, dependencies=dependencies or [], **extra)

    def mesh(self, name):
        if name in self.assets:
            return
        with tempfile.TemporaryDirectory(prefix='hg-mesh-') as tmp:
            intermediate = Path(tmp) / 'mesh.json'
            self.native('geometry', self.source(name), intermediate)
            mesh = json.loads(intermediate.read_text())
        vertices, indices = mesh['vertices'], mesh['indices']
        check(3 <= len(vertices) // 8 <= 4000000 and 3 <= len(indices) <= 12000000, f'{name}: mesh budget exceeded')
        wide = mesh['vertexCount'] > 65535
        data = struct.pack(f'<{len(vertices)}f', *vertices) + struct.pack(f'<{len(indices)}{"I" if wide else "H"}', *indices)
        buffer_id = name + '.buffer'
        self.emit(buffer_id, data, 'bin', 'bytes')
        descriptor = dict(schema='harfang-web-mesh/1', byteOrder='little', primitive='triangles', stride=32,
            attributes=[dict(name='position', type='float32', components=3, offset=0), dict(name='normal', type='float32', components=3, offset=12), dict(name='uv0', type='float32', components=2, offset=24)],
            buffer=buffer_id, vertexCount=mesh['vertexCount'], indexCount=len(indices), indexType='uint32' if wide else 'uint16',
            indexOffset=len(vertices) * 4, submeshes=mesh['submeshes'], bounds=mesh['bounds'])
        self.meshes[name] = descriptor
        self.emit(name, (json.dumps(descriptor, indent=2) + '\n').encode(), 'mesh.json', 'mesh', [buffer_id], requires=['render.mesh'], sourceSHA256=hashlib.sha256(self.source(name).read_bytes()).hexdigest())

    def image(self, name):
        if name in self.assets:
            return
        data = self.source(name).read_bytes()
        width, height, mime = image_info(data)
        check(0 < width <= 4096 and 0 < height <= 4096, f'{name}: image exceeds W1 4096 pixel budget')
        self.emit(name, data, 'png' if mime == 'image/png' else 'jpg', 'image', width=width, height=height, mime=mime,
                  colorSpace='encoded-rgb', sampler={'filter': 'linear', 'wrap': 'repeat'}, requires=['assets.images'])

    def scene(self, name, structure=False):
        source = self.source(name); original = source.read_bytes(); data = original
        if not original.lstrip().startswith(b'{'):
            with tempfile.TemporaryDirectory(prefix='hg-scene-') as tmp:
                converted = Path(tmp) / 'scene.json'; self.native('scene-json', source, converted); data = converted.read_bytes()
        scene = json.loads(data, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'{name}: invalid number {value}')))
        validate_scene(scene, name, structure)
        dependencies = set()
        for obj in scene.get('objects', []):
            self.mesh(obj['name']); dependencies.add(obj['name'])
            check(all(part['material'] < len(obj['materials']) for part in self.meshes[obj['name']]['submeshes']), f'{name}: {obj["name"]} references a missing material slot')
            # Preserve all authored texture logical references for the structural
            # case, although its diagnostic renderer does not sample them.
            for mat in obj['materials']:
                for texture in mat.get('textures', []):
                    if texture.get('path'):
                        self.image(texture['path']); dependencies.add(texture['path'])
        self.emit(name, data, 'scene.json', 'scene-json', sorted(dependencies), requires=['scene.static'],
                  mode='structure' if structure else 'static', sourceSHA256=hashlib.sha256(original).hexdigest())
        self.reports.append(dict(scene=name, binaryConverted=data != original, sourceJSONUnchanged=data == original,
            mode='structure' if structure else 'static', nodeCount=len(scene.get('nodes', [])),
            adaptations=['PBR materials (including blending), lights, fog and probes retained as metadata; explicit opaque unlit diagnostic rendering only.'] if structure else []))


def compile_assets(roots, output, bridge, scenes, images=(), structure_scenes=(), references=()):
    output = output.resolve(); roots = [p.resolve() for p in roots]
    check(all(output != root and not output.is_relative_to(root) and not root.is_relative_to(output) for root in roots), 'Source and output directories must be separate')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='assetc-web-', dir=output.parent) as tmp:
        staging = Path(tmp); compiler = Compiler(roots, staging, bridge)
        for name in scenes:
            compiler.scene(name)
        for name in structure_scenes:
            compiler.scene(name, structure=True)
        for name in images:
            compiler.image(name)
        for name, path in references:
            compiler.emit(name, path.read_bytes(), 'json', 'bytes')
        manifest = dict(schema='harfang-web-assets/1', api='harfang-js/1', profile='web-static/1', compiler='assetc-web/1', assets=compiler.assets,
            buildId=hashlib.sha256(json.dumps(compiler.assets, sort_keys=True).encode()).hexdigest(), reports=compiler.reports,
            compilerSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), nativeBridgeSHA256=hashlib.sha256(bridge.read_bytes()).hexdigest())
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        (staging / '.harfang-web-output').write_text('assetc-web/1\n')
        if output.exists():
            check((output / '.harfang-web-output').is_file(), f'Refusing to replace unmarked output directory: {output}')
            # Fixed, resolved caller output; explicitly checked disjoint from every source root above.
            shutil.rmtree(output)
        shutil.copytree(staging, output)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mount', type=Path, action='append', default=[])
    parser.add_argument('--scene', action='append', default=[])
    parser.add_argument('--structure-scene', action='append', default=[])
    parser.add_argument('--image', action='append', default=[])
    parser.add_argument('--bridge', type=Path, default=ROOT / 'build/native/Release/harfang_web_asset_bridge.exe')
    args = parser.parse_args()
    try:
        result = compile_assets([args.source, *args.mount], args.output, args.bridge, args.scene, args.image, args.structure_scene)
        print(f'Compiled {len(result["assets"])} assets to {args.output}')
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'assetc-web: {error}\n')
