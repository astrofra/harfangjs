"""Extract literal binding symbols and tutorial classifications from the local specs.

This does not execute FABGen. Dynamic declarations are retained separately so the
inventory does not claim expansion of generator loops or overload signatures.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SUPPORTED = set('''Vec2 Vec3 Vec4 Color Mat4 Mat44 ColorI Deg Deg3 Dot Len Normalize Cross GetColumn GetT GetTranslation
TranslationMat4 ScaleMat4 RotationMat4 TransformationMat4 Inverse ComputeAspectRatioX FovToZoomFactor
ComputePerspectiveProjectionMatrix ComputeOrthographicProjectionMatrix ProjectToClipSpace ProjectToScreenSpace
time_from_ns time_to_ns time_from_sec time_from_ms time_to_sec time_to_ms time_to_sec_f time_to_ms_f time_from_sec_f time_from_sec_d
Scene Scene.CreateNode Scene.GetNode Scene.GetNodes Scene.GetNodeCount Scene.DestroyNode Scene.CreateTransform Scene.DestroyTransform
Node Node.IsValid Node.GetName Node.SetName Node.GetTransform Node.SetTransform
Transform Transform.IsValid Transform.GetPos Transform.SetPos Transform.GetRot Transform.SetRot Transform.GetScale Transform.SetScale
Transform.GetPosRot Transform.SetPosRot Transform.GetWorld VertexLayout VertexLayout.Begin VertexLayout.Add VertexLayout.End
Vertices Vertices.Clear Vertices.Begin Vertices.SetPos Vertices.SetColor0 Vertices.End'''.split())
SUPPORTED.update('''Transform.GetParent Transform.SetParent Transform.ClearParent Node.IsEnabled Node.IsItselfEnabled Node.Enable Node.Disable
Node.GetCamera Node.SetCamera Node.GetObject Node.SetObject Camera Camera.IsValid Camera.GetZNear Camera.GetZFar Camera.GetFov Camera.SetFov
Camera.GetSize Camera.SetSize Camera.GetIsOrthographic Scene.CreateCamera Scene.CreateOrthographicCamera Scene.GetCurrentCamera Scene.SetCurrentCamera
Scene.DestroyCamera Scene.DestroyObject Object.GetMaterialCount Object.GetMaterialName Object.SetMaterialName
CreateCubeModel CreatePlaneModel VertexLayoutPosFloatNormUInt8 Picture.GetWidth Picture.GetHeight'''.split())
APPROXIMATE = set('''DrawLines LoadProgramFromFile Keyboard Mouse ReadKeyboard ReadMouse Keyboard.Down Keyboard.Pressed Keyboard.Released
Mouse.X Mouse.Y Mouse.DtX Mouse.DtY Mouse.Wheel Mouse.Down Mouse.Pressed Mouse.Released'''.split())
APPROXIMATE.update('''DrawModel LoadSceneFromAssets LoadSceneFromFile LoadPicture LoadTextureFromAssets Scene.CreateObject Object.GetMaterial Object.GetModelRef'''.split())
SUPPORTED.update('''Light Light.IsValid Node.GetLight Node.SetLight Scene.CreateLight Scene.DestroyLight
Light.GetType Light.SetType Light.GetDiffuseColor Light.SetDiffuseColor Light.GetSpecularColor Light.SetSpecularColor
Light.GetDiffuseIntensity Light.SetDiffuseIntensity Light.GetSpecularIntensity Light.SetSpecularIntensity Light.GetRadius Light.SetRadius
Light.GetInnerAngle Light.SetInnerAngle Light.GetOuterAngle Light.SetOuterAngle Light.GetPriority Light.SetPriority'''.split())
APPROXIMATE.update('''Material SetMaterialValue SetMaterialTexture GetMaterialTexture UpdateMaterialPipelineProgramVariant
SetMaterialBlendMode SetMaterialDepthTest SetMaterialFaceCulling SetMaterialWriteZ SetMaterialWriteRGBA SetMaterialAlphaCut'''.split())


def extract(source):
    binding = source / 'binding/bind_harfang.py'
    data = binding.read_text(encoding='utf-8')
    tree = ast.parse(data)
    classes = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Attribute) and call.func.attr == 'begin_class' and call.args and isinstance(call.args[0], ast.Constant):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        classes[target.id] = call.args[0].value.removeprefix('hg::').removeprefix('bgfx::')
    symbols, dynamic = {}, []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        method = node.func.attr
        if method not in {'begin_class', 'bind_function', 'bind_function_overloads', 'bind_method', 'bind_method_overloads'}:
            continue
        idx = 1 if method.startswith('bind_method') else 0
        if len(node.args) <= idx:
            continue
        name_node = next((k.value for k in node.keywords if k.arg == 'bound_name'), node.args[idx])
        if not isinstance(name_node, ast.Constant) or not isinstance(name_node.value, str):
            dynamic.append(dict(line=node.lineno, expression=ast.get_source_segment(data, node), classification='unsupported'))
            continue
        name = name_node.value.removeprefix('hg::').removeprefix('bgfx::')
        if idx:
            variable = node.args[0].id if isinstance(node.args[0], ast.Name) else ''
            name = f'{classes.get(variable, variable)}.{name}'
        classification = 'portable' if name in SUPPORTED else 'approximation' if name in APPROXIMATE else 'unsupported'
        if classification == 'unsupported' and re.search(r'Lua|Squirrel|ImGui|Window|Monitor|OpenFile|Directory|Process|Plugin', name):
            classification = 'native-only'
        record = symbols.setdefault(name, dict(symbol=name, classification=classification, lines=[]))
        record['lines'].append(node.lineno)
        if classification == 'portable':
            record['scope'] = 'Only documented W0/W1/W2 overloads; native JS pending N'
        elif classification == 'approximation':
            record['scope'] = 'Context service adaptation; not exported as an unchanged native function'
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    result = dict(source='harfang3d/binding/bind_harfang.py', sourceRevision=revision,
                  sourceSHA256=hashlib.sha256(binding.read_bytes()).hexdigest(),
                  extraction='Literal class/function/method names; dynamic declarations listed unexpanded. Constants, constructors, operators and members are described in docs/contract.md.',
                  symbols=sorted(symbols.values(), key=lambda r: r['symbol']), dynamicDeclarations=dynamic)
    (ROOT / 'contract').mkdir(exist_ok=True)
    (ROOT / 'contract/binding-inventory.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\r\n')
    shader_root = source / 'tutorials/resources/core/shader'
    names = [f'{family}{suffix}' for family in ('default','pbr') for suffix in ('.hps','_vs.sc','_fs.sc','_varying.def')] + ['forward_pipeline.sh','bgfx_shader.sh']
    adapters = dict(sourceRevision=revision, source='harfang3d/tutorials/resources/core/shader',
        sha256={name:hashlib.sha256((shader_root/name).read_bytes()).hexdigest() for name in names},
        contract='src/render/material-contract.js', implementation='src/render/forward-shaders.js',
        fixture='tools/generate_lighting_fixture.py',tests='tests/lighting-suite.js',
        maxForwardPrograms=2, logicalVariants=dict(default=2,pbr=32,unlit=4),
        adaptations=['Ambient-only environment; required probes/shadows need explicit compiler approval.',
            'PBR native comparison descriptor enables existing alpha-cut shader branch; unneeded skinning variants omitted.',
            'PBR native comparison uses RAW base-level bilinear texture sampling, matching W2.',
            'Equal-priority lights retain scene node order; undefined arithmetic gets finite guards.'],
        nativeJavaScript='pending-slice-N')
    (ROOT / 'contract/shader-adapters.json').write_text(json.dumps(adapters,indent=2)+'\n',encoding='utf-8',newline='\r\n')
    return revision


def tutorials(source, revision):
    spec = (source / 'specifications/SPECS_HYBRID_CPP_JS_WEBGL_TUTORIAL_VALIDATION.md').read_text(encoding='utf-8')
    rows, classification = [], None
    w0 = {'basic_loop', 'input_read_keyboard_basic', 'input_read_keyboard_advanced', 'input_read_mouse_basic',
          'input_read_mouse_advanced', 'draw_lines', 'draw_lines_starfield', 'scene_lua_script'}
    w1 = {'draw_model_no_pipeline','render_resize_to_window','filesystem_assets','picture_load'}
    for line in spec.splitlines():
        for section, label in [('## 3.', 'retained'), ('## 4.', 'deferred'), ('## 5.', 'excluded')]:
            if line.startswith(section): classification = label
        if line.startswith('## 6.'): break
        match = re.match(r'\| \[([^]]+)\]\(\.\./tutorials/([^)]*)\) \| (.*)', line)
        if not match or not classification: continue
        family, filename, description = match.groups()
        case_id = 'scene_lua_script.js' if family == 'scene_lua_script' else family
        ported = family in w0 | w1
        rows.append(dict(sourceFamily=family, sourceRevision=revision,
            sourceSHA256=hashlib.sha256((source / 'tutorials' / filename).read_bytes()).hexdigest(),
            caseId=case_id, classification=classification, slice='W1' if family in w1 else 'C/W0' if ported else description.split('|')[0].strip(),
            requires=['render.mesh', 'assets.images'] if family in w1 else ['render.lines'] if ported else [],
            adaptations=['Scheduled lifecycle; canvas-scoped input; context renderer; no native busy loop.'] if ported else [],
            assetRecipe='tools/build_assets.py; compiled pictures/owl.jpg for image cases; reviewed mdl adapter for fixed cube/plane.' if family in w1 else 'Built-in reviewed line programs and static behavior module; no scene assets.' if ported else 'Pending applicable slice.',
            seed=1337 if family == 'draw_lines_starfield' else None,
            checkpoints=[0, 16, 32, 48] if ported else [], assertions=description.rstrip(' |'),
            visualTolerance='Feature/pixel-region checks; no pixel parity claim.' if ported else None,
            executionStatus={'nativeOriginal': 'not-run', 'nativeJS': 'not-ported', 'browser': 'not-run' if ported else 'not-ported'}))
        if family == 'scene_light_priority':
            rows[-1].update(slice='W2',requires=['render.forward','material.default','scene.lights'],
                adaptations=['Original 16-light trajectories/distance priorities; compiled shared spheres; scheduled lifecycle.'],
                assetRecipe='tools/build_assets.py; native priority selection at 48/1048/2048 ms.',
                checkpoints=[0,16,32,48,1048,2048],visualTolerance='Numeric native slot selection and deterministic appearance capture.',
                executionStatus={'nativeOriginal':'not-run','nativeJS':'not-ported','browser':'not-run'})
    assert len(rows) == 56, len(rows)
    counts = {key: sum(row['classification'] == key for row in rows) for key in ['retained', 'deferred', 'excluded']}
    assert counts == {'retained': 25, 'deferred': 12, 'excluded': 19}, counts
    rows.append(dict(sourceFamily='render_resize_to_window', sourceRevision=revision, caseId='render_resize_to_window.lines',
        classification='retained-derivative', slice='W0', requires=['render.lines', 'math.foundation'],
        adaptations=['Replace W1 models with dynamic lines; verify orthographic aspect and drawing-buffer resize.'],
        assetRecipe='No source asset access.', seed=None, checkpoints=[0, 16, 32, 48],
        assertions='Canvas resize updates projection and dimensions.', visualTolerance='Aspect/numeric checks.',
        executionStatus={'nativeOriginal': 'not-run', 'nativeJS': 'not-ported', 'browser': 'not-run'}))
    for case_id, source_family in [('scene_pbr.structure','scene_pbr'), ('scene_static_room',None)]:
        rows.append(dict(sourceFamily=source_family, sourceRevision=revision, caseId=case_id,
            classification='retained-derivative' if source_family else 'supplemental-fixture', slice='W1',
            requires=['scene.static','scene.hierarchy','scene.camera','render.mesh','material.unlit','assets.images'],
            adaptations=['Original JSON and assignments preserved; explicit opaque unlit diagnostic colors; no PBR/light/environment rendering.'] if source_family else [],
            assetRecipe='tools/build_assets.py: shared native/web assets and native scene-state references.',
            seed=None, checkpoints=[0,16,32,48],
            assertions='Native hierarchy, transforms, camera, material assignment and cleanup; room also compares native rendered views.',
            visualTolerance='Room: channel MAE < 2/255 and < 3% pixels with any channel error > 16/255. PBR structure: no appearance parity claim.',
            executionStatus={'nativeOriginal':'not-run','nativeJS':'not-ported','browser':'not-run'}))
    for case_id, family, adaptations in [
        ('material_lighting',None,['Supplemental W2 controllable material/light gallery; no shadows/probes.']),
        ('scene_pbr.materials','scene_pbr',['Original scene JSON/maps; explicit ambient/no-shadow adaptation; initial base-level bilinear sampling.']),
        ('material_update_value.no_shadows','material_update_value',['Original one-second diffuse-map toggle; no spot shadows; explicit specular width 1.']),
        ('scene_many_nodes.small.no_shadows','scene_many_nodes',['11x11 correctness grid, adjusted camera, compiled shared spheres; no shadows.']),
        ('scene_many_nodes.stress','scene_many_nodes',['Original 101x101 workload retained as a separate pending W10 stress gate.'])]:
        pending = case_id.endswith('.stress')
        rows.append(dict(sourceFamily=family,sourceRevision=revision,caseId=case_id,
            classification='retained-derivative' if family else 'supplemental-fixture',slice='W10' if pending else 'W2',
            requires=['render.forward','scene.lights'],adaptations=adaptations,
            assetRecipe='tools/build_assets.py; explicit native/web fixture adaptations in shader-provenance.json.',
            checkpoints=[] if pending else [0,16,32,48],seed=None,
            assertions='Material maps/states, shader equations, native images, lifetime and bounded programs; per-case checks in tests/lighting-suite.js.',
            visualTolerance='Gallery/PBR: RGB MAE < 2/255; fewer than 3% pixels over 16/255. Adapted native reference, not original full lighting.',
            executionStatus={'nativeOriginal':'not-run','nativeJS':'not-ported','browser':'not-ported' if pending else 'not-run'}))
    (ROOT / 'contract/tutorials.json').write_text(json.dumps(dict(familyCounts=counts, cases=rows), indent=2) + '\n', encoding='utf-8', newline='\r\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'harfang3d')
    args = parser.parse_args()
    revision = extract(args.source)
    tutorials(args.source, revision)
    print('Generated binding and 56-family tutorial inventories; execution remains separately reported.')
