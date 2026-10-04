import * as hg from 'harfang';
import {selectLights} from '../src/render/lights.js';
import {validateMaterial, validateSceneJSON} from '../src/scene/schema.js';
import {createLightingApplication, lightingCases} from '../examples/tutorials/lighting-application.js';

export function registerLightingTests({test,assert,equal,near,throws,rejects,scheduler}) {
  const baseURL = new URL('../assets-web/',import.meta.url).href; let manifest;
  const options = async extra => ({manifest:manifest ??= await (await fetch(new URL('manifest.json',baseURL))).json(),baseURL,...extra});
  const json = async (assets,id) => { const lease = await assets.acquire(id); try { return JSON.parse(lease.text()); } finally { lease.dispose(); } };
  const empty = assets => { for (const [key,count] of Object.entries(assets.stats)) assert(count === 0,`${key}: ${count} remaining`); };
  async function withRenderer(work) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; document.body.append(canvas);
    const renderer = new hg.StaticRenderer(canvas), assets = new hg.StaticAssets(await options({renderer}));
    try { await work({canvas,renderer,assets,gl:canvas.getContext('webgl2')}); }
    finally { assets.dispose(); empty(assets); renderer.dispose(); assert(renderer.stats.gpuStaticBytes === 0 && renderer.stats.forwardPrograms === 0); canvas.remove(); }
  }
  const pixel = (gl,x=128,y=128) => { const out = new Uint8Array(4); gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out); return [...out.slice(0,3)]; };
  function litMaterial(family='pbr',base=[.25,.25,.25,1],surface=[1,.5,0,1],self=[0,0,0,0]) {
    return hg.createMaterial({program:`core/shader/${family}.hps`,face_culling:'disabled',values:[
      {name:family === 'pbr' ? 'uBaseOpacityColor' : 'uDiffuseColor',type:'vec4',value:base},
      {name:family === 'pbr' ? 'uOcclusionRoughnessMetalnessColor' : 'uSpecularColor',type:'vec4',value:surface},
      {name:'uSelfColor',type:'vec4',value:self}]});
  }
  async function panel(assets,material) {
    const scene = new hg.Scene(), mesh = scene.own(await assets.loadModel('models/tangent-quad.geo'));
    const camera = scene.CreateNode('Camera'); camera.SetTransform(scene.CreateTransform(new hg.Vec3(0,0,-3))); camera.SetCamera(scene.CreateOrthographicCamera(.1,10,2)); scene.SetCurrentCamera(camera);
    const object = scene.CreateNode('Panel'); object.SetTransform(scene.CreateTransform()); object.SetObject(scene.CreateObject(mesh,[material]));
    return scene;
  }
  function addLight(scene,name,type=hg.LT_Linear,pos=new hg.Vec3()) {
    const node = scene.CreateNode(name); node.SetTransform(scene.CreateTransform(pos)); const light = scene.CreateLight(); light.SetType(type); node.SetLight(light); return node;
  }

  test('W2: native light uniforms, intensity separation and reserved directional slot', async () => {
    const assets = new hg.StaticAssets(await options());
    try {
      const scene = await assets.loadScene('scenes/lighting.scn'), reference = await json(assets,'references/lighting-native.json');
      const lights = selectLights(scene);
      for (const key of ['positions','directions','diffuse','specular']) near([...lights[key]],reference.lightUniforms[key],.00001);
      equal(lights.names,['Sun','Red point','Blue point','Spot',null,null,null,null]);
      scene.GetNode('Sun').Disable(); const next = selectLights(scene); assert(next.active === 3 && next.names[0] === null); near([...next.diffuse.slice(0,4)],[0,0,0,0]);
      const light = scene.GetNode('Spot').GetLight(), copy = light.GetDiffuseColor(); copy.r = 0; assert(light.GetDiffuseColor().r > 0);
      scene.DestroyLight(light); assert(!light.IsValid()); throws(() => light.GetPriority(),'INVALID_HANDLE'); scene.dispose(); empty(assets);
    } finally { assets.dispose(); }
  });

  test('W2: eight-slot overflow, stable equal-priority ordering and dynamic reselection', () => {
    const scene = new hg.Scene();
    try {
      const sun = addLight(scene,'Sun'), sun2 = addLight(scene,'Other sun'); sun.GetLight().SetPriority(1);
      const points = Array.from({length:16},(_,i) => addLight(scene,`Point ${i}`,hg.LT_Point));
      equal(selectLights(scene).names,['Sun',...points.slice(0,7).map(n => n.GetName())]); assert(selectLights(scene).omitted === 10);
      points[15].GetLight().SetPriority(5); points[0].Disable(); sun2.GetLight().SetPriority(2);
      equal(selectLights(scene).names,['Other sun','Point 15','Point 1','Point 2','Point 3','Point 4','Point 5','Point 6']);
      const other = new hg.Scene(); try { throws(() => points[1].SetLight(other.CreateLight()),'INVALID_HANDLE'); } finally { other.dispose(); }
    } finally { scene.dispose(); }
  });

  test('W2: material mutation copies values, validates states and rejects unsupported features', () => {
    const m = litMaterial(), color = new hg.Vec4(.2,.3,.4,1); hg.SetMaterialValue(m,'uBaseOpacityColor',color); color.x=1;
    near([...hg.GetMaterialValue(m,'uBaseOpacityColor').data],[.2,.3,.4,1]); const source = m.source; source.values[0].value[0]=1; assert(m.value('uBaseOpacityColor')[0] < .3);
    for (const source of [{program:'custom.hps'}, {...m.source,flags:['EnableSkinning']}, {...m.source,textures:[{name:'uNormalMap',stage:3,path:'pictures/normal.png'}]},
      {...m.source,values:[{name:'uUnsupported',type:'vec4',value:[0,0,0,0]}]}]) throws(() => validateMaterial(source));
    throws(() => hg.SetMaterialValue(m,'uDiffuseColor',new hg.Vec4()),'UNSUPPORTED_MATERIAL');
    throws(() => hg.SetMaterialBlendMode(m,'weighted-oit'),'UNSUPPORTED_MATERIAL');
    hg.SetMaterialAlphaCut(m,true); assert(m.source.flags.includes('EnableAlphaCut')); hg.SetMaterialAlphaCut(m,false); equal(m.source.flags,[]);
    const scene = new hg.Scene(), mesh = hg.CreateCubeModel(hg.VertexLayoutPosFloatNormUInt8(),1,1,1);
    try { throws(() => scene.CreateObject(mesh,[{source:{program:'custom.hps'}}]),'INVALID_MATERIAL'); }
    finally { scene.dispose(); mesh.dispose(); }
  });

  test('W2: explicit shadow/probe adaptations preserve original PBR JSON and sample its maps', async () => {
    const assets = new hg.StaticAssets(await options());
    try {
      const body = await json(assets,'materials/materials-forward.scn');
      throws(() => validateSceneJSON(body,{lighting:true}),'UNSUPPORTED_SCENE_FEATURE');
      throws(() => validateSceneJSON(body,{lighting:true,ignoreShadows:true}),'UNSUPPORTED_SCENE_FEATURE');
      const entry = assets.describe('materials/materials-forward.scn'); assert(entry.sha256 === entry.sourceSHA256 && entry.sha256 === assets.describe('materials/materials.scn').sha256);
      const scene = await assets.loadScene('materials/materials-forward.scn'); assert(scene.stats.lights === 1 && assets.stats.pictures > 0 && !scene.metadata.structure);
      assert(scene.metadata.adaptations.ignoreShadows && scene.metadata.adaptations.ambientEnvironment);
      for (const n of scene.GetNodes()) if (n.GetObject().IsValid()) assert(!n.GetObject().GetMaterial(0).diagnostic);
      scene.dispose(); empty(assets);
    } finally { assets.dispose(); }
  });

  test('W2: normal mapping without tangents fails transactionally and stale textures reject', async () => withRenderer(async ({assets,renderer}) => {
    const body = await json(assets,'scenes/room.scn'); body.objects[0].materials = [0,1].map(() => ({...litMaterial().source,textures:[{name:'uNormalMap',stage:2,path:'pictures/normal.png'}]}));
    await rejects(assets.loadSceneJSON(body,{lighting:true}),'MISSING_TANGENTS'); empty(assets); assert(renderer.stats.gpuStaticBytes === 0);
    const picture = await assets.loadPicture('pictures/normal.png'), m = litMaterial(); picture.dispose();
    throws(() => hg.SetMaterialTexture(m,'uNormalMap',picture,2),'INVALID_HANDLE'); empty(assets);
  }));

  test('W2: native gamma, diffuse-map replacement and PBR sRGB decoding differ deliberately', async () => withRenderer(async ({assets,renderer,gl}) => {
    const image = await assets.loadPicture('pictures/quadrants.png');
    for (const family of ['default','pbr']) {
      const m = litMaterial(family,[.01,.01,.01,1],family === 'pbr' ? [1,.5,0,0] : [0,0,0,1]), scene = await panel(assets,m);
      if (family === 'default') scene.environment.ambient = hg.Color.White;
      else { const light = addLight(scene,'Sun').GetLight(); light.SetSpecularIntensity(0); }
      hg.SetMaterialTexture(m,family === 'pbr' ? 'uBaseOpacityMap' : 'uDiffuseMap',image,0); renderer.submit(scene);
      const rgb = [240,65,45].map(v => v/255), linear = rgb.map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
      const expected = (family === 'pbr' ? linear.map(v => v*.96) : rgb).map(v => 255*v**(1/2.2));
      near(pixel(gl,64,192),expected,2); scene.dispose();
    }
    image.dispose(); empty(assets);
  }));

  test('W2: ORM AO channel affects direct light; metal suppresses diffuse; self map replaces uniform', async () => withRenderer(async ({assets,renderer,gl}) => {
    const m = litMaterial(), scene = await panel(assets,m); const sun = addLight(scene,'Sun').GetLight(); sun.SetSpecularIntensity(0);
    renderer.submit(scene); const dielectric = pixel(gl);
    hg.SetMaterialValue(m,'uOcclusionRoughnessMetalnessColor',new hg.Vec4(.25,.5,0,0)); renderer.submit(scene);
    near(pixel(gl),dielectric.map(v => v*.25**(1/2.2)),2);
    hg.SetMaterialValue(m,'uOcclusionRoughnessMetalnessColor',new hg.Vec4(1,.5,1,0)); renderer.submit(scene); near(pixel(gl),[0,0,0],1);
    hg.SetMaterialValue(m,'uSelfColor',new hg.Vec4(.5,.5,.5,0)); const self = scene.own(await assets.loadPicture('pictures/self.png'));
    hg.SetMaterialTexture(m,'uSelfMap',self,4); renderer.submit(scene); near(pixel(gl,64,192),[80,10,0].map(v => 255*(v/255)**(1/2.2)),2);
    scene.dispose(); empty(assets);
  }));

  test('W2: exact 0.8 alpha-cut boundary and material edits do not compile new variants', async () => withRenderer(async ({assets,renderer,gl}) => {
    const m = litMaterial('pbr',[1,1,1,.799],[1,.5,0,0],[.25,.25,.25,0]), scene = await panel(assets,m); hg.SetMaterialAlphaCut(m,true);
    scene.canvas.color = new hg.Color(.1,.2,.3); renderer.submit(scene); near(pixel(gl),[25.5,51,76.5],1);
    hg.SetMaterialValue(m,'uBaseOpacityColor',new hg.Vec4(1,1,1,.8)); renderer.submit(scene); near(pixel(gl),[.25,.25,.25].map(v => 255*v**(1/2.2)),1);
    const before = renderer.stats, picture = scene.own(await assets.loadPicture('pictures/foliage.png'));
    for (let i=0;i<40;++i) { hg.SetMaterialTexture(m,'uBaseOpacityMap',i%2 ? picture : null,0); hg.UpdateMaterialPipelineProgramVariant(m); renderer.submit(scene); }
    assert(renderer.stats.forwardPrograms === 1 && renderer.stats.shaderCompileMs === before.shaderCompileMs); assert(gl.getError() === gl.NO_ERROR); scene.dispose(); empty(assets);
  }));

  test('W2: point radius, spot cone, separate diffuse/specular intensity and fog pixels', async () => withRenderer(async ({assets,renderer,gl}) => {
    const m = litMaterial('default',[1,1,1,1],[0,0,0,1]), scene = await panel(assets,m);
    scene.GetNode('Panel').GetTransform().SetRot(hg.Deg3(0,180,0));
    const node = addLight(scene,'Point',hg.LT_Point,new hg.Vec3(0,0,-2)), light = node.GetLight(); light.SetRadius(4); light.SetSpecularIntensity(0);
    renderer.submit(scene); near(pixel(gl),[.5,.5,.5].map(v => 255*v**(1/2.2)),2);
    light.SetRadius(1); renderer.submit(scene); near(pixel(gl),[0,0,0],1);
    light.SetRadius(0); light.SetType(hg.LT_Spot); node.GetTransform().SetRot(hg.Deg3(0,90,0)); renderer.submit(scene); near(pixel(gl),[0,0,0],1);
    node.GetTransform().SetRot(new hg.Vec3()); light.SetDiffuseIntensity(.25); renderer.submit(scene); near(pixel(gl),[.25,.25,.25].map(v => 255*v**(1/2.2)),2);
    light.SetDiffuseIntensity(0); light.SetSpecularIntensity(.25); hg.SetMaterialValue(m,'uSpecularColor',new hg.Vec4(1,1,1,1)); renderer.submit(scene); near(pixel(gl),[.25,.25,.25].map(v => 255*v**(1/2.2)),2);
    scene.environment.fog_near=1; scene.environment.fog_far=2; scene.environment.fog_color=new hg.Color(.1,.2,.3); renderer.submit(scene);
    near(pixel(gl),[.1,.2,.3].map(v => 255*v**(1/2.2)),1); scene.dispose(); empty(assets);
  }));

  test('W2: all agreed bgfx blend equations and channel-write masks produce expected pixels', async () => withRenderer(async ({assets,renderer,gl}) => {
    const mesh = await assets.loadModel('models/tangent-quad.geo'), dst=[.7,.3,.4], src=[.8,.65,.9];
    const m = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled',depth_test:'disabled',values:[{name:'uColor',type:'vec4',value:[...src,.5]}]});
    const expected = {opaque:src,alpha:src.map((v,i) => (v+dst[i])*.5),add:src.map((v,i) => Math.min(v+dst[i],1)),multiply:src.map((v,i) => v*dst[i]),
      screen:src.map((v,i) => v+dst[i]*(1-v)),darken:src.map((v,i) => Math.min(v,dst[i])),lighten:src.map((v,i) => Math.max(v,dst[i])),
      linearburn:src.map((v,i) => Math.max(v*dst[i]-dst[i]*(1-dst[i]),0)),alphaRGB_addAlpha:src.map((v,i) => (v+dst[i])*.5)};
    for (const [mode,rgb] of Object.entries(expected)) {
      hg.SetMaterialBlendMode(m,mode); renderer.beginFrame(new hg.Color(...dst)); renderer.drawModel(mesh,'shaders/unlit.hps',hg.Mat4.Identity,hg.Mat44.Identity,[m]); near(pixel(gl),rgb.map(v => v*255),2);
    }
    hg.SetMaterialBlendMode(m,'opaque'); hg.SetMaterialWriteRGBA(m,false,true,false,true);
    renderer.beginFrame(new hg.Color(...dst)); renderer.drawModel(mesh,'shaders/unlit.hps',hg.Mat4.Identity,hg.Mat44.Identity,[m]); near(pixel(gl),[dst[0],src[1],dst[2]].map(v => v*255),2);
    assert(gl.getError() === gl.NO_ERROR); mesh.dispose(); empty(assets);
  }));

  test('W2: gallery/fog GPU cleanup and bounded startup programs over reloads', async () => withRenderer(async ({assets,renderer,canvas,gl}) => {
    for (let i=0;i<3;++i) {
      const scene = await assets.loadScene('scenes/lighting.scn'); renderer.submit(scene);
      assert(renderer.stats.forwardPrograms === 2 && renderer.stats.transparentDraws === 2 && renderer.stats.activeLights === 4);
      assert(renderer.stats.meshDrawCalls === 12 && renderer.stats.shaderCompileMs >= 0); assert(gl.getError() === gl.NO_ERROR);
      window.tutorialCaptures.material_lighting = canvas.toDataURL(); scene.environment.fog_near=9; scene.environment.fog_far=14; renderer.submit(scene);
      window.tutorialCaptures['material_lighting.fog'] = canvas.toDataURL();
      assert(window.tutorialCaptures.material_lighting !== window.tutorialCaptures['material_lighting.fog']);
      window.lightingMetrics = {...renderer.stats}; scene.dispose(); empty(assets); assert(renderer.stats.gpuStaticBytes === 0);
    }
  }));

  test('W2: depth comparisons, depth writes and both culling orientations', async () => withRenderer(async ({assets,renderer,gl}) => {
    const mesh = await assets.loadModel('models/tangent-quad.geo');
    const red = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled',values:[{name:'uColor',type:'vec4',value:[1,0,0,1]}]});
    const green = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled',values:[{name:'uColor',type:'vec4',value:[0,1,0,1]}]});
    const draw = (m,z=0,world) => renderer.drawModel(mesh,'shaders/unlit.hps',world ?? hg.TranslationMat4(new hg.Vec3(0,0,z)),hg.Mat44.Identity,[m]);
    for (const [depth,z,pass] of [['less',-.5,true],['less',.5,false],['leq',0,true],['eq',0,true],['eq',.5,false],['geq',0,true],
      ['greater',.5,true],['greater',-.5,false],['neq',0,false],['neq',.5,true],['never',-.5,false],['always',.5,true],['disabled',.5,true]]) {
      renderer.beginFrame(hg.Color.Black); draw(red); hg.SetMaterialDepthTest(green,depth); draw(green,z); equal(pixel(gl),pass ? [0,255,0] : [255,0,0]);
    }
    hg.SetMaterialDepthTest(green,hg.DT_Less);
    for (const write of [false,true]) { renderer.beginFrame(); hg.SetMaterialWriteZ(red,write); draw(red,-.5); draw(green,.5); equal(pixel(gl),write ? [255,0,0] : [0,255,0]); }
    for (const [cull,mirrored,visible] of [[hg.FC_Clockwise,false,false],[hg.FC_CounterClockwise,false,true],[hg.FC_Clockwise,true,true],[hg.FC_CounterClockwise,true,false]]) {
      renderer.beginFrame(hg.Color.Black); hg.SetMaterialFaceCulling(green,cull); draw(green,0,hg.ScaleMat4(new hg.Vec3(mirrored ? -1 : 1,1,1))); equal(pixel(gl),visible ? [0,255,0] : [0,0,0]);
    }
    assert(gl.getError() === gl.NO_ERROR); mesh.dispose(); empty(assets);
  }));

  test('W2: overlapping transparency sorts back to front with stable equal-depth ties', async () => withRenderer(async ({assets,renderer,gl}) => {
    const red = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled',blend_mode:'alpha',write_z:false,values:[{name:'uColor',type:'vec4',value:[1,0,0,.5]}]});
    const blue = hg.createUnlitMaterial({program:'shaders/unlit.hps',face_culling:'disabled',blend_mode:'alpha',write_z:false,values:[{name:'uColor',type:'vec4',value:[0,0,1,.5]}]});
    const scene = await panel(assets,red), nearNode = scene.GetNode('Panel'), farNode = scene.CreateNode('Far'); scene.canvas.color=hg.Color.Black;
    farNode.SetTransform(scene.CreateTransform(new hg.Vec3(0,0,.2))); farNode.SetObject(scene.CreateObject(nearNode.GetObject().GetModelRef(),[blue]));
    renderer.submit(scene); near(pixel(gl),[127.5,0,63.75],1);
    farNode.GetTransform().SetPos(new hg.Vec3()); renderer.submit(scene); near(pixel(gl),[63.75,0,127.5],1);
    scene.dispose(); empty(assets);
  }));

  test('W2: cancellation and corrupt late material maps release every scene dependency', async () => {
    const original = await options();
    for (const cancel of [false,true]) {
      const manifest = structuredClone(original.manifest), controller = new AbortController(); let reached;
      const waiting = new Promise(resolve => { reached=resolve; }), id='pictures/self.png';
      if (!cancel) manifest.assets[id].sha256='0'.repeat(64);
      const assets = new hg.StaticAssets({...original,manifest,fetch:(url,options) => {
        if (cancel && url.href.endsWith(manifest.assets[id].uri)) { reached(); return new Promise((resolve,reject) => options.signal.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true})); }
        return fetch(url,options);
      }});
      try {
        const pending = assets.loadScene('scenes/lighting.scn',{signal:controller.signal}), rejected = rejects(pending,cancel ? 'CANCELLED' : undefined);
        if (cancel) { await waiting; assert(assets.stats.models === 2 && assets.stats.pictures === 4); controller.abort(); }
        await rejected; empty(assets);
      } finally { assets.dispose(); }
    }
  });

  for (const caseId of lightingCases) test(`tutorial W2: ${caseId} deterministic render/dispose`, async () => withRenderer(async ({assets,renderer,canvas}) => {
    const app = createLightingApplication(caseId), clock = scheduler(), input = new hg.InputManager();
    const runner = hg.createRunner(app,{renderer,assets,input,width:256,height:256},{...clock,cleanup() { input.dispose(); }});
    try {
      const start = performance.now(); await runner.start(); const initMs = performance.now()-start, frames = [];
      for (const t of [0,16,32,48]) { const frameStart = performance.now(); clock.step(t); canvas.getContext('webgl2').finish(); frames.push(performance.now()-frameStart); }
      assert(app.stats.steps === 4 && renderer.stats.triangles > 0,`${runner.error?.stack ?? ''}; ${JSON.stringify(app.stats)}`);
      (window.lightingStartup ??= {})[caseId] = {initMs, frameMs:frames, forwardPrograms:renderer.stats.forwardPrograms,
        shaderCompileMs:renderer.stats.shaderCompileMs, gpuBytes:renderer.stats.gpuStaticBytes, draws:renderer.stats.meshDrawCalls,
        shadowMaps:0,viewport:[256,256],dpr:1, movingObjects:app.stats.movingObjects ?? 0};
      assert(canvas.getContext('webgl2').getError() === 0); window.tutorialCaptures[caseId] = canvas.toDataURL();
      if (caseId === 'scene_light_priority') {
        const reference = await json(assets,'references/priority-native.json'); let time = 48;
        for (const checkpoint of reference.checkpoints) {
          while (time < checkpoint.milliseconds) { time += 100; clock.step(time); }
          equal(app.stats.selectedLights,checkpoint.selected); assert(renderer.stats.omittedLights === 9);
        }
      }
      if (caseId === 'scene_many_nodes.small.no_shadows') assert(app.stats.movingObjects === 121 && renderer.stats.meshDrawCalls === 122);
      if (caseId === 'material_update_value.no_shadows') {
        assert(app.stats.textured); const before = canvas.toDataURL(), compile = renderer.stats.shaderCompileMs;
        for (let t=148;t<=1048;t+=100) clock.step(t);
        assert(!app.stats.textured && before !== canvas.toDataURL() && renderer.stats.shaderCompileMs === compile);
      }
    } finally { await runner.stop(); assert(app.stats.disposed); empty(assets); assert(renderer.stats.gpuStaticBytes === 0); }
  }));
}
