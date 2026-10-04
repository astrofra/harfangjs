"""Deterministic authored W1 fixture; generated native input stays under build/."""
import json
from pathlib import Path
import struct
import subprocess
import zlib


def write_json(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2) + '\n', encoding='utf-8')


def png(width, height, colors=None):
    # Four asymmetric quadrants make UV seams/orientation observable.
    colors = colors or ((240, 65, 45), (40, 205, 95), (35, 95, 235), (240, 195, 40))
    raw = b''.join(b'\0' + b''.join(bytes(colors[(x >= width // 2) + 2 * (y >= height // 2)])
                                  for x in range(width)) for y in range(height))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def generate(root: Path, bridge: Path, native_resources: Path):
    root.mkdir(parents=True, exist_ok=True)
    geometry = dict(positions=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
                               [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
        polygons=[dict(indices=face, material=i % 2, uv=[[0,1],[1,1],[1,0],[0,0]]) for i, face in
                  enumerate([[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]])])
    recipe = root.parent / 'cube.recipe.json'; write_json(recipe, geometry)
    (root / 'models').mkdir(exist_ok=True)
    subprocess.run([str(bridge), 'create-geometry', str(recipe), str(root / 'models/seamed-cube.geo')], check=True, capture_output=True)
    (root / 'pictures').mkdir(exist_ok=True)
    (root / 'pictures/quadrants.png').write_bytes(png(64, 32))
    (root / 'pictures/white.png').write_bytes(png(1, 1, [(255,255,255)] * 4))
    def mat(color, texture=False):
        return dict(program='shaders/unlit.hps', values=[dict(name='uColor', type='vec4', value=color)],
                    textures=[dict(name='uColorMap', path='pictures/quadrants.png' if texture else 'pictures/white.png', stage=0)],
                    face_culling='disabled', depth_test='less', blend_mode='opaque', flags=[])
    transforms, nodes, objects = [], [], []
    def node(idx, name, pos, rot=(0,0,0), scale=(1,1,1), parent=None, camera=None, materials=None, disabled=False):
        t = len(transforms); transforms.append(dict(pos=list(pos), rot=list(rot), scl=list(scale), parent=parent))
        obj = None
        if materials:
            obj = len(objects)
            objects.append(dict(name='models/seamed-cube.geo', materials=materials,
                                material_infos=[dict(name=f'{name} slot {i}') for i in range(len(materials))], bones=[]))
        nodes.append(dict(idx=idx, name=name, disabled=disabled, components=[t,camera,obj,None,None]))
    gray = [mat([.28,.34,.40,1]), mat([.36,.43,.50,1])]
    node(40, 'Floor', (0,-.15,1), scale=(7,.3,7), materials=gray)
    node(90, 'Back wall', (0,1.6,4.35), scale=(7,3.5,.3), materials=gray)
    node(7, 'Perspective', (4,3,-7), rot=(13,-25,0), camera=0)
    node(111, 'Orthographic', (0,5,-7), rot=(22,0,0), camera=1)
    node(52, 'Parented prop', (.8,.65,0), rot=(10,25,5), scale=(.9,1.2,.75), parent=23,
         materials=[mat([1,1,1,1], True), mat([.85,.3,.12,1])])
    node(23, 'Prop group', (-1.3,.25,1.2), rot=(0,22,0), scale=(1.2,1,.85))
    node(71, 'Negative scale', (1.6,.7,1.8), rot=(0,-20,0), scale=(-1.2,1.4,1),
         materials=[mat([.15,.7,.85,1]), mat([.9,.7,.15,1])])
    node(13, 'Disabled prop', (0,2,0), materials=[mat([1,0,1,1]), mat([1,0,1,1])], disabled=True)
    body = dict(nodes=nodes, transforms=transforms, objects=objects,
                cameras=[dict(zrange=dict(znear=.1,zfar=100), fov=0.7853981633974483, ortho=False, size=1),
                         dict(zrange=dict(znear=.1,zfar=100), fov=0.7853981633974483, ortho=True, size=8)],
                canvas=dict(clear_color=True,clear_z=True,color=[16,22,32,255]),
                environment=dict(current_camera=7, ambient=[0,0,0,0], fog_color=[0,0,0,0], fog_near=0, fog_far=0),
                key_values={'fixture':'W1 static room', 'units':'meters'})
    write_json(root / 'scenes/room.scn', body)
    shaders = root / 'shaders'; shaders.mkdir(exist_ok=True)
    (shaders / 'unlit.hps').write_text('{"features":[]}\n', encoding='utf-8')
    (shaders / 'unlit_vs.sc').write_text('''$input a_position, a_texcoord0
$output vUV
#include <bgfx_shader.sh>
void main() { vUV = a_texcoord0; gl_Position = mul(u_modelViewProj, vec4(a_position, 1.0)); }
''', encoding='utf-8')
    (shaders / 'unlit_fs.sc').write_text('''$input vUV
#include <bgfx_shader.sh>
uniform vec4 uColor;
SAMPLER2D(uColorMap, 0);
void main() {
  vec4 color = uColor;
  color *= texture2D(uColorMap, vUV);
  gl_FragColor = color;
}
''', encoding='utf-8')
    (shaders / 'unlit_varying.def').write_text('vec3 a_position : POSITION;\nvec2 a_texcoord0 : TEXCOORD0;\nvec2 vUV : TEXCOORD0;\n', encoding='utf-8')
    (shaders / 'bgfx_shader.sh').write_bytes((native_resources / 'shaders/bgfx_shader.sh').read_bytes())
    return body
