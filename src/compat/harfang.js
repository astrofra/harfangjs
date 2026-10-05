// Native-shaped API slice, implemented by shared JS scene/math and WebGL services.
// Unsupported overloads fail; the native HG JS API remains the reference.
export * from '../index.js';
import {Scene as BaseScene, NodeList, attachInstanceView, setTransformMatrix, setObjectModelReference, LT_Spot, LT_Linear, LT_Point} from '../scene/scene.js';
export {NodeList};
import {Color, Vec3, Vec4, Deg, Deg3} from '../core/math.js';
import {integer, requireCondition} from '../core/errors.js';
import {Material} from '../render/materials.js';
import {blendModes,depthTests,cullingModes} from './lines.js';
import {Model} from '../render/models.js';
import {nullReference} from '../scene/schema.js';
export * from './input.js';
export {VertexLayoutPosFloatColorFloat,LoadProgramFromAssets,DestroyProgram,SetView2D,DrawLines,RenderState,ComputeRenderState,
  BM_Additive,BM_Alpha,BM_Darken,BM_Lighten,BM_Multiply,BM_Opaque,BM_Screen,BM_LinearBurn,BM_AlphaRGB_AddAlpha,
  DT_Less,DT_LessEqual,DT_Equal,DT_GreaterEqual,DT_Greater,DT_NotEqual,DT_Never,DT_Always,DT_Disabled,
  FC_Disabled,FC_Clockwise,FC_CounterClockwise,CF_Color,CF_Depth,CF_Stencil} from './lines.js';
import {getHost,optionalHost} from './context.js';
import {profile} from './profile.js';
export {profile};

export const LST_None=0, LST_Map=1;
export const RF_None=0, RF_VSync=128, RF_MSAA4X=32, RF_MSAA8X=48;
export class Scene extends BaseScene {
  constructor() { super({maxNodes:profile.limits.maxNodes,nativeWorldCache:true});this.environment.brdf_map=InvalidTextureRef; optionalHost()?.scenes.add(this); }
  Clear(){super.Clear();this.environment.brdf_map=InvalidTextureRef;}
  GetNodes(){return new NodeList(super.GetNodes());}
  GetAllNodes(){return new NodeList(super.GetAllNodes());}
  CreateObject(model,materials=[]) {
    requireCondition(model instanceof ModelRef && model.IsValid(),'INVALID_HANDLE','Expected a valid ModelRef');
    requireCondition(Array.isArray(materials) && materials.length>0,'INVALID_ARGUMENT','Expected materials');
    const copies=materials.map(material=>{
      const program=materialPrograms.get(material);
      requireCondition(program?.IsValid(),'INVALID_HANDLE','Material program is invalid');
      const copy=material.clone(); materialPrograms.set(copy,program); return copy;
    });
    const object=super.CreateObject(model.value,copies); setObjectModelReference(object,model); return object;
  }
}
export class IntRect {
  constructor(sx=0,sy=0,ex=0,ey=0) {
    for(const value of [sx,sy,ex,ey]) integer(value,-2147483648,2147483647,'rectangle coordinate');
    Object.assign(this,{sx,sy,ex,ey});
  }
}
const info=Object.freeze({name:'forward',profile:'web-native-forward/1'});
export const GetForwardPipelineInfo=()=>info;
export function CreateForwardPipeline(resolution=1024,sixteenBit=true) {
  integer(resolution,1,16384,'shadow resolution');
  requireCondition(typeof sixteenBit==='boolean','INVALID_ARGUMENT','Expected shadow depth precision flag');
  const host=getHost(), pipeline={resolution,sixteenBit,alive:true,host}; host.pipelines.add(pipeline); return pipeline;
}
export function DestroyForwardPipeline(pipeline) {
  if(!pipeline?.alive) return;
  pipeline.alive=false; pipeline.host.renderer?.releaseShadow(); pipeline.host.pipelines.delete(pipeline);
}
class ResourceRef {
  constructor(owner,name,value) { this.owner=owner; this.name=name; this.value=value; this.alive=true; }
  IsValid() { return this.alive && (this.value.IsValid?.()??true); }
}
export class ModelRef extends ResourceRef {}
export class PipelineProgramRef extends ResourceRef {}
export class TextureRef extends ResourceRef {}
export const InvalidTextureRef=new TextureRef(undefined,'',undefined);
InvalidTextureRef.alive=false;
export const InvalidModelRef=new ModelRef(undefined,'',undefined);
export const InvalidPipelineProgramRef=new PipelineProgramRef(undefined,'',undefined);
InvalidModelRef.alive=InvalidPipelineProgramRef.alive=false;
export class PipelineResources {
  constructor() { this.host=getHost(); this.models=new Map(); this.programs=new Map(); this.textures=new Map(); this.host.resources.add(this); }
  AddModel(name,model) {
    requireCondition(typeof name==='string' && model?.IsValid(),'INVALID_ARGUMENT','AddModel expects name and valid model');
    if(this.models.has(name)) return this.models.get(name);
    const ref=new ModelRef(this,name,model); this.models.set(name,ref); return ref;
  }
  HasModel(name) { return this.models.get(name)??InvalidModelRef; }
  GetModel(ref) { requireCondition(ref instanceof ModelRef && ref.owner===this && ref.IsValid(),'INVALID_HANDLE','Invalid ModelRef'); return ref.value; }
  GetModelName(ref) { return ref instanceof ModelRef && ref.owner===this && ref.IsValid()?ref.name:''; }
  GetProgramName(ref) { return ref instanceof PipelineProgramRef && ref.owner===this && ref.IsValid()?ref.name:''; }
  HasTexture(name) { return this.textures.get(name)??InvalidTextureRef; }
  GetTextureName(ref) { return ref instanceof TextureRef&&ref.owner===this&&ref.IsValid()?ref.name:''; }
  DestroyAllTextures() { for(const ref of this.textures.values()){this.host.renderer?.releaseTexture?.(ref.value);ref.value.alive=false;ref.alive=false;}this.textures.clear(); }
  DestroyAllModels() { for(const ref of this.models.values()) { ref.alive=false; ref.value.dispose(); } this.models.clear(); }
  DestroyAllPrograms() {
    for(const ref of this.programs.values()) ref.alive=false;
    this.programs.clear();
    if(![...this.host.resources].some(resource=>resource.programs.size)) this.host.renderer?.releasePrograms();
  }
}
export function LoadPipelineProgramRefFromAssets(name,resources,pipelineInfo) {
  const host=getHost();
  requireCondition(resources instanceof PipelineResources && resources.host===host && pipelineInfo===info,'INVALID_ARGUMENT','Invalid pipeline resources/info');
  const program=host.assets.programs.get(name);
  requireCondition(program,'ASSET_NOT_PRELOADED',`Program is not preloaded: ${name}`);
  if(resources.programs.has(name)) return resources.programs.get(name);
  host.renderer.prepare(program);
  const ref=new PipelineProgramRef(resources,name,program); resources.programs.set(name,ref); return ref;
}
const materialPrograms=new WeakMap();
export function CreateMaterial(program,...values) {
  requireCondition(program instanceof PipelineProgramRef && program.IsValid(),
    'INVALID_HANDLE','Expected a valid PipelineProgramRef');
  requireCondition([0,2,4].includes(values.length),'UNSUPPORTED_OVERLOAD','CreateMaterial accepts zero, one or two named Vec4 values');
  const records=[];
  for(let i=0;i<values.length;i+=2) {
    requireCondition(typeof values[i]==='string' && values[i+1] instanceof Vec4,'INVALID_ARGUMENT','Expected uniform name and Vec4');
    records.push({name:values[i],type:'vec4',value:[...values[i+1].data]});
  }
  const material=new Material({program:program.name,values:records}); materialPrograms.set(material,program); return material;
}
function nodeWithMatrix(scene,matrix) {
  const node=scene.CreateNode(), transform=scene.CreateTransform();
  setTransformMatrix(transform,matrix); node.SetTransform(transform); return node;
}
export function CreateCamera(scene,matrix,near,far,fov=Deg(45)) {
  const node=nodeWithMatrix(scene,matrix);node.SetName('Camera'); node.SetCamera(scene.CreateCamera(near,far,fov)); return node;
}
export function CreateObject(scene,matrix,model,materials=[]) {
  const node=nodeWithMatrix(scene,matrix);node.SetName('Object'); node.SetObject(scene.CreateObject(model,materials)); return node;
}
export function CreateSpotLight(scene,matrix,radius,inner,outer,diffuse=Color.White,specular=Color.White,priority=0,shadowType=LST_None,bias=0.0001,near=0.1,far=100) {
  requireCondition(diffuse instanceof Color && specular instanceof Color,'UNSUPPORTED_OVERLOAD','This overload requires diffuse and specular Color');
  const node=nodeWithMatrix(scene,matrix), light=scene.CreateLight();
  node.SetName('Spot Light');
  light.SetType(LT_Spot); light.SetRadius(radius); light.SetInnerAngle(inner); light.SetOuterAngle(outer);
  light.SetDiffuseColor(diffuse); light.SetSpecularColor(specular); light.SetPriority(priority);
  light.SetShadowType(shadowType); light.SetShadowBias(bias); light.SetShadowNear(near); light.SetShadowFar(far);
  node.SetLight(light); return node;
}
export const SFPP_Opaque=0,SFPP_Transparent=1,SFPP_Slot0LinearSplit0=2,SFPP_Slot0LinearSplit1=3,
  SFPP_Slot0LinearSplit2=4,SFPP_Slot0LinearSplit3=5,SFPP_Slot1Spot=6,SFPP_DepthPrepass=7;
const passViews=new WeakMap();
export class SceneForwardPipelinePassViewId {
  constructor() { passViews.set(this,Array(8).fill(65535)); }
}
export function GetSceneForwardPipelinePassViewId(views,pass) {
  requireCondition(views instanceof SceneForwardPipelinePassViewId,'INVALID_ARGUMENT','Expected SceneForwardPipelinePassViewId');
  return passViews.get(views)[integer(pass,0,7,'forward pass')];
}
export function SubmitSceneToPipeline(viewId,scene,rect,horizontal,pipeline,resources) {
  const host=getHost();
  integer(viewId,0,65532,'view ID');
  requireCondition(rect instanceof IntRect && horizontal===true && pipeline?.alive && pipeline.host===host && resources.host===host,
    'UNSUPPORTED_OVERLOAD','Expected current-camera forward pipeline submission');
  requireCondition(rect.sx===0&&rect.sy===0&&((rect.ex===host.requestedSize[0]&&rect.ey===host.requestedSize[1]) ||
    (rect.ex===host.canvas.width&&rect.ey===host.canvas.height)),
    'UNSUPPORTED_VIEWPORT','This host maps full-window rectangles to the browser canvas');
  for(const ref of resources.programs.values()) requireCondition(ref.IsValid(),'INVALID_HANDLE','Program was destroyed');
  host.renderer.submit(scene,pipeline); host.currentScene=scene;
  // Native reserves the spotlight pass whenever a local light is selected.
  // Its final submit resets the returned shadow IDs to 65535 (native behavior).
  const directional=scene.GetLights().filter(n=>n.IsEnabled()&&n.GetLight().GetType()===LT_Linear).sort((a,b)=>b.GetLight().GetPriority()-a.GetLight().GetPriority())[0];
  const opaque=viewId+(directional?.GetLight().GetShadowType()===LST_Map?4:0)+(scene.GetLights().some(n=>n.IsEnabled()&&n.GetLight().GetType()!==LT_Linear)?1:0);
  const views=new SceneForwardPipelinePassViewId(), ids=passViews.get(views);
  ids[SFPP_Opaque]=opaque; ids[SFPP_Transparent]=opaque+1;
  return [opaque+2,views];
}

export const LSSF_Nodes=1,LSSF_Scene=2,LSSF_Anims=4,LSSF_All=65535;
function textureResource(name,resources) {
  if(resources.textures.has(name))return resources.textures.get(name).value;
  const record=resources.host.assets.textures.get(name);
  requireCondition(record,'ASSET_NOT_PRELOADED',`Texture is not preloaded: ${name}`);
  const texture={logicalId:name,record,alive:true,IsValid(){return this.alive;}};
  texture.ref=new TextureRef(resources,name,texture);resources.textures.set(name,texture.ref);return texture;
}
export function LoadTextureFromAssets(name,flags,resources) {
  requireCondition(resources instanceof PipelineResources&&flags===0,'UNSUPPORTED_OVERLOAD','Expected path, default texture flags (0) and PipelineResources');
  textureResource(name,resources);return resources.textures.get(name);
}
export const GetMaterialTexture=(material,name)=>material.texture(name)?.ref??InvalidTextureRef;
export function SetMaterialTexture(material,name,texture,stage) {
  requireCondition(texture instanceof TextureRef,'INVALID_ARGUMENT','Expected TextureRef');
  material.setTexture(name,texture.IsValid()?texture.value:null,stage);
}
export const SetMaterialBlendMode=(material,mode)=>material.setState('blend_mode',blendModes[integer(mode,0,8,'blend mode')]);
export const SetMaterialDepthTest=(material,test)=>material.setState('depth_test',depthTests[integer(test,0,8,'depth test')]);
export const SetMaterialFaceCulling=(material,cull)=>material.setState('face_culling',cullingModes[integer(cull,0,2,'face culling')]);
function modelResource(name,resources) {
  if(resources.models.has(name))return resources.models.get(name);
  const recipe=resources.host.assets.geometries.get(name);
  requireCondition(recipe,'ASSET_NOT_PRELOADED',`Geometry is not preloaded: ${name}`);
  return resources.AddModel(name,new Model(new Float32Array(recipe.vertices),new Uint32Array(recipe.indices),recipe.submeshes,recipe.bounds,recipe.stride));
}
function appendScene(name,scene,resources,pipelineInfo,flags) {
  requireCondition(scene instanceof Scene&&resources instanceof PipelineResources&&resources.host===getHost()&&pipelineInfo===info,
    'INVALID_ARGUMENT','Expected Scene, PipelineResources and forward pipeline info');
  requireCondition([LSSF_All,0,1,2,3,4,5,6,7].includes(flags),'UNSUPPORTED_OVERLOAD','Unsupported scene load flags');
  const body=resources.host.assets.scenes.get(name);if(!body)return undefined;
  requireCondition(scene.GetAllNodeCount()+BigInt(flags&LSSF_Nodes?body.nodes.length:0)<=BigInt(profile.limits.maxNodes),'RESOURCE_BUDGET','Scene node budget exceeded');
  const created=[],components=[],nodes=new Map();
  const allocate=(kind,value)=>{components.push([kind,value]);return value;};
  try {
    if(flags&LSSF_Nodes) {
      const objects=(body.objects??[]).map(object=>{
        const materials=object.materials.map(source=>{
          const program=LoadPipelineProgramRefFromAssets(source.program,resources,pipelineInfo),textures=new Map();
          for(const t of source.textures??[])if(t.path)textures.set(t.name,textureResource(t.path,resources));
          const material=new Material(source,textures);materialPrograms.set(material,program);return material;
        });
        const component=allocate('Object',scene.CreateObject(modelResource(object.name,resources),materials));
        (object.material_infos??[]).forEach((v,i)=>{if(i<materials.length)component.SetMaterialName(i,v.name??'');});return component;
      });
      const transforms=(body.transforms??[]).map(t=>allocate('Transform',scene.CreateTransform(new Vec3(...t.pos),Deg3(...t.rot),new Vec3(...t.scl))));
      const cameras=(body.cameras??[]).map(c=>allocate('Camera',c.ortho?scene.CreateOrthographicCamera(c.zrange?.znear??.01,c.zrange?.zfar??1000,c.size??1):
        scene.CreateCamera(c.zrange?.znear??.01,c.zrange?.zfar??1000,c.fov??Deg(40))));
      const lights=(body.lights??[]).map(l=>{
        const light=allocate('Light',scene.CreateLight());light.SetType({linear:LT_Linear,spot:LT_Spot,point:LT_Point}[l.type]);
        light.SetDiffuseColor(new Color(...l.diffuse.map(v=>v/255)));light.SetSpecularColor(new Color(...l.specular.map(v=>v/255)));
        light.SetDiffuseIntensity(l.diffuse_intensity??1);light.SetSpecularIntensity(l.specular_intensity??1);
        light.SetRadius(l.radius??0);light.SetInnerAngle(l.inner_angle??Deg(30));light.SetOuterAngle(l.outer_angle??Deg(45));light.SetPriority(l.priority??0);
        light.SetShadowType(l.shadow_type==='map'?LST_Map:LST_None);light.SetShadowBias(l.shadow_bias??.0001);
        if(l.pssm_split)light.SetPSSMSplit(new Vec4(...l.pssm_split));return light;
      });
      for(const n of body.nodes) {
        const node=scene.CreateNode(n.name);nodes.set(n.idx,node);created.push(node);
        const [t,c,o,l]=n.components;
        if(!nullReference(t))node.SetTransform(transforms[t]);if(!nullReference(c))node.SetCamera(cameras[c]);
        if(!nullReference(o))node.SetObject(objects[o]);if(!nullReference(l))node.SetLight(lights[l]);if(n.disabled)node.Disable();
      }
      (body.transforms??[]).forEach((t,i)=>{if(!nullReference(t.parent))transforms[i].SetParent(nodes.get(t.parent));});
    }
    if(flags&LSSF_Scene) {
      const env=body.environment??{},maps={};
      for(const key of ['brdf_map','irradiance_map','radiance_map'])if(env[key])maps[key]=textureResource(env[key],resources);
      maps.brdf_map=maps.brdf_map?.ref??InvalidTextureRef;
      scene.environment={ambient:new Color(...(env.ambient??[0,0,0,255]).map(v=>v/255)),fog_color:new Color(...(env.fog_color??[0,0,0,255]).map(v=>v/255)),
        fog_near:env.fog_near??0,fog_far:env.fog_far??0,...maps};
      if(body.canvas)scene.canvas={clear_color:body.canvas.clear_color??true,clear_z:body.canvas.clear_z??true,color:new Color(...(body.canvas.color??[0,0,0,255]).map(v=>v/255))};
      const camera=nodes.get(env.current_camera);if(camera)scene.SetCurrentCamera(camera);
      scene.metadata={source:name,key_values:structuredClone(body.key_values??{})};
    }
    return created;
  } catch(error) {
    for(const node of created.reverse())if(node.IsValid())scene.DestroyNode(node);
    for(const [kind,component] of components.reverse())if(component.IsValid())scene[`Destroy${kind}`](component);
    throw error;
  }
}
export function LoadSceneFromAssets(name,scene,resources,pipelineInfo,flags=LSSF_All) {
  return appendScene(name,scene,resources,pipelineInfo,flags)!==undefined;
}
export function CreateInstanceFromAssets(scene,matrix,name,resources,pipelineInfo,flags=LSSF_Nodes|LSSF_Anims) {
  const root=nodeWithMatrix(scene,matrix);root.SetName(name);root.SetInstance(scene.CreateInstance(name));
  try {
    const children=appendScene(name,scene,resources,pipelineInfo,flags);
    if(!children)return [root,false];
    for(const node of children)if(node.GetTransform().IsValid()&&!node.GetTransform().GetParent().IsValid())node.GetTransform().SetParent(root);
    attachInstanceView(root,children);return [root,true];
  } catch(error){scene.DestroyNode(root);throw error;}
}
