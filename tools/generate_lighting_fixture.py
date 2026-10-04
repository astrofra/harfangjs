"""W2 authored fixtures and native shader inputs; never shipped as runtime sources."""
import copy
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import zlib

from generate_fixture import write_json, png


def material(family='pbr', color=(.55,.22,.08,1), rough=.4, metal=0, self_color=(0,0,0,0), textures=(), **state):
    values = {'uBaseOpacityColor':list(color), 'uOcclusionRoughnessMetalnessColor':[1,rough,metal,0], 'uSelfColor':list(self_color)} if family == 'pbr' else {
        'uDiffuseColor':list(color), 'uSpecularColor':[.5,.5,.5,1], 'uSelfColor':list(self_color)}
    return dict(program=f'core/shader/{family}.hps', values=[dict(name=k,type='vec4',value=v) for k,v in values.items()],
                textures=[dict(name=n,path=p,stage=s) for n,p,s in textures], flags=[], face_culling='disabled', **state)


class Fixture:
    def __init__(self, name):
        self.body = dict(nodes=[],transforms=[],objects=[],cameras=[],lights=[],
            canvas=dict(clear_color=True,clear_z=True,color=[16,22,32,255]),
            environment=dict(ambient=[8,8,8,255],fog_near=0,fog_far=0,fog_color=[16,22,32,255]),key_values={'fixture':name})

    def node(self, name, pos=(0,0,0), rot=(0,0,0), scale=(1,1,1), model=None, mat=None, camera=None, light=None):
        b = self.body; idx = len(b['nodes']); components = [len(b['transforms']),None,None,None,None]
        b['transforms'].append(dict(pos=list(pos),rot=list(rot),scl=list(scale),parent=None))
        if model:
            components[2] = len(b['objects']); b['objects'].append(dict(name=model, materials=mat if isinstance(mat,list) else [mat],bones=[]))
        if camera:
            components[1] = len(b['cameras']); b['cameras'].append(camera); b['environment']['current_camera'] = idx
        if light:
            components[3] = len(b['lights']); b['lights'].append(light)
        b['nodes'].append(dict(idx=idx,name=name,disabled=False,components=components))
        return idx


def light(kind='linear', color=(255,245,230,255), specular=(255,255,255,255), radius=0, priority=0, **extra):
    return dict(type=kind,diffuse=list(color),specular=list(specular),diffuse_intensity=.7,specular_intensity=.45,
        radius=radius,inner_angle=math.radians(15),outer_angle=math.radians(40),priority=priority,shadow_type='none',**extra)


def generate_lighting(root, bridge, resources):
    for name in ('materials/sphere.geo','materials/plane.geo','textures/squares.png'):
        path = root / name; path.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(resources / name,path)
    recipe = root.parent / 'quad.recipe.json'
    write_json(recipe,dict(positions=[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],
        polygons=[dict(indices=[0,1,2,3],uv=[[0,1],[1,1],[1,0],[0,0]])],tangents=True))
    subprocess.run([str(bridge),'create-geometry',str(recipe),str(root/'models/tangent-quad.geo')],check=True,capture_output=True)
    # PNGs preserve encoded channels. Native assetc's default RAW texture path avoids compression error.
    (root/'pictures/normal.png').write_bytes(png(32,32,[(185,128,240),(128,185,240),(70,128,240),(128,70,240)]))
    (root/'pictures/orm.png').write_bytes(png(32,32,[(255,45,0),(255,200,0),(255,45,255),(96,200,255)]))
    (root/'pictures/self.png').write_bytes(png(32,32,[(80,10,0),(0,80,10),(0,10,80),(60,25,0)]))
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data))
    raw = b''.join(b'\0'+b''.join(bytes((50,190,65,255 if ((x-16)**2/180+(y-16)**2/225 < 1 and (x+y)%8 < 6) else 0)) for x in range(32)) for y in range(32))
    (root/'pictures/foliage.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',32,32,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
    f = Fixture('W2 material gallery: native default/PBR, normal, ORM, cutout, emissive and transparency')
    f.node('Camera',(0,0,-11),camera=dict(zrange=dict(znear=.1,zfar=100),fov=math.radians(40),ortho=True,size=7))
    for i,(metal,rough) in enumerate([(0,.15),(0,.8),(1,.15),(1,.8)]):
        f.node(f'Sphere {i}',(-2.4+i*1.6,1.9,0),scale=(1.3,1.3,1.3),model='materials/sphere.geo',mat=material(rough=rough,metal=metal))
    f.node('Phong',(-2.4,.1,0),scale=(1.3,1.3,1.3),model='materials/sphere.geo',mat=material('default',textures=[('uDiffuseMap','pictures/quadrants.png',0)]))
    f.node('Normal mapped',(-.8,.1,0),rot=(12,15,18),scale=(-.6,.8,.5),model='models/tangent-quad.geo',mat=material(textures=[('uNormalMap','pictures/normal.png',2)]))
    f.node('ORM',( .8,.1,0),scale=(.6,.6,.6),model='models/tangent-quad.geo',mat=material(textures=[('uOcclusionRoughnessMetalnessMap','pictures/orm.png',1)]))
    cut = material(textures=[('uBaseOpacityMap','pictures/foliage.png',0)]); cut['flags']=['EnableAlphaCut']
    f.node('Foliage',(2.4,.1,0),scale=(.7,.7,.7),model='models/tangent-quad.geo',mat=cut)
    f.node('Emissive',(-2.4,-1.9,0),scale=(.65,.65,.65),model='models/tangent-quad.geo',mat=material(textures=[('uSelfMap','pictures/self.png',4)]))
    # Deliberately author near first: native/web must sort by depth, not insertion order.
    for name,pos,color in [('Near',(-.45,-1.9,-.3),(.8,.08,.02,.45)),('Far',(-.9,-1.7,.3),(.04,.12,.8,.6))]:
        f.node(name,pos,scale=(.65,.65,.65),model='models/tangent-quad.geo',mat=material(color=color,blend_mode='alpha',write_z=False))
    f.node('Self uniform',(1.5,-1.9,0),scale=(1.3,1.3,1.3),model='materials/sphere.geo',mat=material(self_color=(.1,.02,.25,0)))
    f.node('Sun',rot=(15,-25,0),light=light())
    f.node('Red point',(-3,1,-2),light=light('point',(255,50,20,255),radius=7,priority=3))
    f.node('Blue point',(3,1,-2),light=light('point',(25,80,255,255),radius=7,priority=2))
    f.node('Spot',(0,2,-4),rot=(20,0,0),light=light('spot',(90,255,110,255),radius=10,priority=1))
    write_json(root/'scenes/lighting.scn',f.body)
    fog = copy.deepcopy(f.body); fog['environment'].update(fog_near=9,fog_far=14)
    write_json(root/'scenes/lighting-fog.scn',fog)
    # Keep the tutorial scene byte-for-byte in the web manifest; native capture uses
    # a separately named derivative with the same explicitly approved adaptations.
    pbr = json.loads((resources/'materials/materials.scn').read_bytes())
    for obj in pbr['objects']:
        for mat in obj['materials']:
            for texture in mat.get('textures',[]):
                if texture.get('path'):
                    path = root/texture['path']; path.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(resources/texture['path'],path)
                    # Match the declared W1/W2 encoded-RGB, base-level linear sampler.
                    # W4 adds authored mip/compression/anisotropy routes separately.
                    write_json(path.with_name(path.name+'.meta'),{'profiles':{'default':{'compression':'RAW','generate-mips':False,'type':'Standard'}}})
    for item in pbr['lights']:
        item['shadow_type']='none'
    for key in ('brdf_map','irradiance_map','radiance_map'):
        pbr['environment'].pop(key,None)
    write_json(root/'scenes/pbr-ambient.scn',pbr)
    # Compile the reviewed native shader bodies, with alpha cut exposed in the
    # fixture descriptor (the original PBR body already implements this branch).
    shaders = root/'core/shader'; shaders.mkdir(parents=True,exist_ok=True)
    originals = resources/'core/shader'; hashes = {}
    names = [p.name for p in originals.glob('*.sh')] + [f'{family}{suffix}' for family in ('default','pbr') for suffix in ('.hps','_vs.sc','_fs.sc','_varying.def')]
    for name in names:
        data = (originals/name).read_bytes(); hashes[name]=hashlib.sha256(data).hexdigest(); (shaders/name).write_bytes(data)
    reviewed = json.loads((Path(__file__).resolve().parents[1]/'contract/shader-adapters.json').read_text())
    for name,digest in reviewed['sha256'].items():
        if hashes[name] != digest:
            raise ValueError(f'Native shader {name} changed: review the adapters before updating contract/shader-adapters.json')
    write_json(shaders/'default.hps',dict(features=['OptionalDiffuseMap']))
    write_json(shaders/'pbr.hps',dict(features=['OptionalBaseColorOpacityMap','OptionalOcclusionRoughnessMetalnessMap','OptionalNormalMap','OptionalSelfMap','OptionalAlphaCut']))
    provenance = dict(source='harfang3d/tutorials/resources/core/shader',sha256=hashes,
        nativeFixtureAdaptations=['Remove unneeded OptionalSkinning variants.', 'Expose existing PBR ENABLE_ALPHA_CUT branch through OptionalAlphaCut.',
            'PBR tutorial comparison uses RAW base-level bilinear textures, matching the W1/W2 web sampler; native authored BC/anisotropy/mips are deferred to W4.'],
        webEnvironment='ambient-only; no irradiance/radiance/BRDF probe sampling')
    write_json(root.parent/'shader-provenance.json',provenance)
    return provenance
