import * as hg from 'harfang';
import {validateSceneJSON} from '../src/scene/schema.js';
import {decodeMesh} from '../src/render/models.js';
import {createStaticApplication, staticCases} from '../examples/tutorials/static-application.js';

export function registerStaticTests({test, assert, equal, near, throws, rejects, scheduler}) {
  const baseURL = new URL('../assets-web/', import.meta.url).href;
  let manifest;
  const options = async extra => ({manifest: manifest ??= await (await fetch(new URL('manifest.json', baseURL))).json(), baseURL, ...extra});
  const json = async (assets, id) => { const lease = await assets.acquire(id); try { return JSON.parse(lease.text()); } finally { lease.dispose(); } };
  const empty = assets => { for (const [key, count] of Object.entries(assets.stats)) assert(count === 0, `${key}: ${count} remaining`); };
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = 256; document.body.append(c); return c; };
  function compare(scene, reference) {
    assert(scene.GetNodeCount() === BigInt(reference.nodes.length));
    equal(scene.GetCurrentCamera().GetName(), reference.currentCamera);
    for (const [i, expected] of reference.nodes.entries()) {
      const node = scene.GetNodes()[i]; assert(node.IsValid()); equal(node.GetName(), expected.name); equal(node.IsEnabled(), expected.enabled);
      if (expected.world) near([...node.GetTransform().GetWorld().data], expected.world, 0.0001);
      if (expected.parent !== undefined) {
        const parent = node.GetTransform().GetParent(); equal(parent.IsValid() ? parent.GetName() : '', expected.parent);
      }
      if (expected.camera) {
        const camera = node.GetCamera(); equal(camera.GetIsOrthographic(), expected.camera.ortho);
        near([camera.GetZNear(), camera.GetZFar(), camera.GetSize()], [expected.camera.near,expected.camera.far,expected.camera.size]);
        near([camera.GetFov()], [expected.camera.fov]);
      }
      if (expected.materials) {
        const object = node.GetObject(); assert(object.GetMaterialCount() === BigInt(expected.materials.length));
        for (const [slot, mat] of expected.materials.entries()) {
          const source = object.GetMaterial(slot).source;
          equal(object.GetMaterialName(slot), expected.materialNames[slot]); equal(source.program, mat.program);
          for (const uniform of mat.values ?? []) near(source.values.find(v => v.name === uniform.name).value, uniform.value);
          for (const texture of mat.textures ?? []) {
            const found = source.textures.find(t => t.name === texture.name); equal(found.path, texture.path); equal(found.stage, texture.stage);
          }
        }
      }
    }
  }

  test('W1: unchanged native JSON, binary conversion and native compiled room agree', async () => {
    const assets = new hg.StaticAssets(await options());
    try {
      const reference = await json(assets, 'references/room-native.json');
      const compiled = await json(assets, 'references/room-compiled-native.json');
      const body = await json(assets, 'scenes/room.scn');
      const entry = assets.describe('scenes/room.scn'); assert(entry.sha256 === entry.sourceSHA256);
      for (const scene of [await assets.loadScene('scenes/room.scn'), await assets.loadScene('scenes/room-binary.scn'), await assets.loadSceneJSON(body)]) {
        compare(scene, reference); compare(scene, compiled);
        equal(scene.stats, {nodes:8, transforms:8, cameras:2, objects:5, lights:0});
        const prop = scene.GetNode('Parented prop'), object = prop.GetObject();
        equal(prop.GetTransform().GetParent().GetName(), 'Prop group');
        assert(scene.GetNode('Negative scale').GetTransform().GetScale().x < 0);
        assert(!scene.GetNode('Disabled prop').IsEnabled());
        assert(object.GetMaterialCount() === 2n && object.GetModelRef().vertexCount === 24 && object.GetModelRef().indexCount === 36);
        equal(object.GetModelRef().submeshes.map(s => s.material), [0,1]);
        equal(object.GetModelRef().bounds, {min:[-.5,-.5,-.5],max:[.5,.5,.5]});
        equal(object.GetMaterialName(0), 'Parented prop slot 0');
        equal(scene.metadata.key_values.units, 'meters');
        scene.SetCurrentCamera(scene.GetNode('Orthographic')); assert(scene.GetCurrentCamera().GetCamera().GetIsOrthographic());
        assert(scene.ComputeCurrentCameraViewState(new hg.Vec2(1,1)).proj instanceof hg.Mat44);
        scene.dispose(); assert(!prop.IsValid() && !object.IsValid());
      }
      empty(assets);
    } finally { assets.dispose(); }
  });

  test('W1: hierarchy cycles, foreign parents, local enabled state and dead parent references', () => {
    const scene = new hg.Scene(), other = new hg.Scene();
    const a = scene.CreateNode('a'), b = scene.CreateNode('b'), foreign = other.CreateNode();
    a.SetTransform(scene.CreateTransform(new hg.Vec3(1,2,3))); b.SetTransform(scene.CreateTransform(new hg.Vec3(4,0,0)));
    b.GetTransform().SetParent(a); near([...hg.GetT(b.GetTransform().GetWorld()).data], [5,2,3]);
    throws(() => a.GetTransform().SetParent(b), 'HIERARCHY_CYCLE');
    throws(() => b.GetTransform().SetParent(foreign), 'INVALID_HANDLE');
    a.Disable(); assert(b.IsEnabled()); // ordinary parenting does not inherit native disabled state
    scene.DestroyNode(a); assert(!b.GetTransform().GetParent().IsValid());
    near([...hg.GetT(b.GetTransform().GetWorld()).data], [4,0,0]); scene.dispose(); other.dispose();
  });

  test('W1: required instances, animation, skinning, physics, video and custom programs reject', async () => {
    const assets = new hg.StaticAssets(await options()), body = await json(assets, 'scenes/room.scn');
    for (const field of ['instances','anims','scene_anims','rigid_bodies','collisions','scripts','videos']) {
      const invalid = structuredClone(body); invalid[field] = [{}];
      await rejects(assets.loadSceneJSON(invalid), 'UNSUPPORTED_SCENE_FEATURE'); empty(assets);
    }
    const skinned = structuredClone(body); skinned.objects[0].bones = [0];
    await rejects(assets.loadSceneJSON(skinned), 'UNSUPPORTED_SCENE_FEATURE');
    const custom = structuredClone(body); custom.objects[0].materials[0].program = 'custom.hps';
    await rejects(assets.loadSceneJSON(custom), 'UNSUPPORTED_PROGRAM');
    const cycle = structuredClone(body); cycle.transforms[5].parent = 52;
    throws(() => validateSceneJSON(cycle), 'INVALID_SCENE');
    await rejects(assets.loadScene('materials/materials.scn'), 'UNSUPPORTED_SCENE_FEATURE');
    empty(assets); assets.dispose();
  });

  test('W1: malformed mesh index, bounds, truncation and schema reject before upload', async () => {
    const assets = new hg.StaticAssets(await options()), descriptor = await json(assets, 'models/seamed-cube.geo');
    const lease = await assets.acquire(descriptor.buffer), bytes = lease.bytes(); lease.dispose();
    const bad = bytes.slice(0); new DataView(bad).setUint16(descriptor.indexOffset, 60000, true);
    throws(() => decodeMesh(descriptor, bad), 'INVALID_MESH');
    throws(() => decodeMesh(descriptor, bytes.slice(0, -1)), 'INVALID_MESH');
    throws(() => decodeMesh({...descriptor, bounds:{min:[0,0,0],max:[1,1,1]}}, bytes), 'INVALID_MESH');
    throws(() => decodeMesh({...descriptor, byteOrder:'big'}, bytes), 'INVALID_MESH');
    empty(assets); assets.dispose();
  });

  test('W1: missing, corrupt and undeclared dependencies roll back loaded models and images', async () => {
    const original = await options();
    for (const mode of ['missing-image','bad-hash','bad-image','missing-mesh','bad-slot','undeclared']) {
      const custom = structuredClone(original.manifest);
      const id = 'pictures/quadrants.png', badURI = custom.assets[id].uri;
      const badBytes = new Uint8Array(custom.assets[id].byteLength);
      if (mode === 'bad-hash') custom.assets[id].sha256 = '0'.repeat(64);
      if (mode === 'bad-image') custom.assets[id].sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',badBytes))].map(n => n.toString(16).padStart(2,'0')).join('');
      if (mode === 'undeclared') custom.assets['scenes/room.scn'].dependencies = [];
      const assets = new hg.StaticAssets({...original, manifest:custom, fetch: (url, opts) => {
        if (url.href.endsWith(badURI) && mode === 'missing-image') return Promise.resolve(new Response('', {status:404}));
        if (url.href.endsWith(badURI) && mode === 'bad-image') return Promise.resolve(new Response(badBytes));
        return fetch(url, opts);
      }});
      try {
        const body = await json(assets, 'scenes/room.scn');
        if (mode === 'missing-mesh') body.objects[2].name = 'models/missing.geo';
        if (mode === 'bad-slot') body.objects[2].materials.length = 1;
        const error = await rejects(mode === 'undeclared' ? assets.loadScene('scenes/room.scn') : assets.loadSceneJSON(body, {source:'scenes/room.scn'}));
        assert(error.message.includes('scenes/room.scn'));
        if (['missing-image','bad-hash','bad-image'].includes(mode)) assert(error.message.includes(id));
        empty(assets);
      } finally { assets.dispose(); }
    }
  });

  test('W1: cancellation during a dependent image request rolls back the scene transaction', async () => {
    const original = await options(), controller = new AbortController(); let reached;
    const fetching = new Promise(resolve => { reached = resolve; });
    const assets = new hg.StaticAssets({...original, fetch: async (url, opts) => {
      if (url.href.endsWith(original.manifest.assets['pictures/quadrants.png'].uri)) {
        reached(); return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true}));
      }
      return fetch(url, opts);
    }});
    const pending = assets.loadScene('scenes/room.scn', {signal:controller.signal});
    await fetching; assert(assets.stats.models === 1 && assets.stats.pictures === 1);
    const rejected = rejects(pending, 'CANCELLED'); controller.abort(); await rejected; empty(assets); assets.dispose();
  });

  test('W1: PNG/JPEG dimensions and sampled texture orientation are preserved', async () => {
    const c = canvas(), renderer = new hg.StaticRenderer(c), assets = new hg.StaticAssets(await options({renderer}));
    let mesh;
    try {
      const owl = await assets.loadPicture('pictures/owl.jpg');
      equal([owl.GetWidth(),owl.GetHeight()], [assets.describe('pictures/owl.jpg').width,assets.describe('pictures/owl.jpg').height]); owl.dispose();
      const [picture, info] = await assets.loadTexture('pictures/quadrants.png'); equal(info, {width:64,height:32});
      mesh = new hg.Model(new Float32Array([-1,-1,0, 0,0,1, 0,1, 1,-1,0, 0,0,1, 1,1,
        1,1,0, 0,0,1, 1,0, -1,1,0, 0,0,1, 0,0]), new Uint16Array([0,1,2,0,2,3]), [{material:0,firstIndex:0,indexCount:6}]);
      const mat = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled'},picture);
      renderer.beginFrame(); renderer.drawModel(mesh,'shaders/unlit.hps',hg.Mat4.Identity,hg.Mat44.Identity,[mat]);
      const gl = c.getContext('webgl2'), pixel = new Uint8Array(4);
      for (const [x,y,color] of [[64,192,[240,65,45]], [192,192,[40,205,95]], [64,64,[35,95,235]], [192,64,[240,195,40]]]) {
        gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel); near([...pixel.slice(0,3)],color,1);
      }
      assert(gl.getError() === gl.NO_ERROR); picture.dispose(); mesh.dispose(); empty(assets);
      assert(renderer.stats.gpuStaticBytes === 0);
    } finally { mesh?.dispose(); assets.dispose(); renderer.dispose(); c.remove(); }
  });

  test('W1: scene GPU resources return to zero over repeated unload/reload and camera switches', async () => {
    const c = canvas(), renderer = new hg.StaticRenderer(c), assets = new hg.StaticAssets(await options({renderer}));
    try {
      for (let i = 0; i < 4; ++i) {
        const scene = await assets.loadScene('scenes/room.scn');
        renderer.submit(scene); assert(renderer.stats.triangles === 48 && renderer.stats.meshDrawCalls === 8);
        assert(renderer.stats.meshes === 1 && renderer.stats.textures === 2);
        const first = c.toDataURL(); scene.SetCurrentCamera(scene.GetNode('Orthographic')); renderer.submit(scene);
        assert(c.toDataURL() !== first, 'Camera switch did not change pixels');
        scene.GetNode('Disabled prop').Enable(); renderer.submit(scene); assert(renderer.stats.triangles === 60);
        scene.dispose(); empty(assets); assert(renderer.stats.gpuStaticBytes === 0 && renderer.stats.meshes === 0 && renderer.stats.textures === 0);
      }
    } finally { assets.dispose(); renderer.dispose(); assert(renderer.stats.staticPrograms === 0); c.remove(); }
  });

  test('W1: explicit PBR structural derivative matches native hierarchy without claiming lighting', async () => {
    const assets = new hg.StaticAssets(await options());
    try {
      const reference = await json(assets,'references/pbr-native.json');
      const scene = await assets.loadScene('materials/materials.scn', {structure:true}); compare(scene,reference);
      equal(scene.stats, {nodes:15,transforms:15,cameras:1,objects:13,lights:0});
      assert(scene.metadata.structure && scene.metadata.lights.length === 1 && assets.stats.pictures === 0);
      for (const node of scene.GetNodes()) if (node.GetObject().IsValid()) assert(node.GetObject().GetMaterial(0).diagnostic);
      scene.dispose(); empty(assets);
    } finally { assets.dispose(); }
  });

  for (const caseId of staticCases) test(`tutorial W1: ${caseId} deterministic render/dispose`, async () => {
    const c = canvas(), renderer = new hg.StaticRenderer(c), assets = new hg.StaticAssets(await options({renderer})), input = new hg.InputManager();
    const app = createStaticApplication(caseId), clock = scheduler();
    const runner = hg.createRunner(app, {renderer, assets, input, width:256, height:256}, {...clock, cleanup() { assets.dispose(); input.dispose(); renderer.dispose(); }});
    try {
      await runner.start(); [0,16,32,48].forEach(t => clock.step(t));
      assert(app.stats.steps === 4 && app.stats.elapsedNs === '48000000');
      assert(renderer.stats.triangles > 0 && c.getContext('webgl2').getError() === 0);
      window.tutorialCaptures[caseId] = c.toDataURL('image/png');
      if (caseId === 'scene_static_room') {
        input.key('Space',true); clock.step(64); equal(app.stats.camera,'Orthographic');
        window.tutorialCaptures['scene_static_room.orthographic'] = c.toDataURL('image/png');
      }
    } finally { await runner.stop(); assert(app.stats.disposed); empty(assets); assert(renderer.stats.gpuStaticBytes === 0); c.remove(); }
  });
}
