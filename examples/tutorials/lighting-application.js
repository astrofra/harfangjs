import * as hg from 'harfang';

export const lightingCases = ['material_lighting','scene_pbr.materials','material_update_value.no_shadows',
  'scene_light_priority','scene_many_nodes.small.no_shadows'];

function phong(diffuse = [1,1,1,1], specular = [1,1,1,1], self = [0,0,0,0]) {
  return hg.createMaterial({program:'core/shader/default.hps',values:[
    {name:'uDiffuseColor',type:'vec4',value:diffuse},{name:'uSpecularColor',type:'vec4',value:specular},{name:'uSelfColor',type:'vec4',value:self}]});
}
function node(scene,name,pos,rot = new hg.Vec3(),scale = new hg.Vec3(1,1,1)) {
  const result = scene.CreateNode(name); result.SetTransform(scene.CreateTransform(pos,rot,scale)); return result;
}
function object(scene,name,model,material,pos,scale = new hg.Vec3(1,1,1)) {
  const result = node(scene,name,pos,new hg.Vec3(),scale); result.SetObject(scene.CreateObject(model,[material])); return result;
}
function light(scene,name,type,pos,rot,diffuse,specular,radius = 0,priority = 0) {
  const result = node(scene,name,pos,rot), component = scene.CreateLight(); component.SetType(type);
  component.SetDiffuseColor(diffuse); component.SetSpecularColor(specular); component.SetRadius(radius); component.SetPriority(priority);
  result.SetLight(component); return result;
}
function camera(scene,pos,target) {
  const d = target.sub(pos), rot = new hg.Vec3(-Math.atan2(d.y,Math.hypot(d.x,d.z)),Math.atan2(d.x,d.z),0);
  const result = node(scene,'Camera',pos,rot); result.SetCamera(scene.CreateCamera(.01,1000,hg.Deg(45))); scene.SetCurrentCamera(result);
}

export function createLightingApplication(caseId = 'material_lighting') {
  if (!lightingCases.includes(caseId)) throw new Error(`Unknown W2 case: ${caseId}`);
  let scene, material, picture, normal, sphere, elapsed = 0n, toggleDelay = 0n, textured = false, moving = [], rows = [];
  const stats = {caseId,steps:0,elapsedNs:'0',disposed:false};
  return {
    requires:['render.forward','material.pbr','scene.lights'], stats,
    async init(ctx) {
      if (['material_lighting','scene_pbr.materials'].includes(caseId)) {
        scene = await ctx.assets.loadScene(caseId === 'material_lighting' ? 'scenes/lighting.scn' : 'materials/materials-forward.scn',{signal:ctx.signal});
        if (caseId === 'scene_pbr.materials') stats.adaptation = 'Original JSON and material maps; shadows disabled, environment probes replaced by authored ambient.';
        else { material = scene.GetNode('Normal mapped').GetObject().GetMaterial(0); normal = hg.GetMaterialTexture(material,'uNormalMap'); stats.rig = 0; }
      } else {
        scene = new hg.Scene();
        const cube = scene.own(hg.CreateCubeModel(hg.VertexLayoutPosFloatNormUInt8(),1,1,1));
        sphere = scene.own(await ctx.assets.loadModel('materials/sphere.geo',{signal:ctx.signal}));
        const groundSpecular = caseId === 'material_update_value.no_shadows' ? [.1,.1,.1,1] : [1,1,1,1];
        object(scene,'Ground',cube,phong([1,1,1,1],groundSpecular),new hg.Vec3(),
          caseId === 'scene_many_nodes.small.no_shadows' ? new hg.Vec3(60,.001,60) : new hg.Vec3(100,.01,100));
        if (caseId === 'material_update_value.no_shadows') {
          camera(scene,new hg.Vec3(-1.3,.27,-2.47),new hg.Vec3(0,.5,0));
          material = phong(); object(scene,'Cube',cube,material,new hg.Vec3(0,.5,0));
          light(scene,'Sun',hg.LT_Linear,new hg.Vec3(0,2,0),hg.Deg3(27.5,-97.6,16.6),hg.ColorI(64,64,64),hg.ColorI(64,64,64),0,10);
          const spot = light(scene,'Spot',hg.LT_Spot,new hg.Vec3(5,4,-5),hg.Deg3(19,-45,0),hg.Color.White,hg.Color.White,0,10).GetLight();
          spot.SetInnerAngle(hg.Deg(5)); spot.SetOuterAngle(hg.Deg(30));
          picture = scene.own(await ctx.assets.loadPicture('textures/squares.png',{signal:ctx.signal}));
          stats.adaptation = 'Original one-second diffuse-map toggle; spot shadows disabled. Deterministic specular exponent w=1.';
        } else if (caseId === 'scene_light_priority') {
          camera(scene,new hg.Vec3(5,4,-7),new hg.Vec3(0,1.5,0));
          object(scene,'Orb',sphere,phong(),new hg.Vec3(0,1,0),new hg.Vec3(2,2,2));
          const marker = scene.CreateObject(sphere,[phong([0,0,0,0],[0,0,0,1],[1,.9,.75,0])]);
          for (let i=0;i<16;++i) {
            const item = light(scene,`Point ${i}`,hg.LT_Point,new hg.Vec3(),new hg.Vec3(),new hg.Color(1,.85,.25),new hg.Color(1,.9,.5),1.5);
            // Marker size is baked into a child-free object model transform only in the original.
            // Uniform node scale also scales light axes; points do not use those axes.
            item.GetTransform().SetScale(new hg.Vec3(.1,.1,.1)); item.SetObject(marker); moving.push(item);
          }
          stats.adaptation = 'Original 16-light trajectories and distance priorities; compiled sphere geometry.';
        } else {
          camera(scene,new hg.Vec3(3.5,3,-4),new hg.Vec3(0,.5,0)); scene.environment.ambient = new hg.Color(.1,.1,.1);
          const spot = light(scene,'Spot',hg.LT_Spot,new hg.Vec3(-8.8,21.7,-8.8),hg.Deg3(60,45,0),hg.Color.White,hg.Color.White).GetLight();
          spot.SetInnerAngle(hg.Deg(5)); spot.SetOuterAngle(hg.Deg(30));
          const shared = scene.CreateObject(sphere,[phong([1,0,0,1],[1,.8,0,1])]);
          for (let z=-10;z<=10;z+=2) {
            const row = [];
            for (let x=-10;x<=10;x+=2) { const item = node(scene,`Sphere ${x}/${z}`,new hg.Vec3(x*.1,.1,z*.1),new hg.Vec3(),new hg.Vec3(.2,.2,.2)); item.SetObject(shared); row.push(item.GetTransform()); }
            rows.push(row);
          }
          stats.adaptation = 'Bounded 11×11 correctness grid, compiled shared sphere, shadows disabled; original 101×101 stress workload remains W10.';
          stats.grid = [11,11]; stats.movingObjects = 121;
        }
        ctx.renderer.prepareMaterials(scene.GetNodes().filter(n => n.GetObject().IsValid()).flatMap(n => Array.from({length:Number(n.GetObject().GetMaterialCount())},(_,i) => n.GetObject().GetMaterial(i))));
      }
      stats.scene = scene.stats;
    },
    update(ctx,dt) {
      if (ctx.input.keyboard.Pressed(hg.K_Escape)) { void ctx.stop(); return; }
      elapsed += dt; ++stats.steps; stats.elapsedNs = String(elapsed);
      const angle = hg.time_to_sec_f(elapsed);
      if (caseId === 'material_update_value.no_shadows') {
        toggleDelay -= dt;
        if (toggleDelay <= 0n) {
          textured = !textured; hg.SetMaterialTexture(material,'uDiffuseMap',textured ? picture : hg.InvalidTextureRef,0);
          stats.variantKey = hg.UpdateMaterialPipelineProgramVariant(material); stats.textured = textured; toggleDelay += hg.time_from_sec(1n);
        }
      }
      moving.forEach((item,i) => {
        const a = angle+(i+1)*hg.Deg(15), pos = new hg.Vec3(Math.cos(a*-.6)*Math.sin(a)*5,Math.cos(a*1.25)*2+2.15,Math.sin(a*.5)*Math.cos(-a*.8)*5);
        item.GetTransform().SetPos(pos); item.GetLight().SetPriority(-Math.hypot(pos.x,pos.y-1,pos.z));
      });
      rows.forEach((row,j) => row.forEach((trs,i) => { const pos = trs.GetPos(); pos.y = .1*(Math.cos(angle+(j+1)*.1)*Math.sin(angle+(i+1)*.1)*6+6.5); trs.SetPos(pos); }));
      if (caseId === 'material_lighting') {
        if (ctx.input.keyboard.Pressed('Space')) {
          stats.rig = (stats.rig+1)%3;
          scene.GetLights().forEach(n => { const enabled = stats.rig === 0 || (stats.rig === 1 ? n.GetName() === 'Sun' : n.GetName() !== 'Sun'); enabled ? n.Enable() : n.Disable(); });
        }
        if (ctx.input.keyboard.Pressed('KeyF')) { stats.fog = !stats.fog; scene.environment.fog_near = stats.fog ? 9 : 0; scene.environment.fog_far = stats.fog ? 14 : 0; }
        if (ctx.input.keyboard.Pressed('KeyN')) { stats.normalDisabled = !stats.normalDisabled; hg.SetMaterialTexture(material,'uNormalMap',stats.normalDisabled ? null : normal,2); }
        if (ctx.input.keyboard.Pressed('KeyR')) { stats.rough = !stats.rough; hg.SetMaterialValue(scene.GetNode('Sphere 0').GetObject().GetMaterial(0),'uOcclusionRoughnessMetalnessColor',new hg.Vec4(1,stats.rough ? .8 : .15,0,0)); }
      }
    },
    render(ctx) { ctx.renderer.submit(scene); stats.selectedLights = ctx.renderer.stats.selectedLights; },
    resize(ctx,width,height) { stats.viewport = [width,height]; },
    dispose() { scene?.dispose(); moving = []; rows = []; stats.disposed = true; }
  };
}
