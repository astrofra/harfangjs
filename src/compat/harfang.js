// Native-shaped API slice, implemented by shared JS scene/math and WebGL services.
// Unsupported overloads fail; the native HG JS API remains the reference.
export * from '../index.js';
import {Scene as BaseScene, setTransformMatrix, setObjectModelReference, LT_Spot, LT_Linear} from '../scene/scene.js';
import {Color, Vec4, Deg} from '../core/math.js';
import {integer, requireCondition} from '../core/errors.js';
import {Material} from '../render/materials.js';
import {getHost,optionalHost} from './context.js';
import {profile} from './profile.js';
export {profile};

export const LST_None=0, LST_Map=1;
export const RF_None=0, RF_VSync=128, RF_MSAA4X=32;
export class Scene extends BaseScene {
  constructor() { super({maxNodes:profile.limits.maxNodes}); optionalHost()?.scenes.add(this); }
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
export const InvalidModelRef=new ModelRef(undefined,'',undefined);
export const InvalidPipelineProgramRef=new PipelineProgramRef(undefined,'',undefined);
InvalidModelRef.alive=InvalidPipelineProgramRef.alive=false;
export class PipelineResources {
  constructor() { this.host=getHost(); this.models=new Map(); this.programs=new Map(); this.host.resources.add(this); }
  AddModel(name,model) {
    requireCondition(typeof name==='string' && model?.IsValid(),'INVALID_ARGUMENT','AddModel expects name and valid model');
    if(this.models.has(name)) return this.models.get(name);
    const ref=new ModelRef(this,name,model); this.models.set(name,ref); return ref;
  }
  HasModel(name) { return this.models.get(name)??InvalidModelRef; }
  GetModel(ref) { requireCondition(ref instanceof ModelRef && ref.owner===this && ref.IsValid(),'INVALID_HANDLE','Invalid ModelRef'); return ref.value; }
  GetModelName(ref) { return ref instanceof ModelRef && ref.owner===this && ref.IsValid()?ref.name:''; }
  GetProgramName(ref) { return ref instanceof PipelineProgramRef && ref.owner===this && ref.IsValid()?ref.name:''; }
  DestroyAllTextures() { /* This program profile does not create texture resources. */ }
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
  const node=nodeWithMatrix(scene,matrix); node.SetCamera(scene.CreateCamera(near,far,fov)); return node;
}
export function CreateObject(scene,matrix,model,materials=[]) {
  const node=nodeWithMatrix(scene,matrix); node.SetObject(scene.CreateObject(model,materials)); return node;
}
export function CreateSpotLight(scene,matrix,radius,inner,outer,diffuse=Color.White,specular=Color.White,priority=0,shadowType=LST_None,bias=0.0001,near=0.1,far=100) {
  requireCondition(diffuse instanceof Color && specular instanceof Color,'UNSUPPORTED_OVERLOAD','This overload requires diffuse and specular Color');
  const node=nodeWithMatrix(scene,matrix), light=scene.CreateLight();
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
  const opaque=viewId+(scene.GetLights().some(n=>n.IsEnabled()&&n.GetLight().GetType()!==LT_Linear)?1:0);
  const views=new SceneForwardPipelinePassViewId(), ids=passViews.get(views);
  ids[SFPP_Opaque]=opaque; ids[SFPP_Transparent]=opaque+1;
  return [opaque+2,views];
}
