import {HandlePool} from '../core/handles.js';
import {requireCondition, finite, integer} from '../core/errors.js';
import {Vec3, Vec4, Color, Deg, Mat4, Mat44, Inverse, TransformationMat4, FovToZoomFactor, ComputePerspectiveProjectionMatrix, ComputeOrthographicProjectionMatrix} from '../core/math.js';
import {profile} from '../profile.js';
import {Material} from '../render/materials.js';
import {time_from_ns} from '../core/time.js';
import {GetSceneAnimInfo,InvalidSceneAnimRef,removeAnimations} from './animation.js';

const handles = new WeakMap();
const destructionObservers = new WeakMap();
export function watchNodeDestruction(node, callback) {
  const ref = handles.get(node);
  requireCondition(node instanceof Node && node.IsValid(), 'INVALID_HANDLE', 'Cannot watch an invalid node');
  let observers = destructionObservers.get(ref);
  if (!observers) { observers = new Set(); destructionObservers.set(ref, observers); }
  observers.add(callback);
  return () => observers.delete(callback);
}
function notifyDestruction(ref) {
  const observers = destructionObservers.get(ref);
  destructionObservers.delete(ref);
  const errors = [];
  for (const callback of [...(observers ?? [])]) { try { callback(); } catch (e) { errors.push(e); } }
  if (errors.length) throw new AggregateError(errors, 'Node destruction callback failed');
}
function token(wrapper, pool) {
  const t = handles.get(wrapper);
  pool.get(t);
  return t;
}
function value(wrapper) {
  const ref = handles.get(wrapper);
  requireCondition(ref, 'INVALID_HANDLE', 'Handle is invalid');
  return ref.pool.get(ref);
}
class Handle {
  constructor(pool, ref) { handles.set(this, ref); }
  IsValid() { const ref = handles.get(this); return !!ref && ref.pool.valid(ref); }
  equals(other) {
    const a = handles.get(this), b = handles.get(other);
    return !!a && !!b && a.pool === b.pool && a.index === b.index && a.generation === b.generation;
  }
}
export class Transform extends Handle {
  GetPos() { return new Vec3(value(this).pos); }
  SetPos(v) { requireVec3(v); value(this).pos.data.set(v.data); }
  GetRot() { return new Vec3(value(this).rot); }
  SetRot(v) { requireVec3(v); const state = value(this); state.rot.data.set(v.data); state.local = undefined; }
  GetScale() { return new Vec3(value(this).scale); }
  SetScale(v) { requireVec3(v); const state = value(this); state.scale.data.set(v.data); state.local = undefined; }
  GetPosRot() { return [this.GetPos(), this.GetRot()]; }
  SetPosRot(p, r) { requireVec3(p); requireVec3(r); this.SetPos(p); this.SetRot(r); }
  GetParent() { const v = value(this); return new Node(v.nodes, v.parent); }
  SetParent(node) {
    const v = value(this), parent = token(node, v.nodes);
    let cursor = node;
    for (let depth = 0; cursor.IsValid(); ++depth) {
      requireCondition(depth < profile.limits.maxHierarchyDepth, 'HIERARCHY_DEPTH', 'Transform hierarchy is too deep');
      const transform = cursor.GetTransform();
      requireCondition(!transform.equals(this), 'HIERARCHY_CYCLE', 'Transform parenting would create a cycle');
      if (!transform.IsValid()) break;
      cursor = transform.GetParent();
    }
    v.parent = parent;
  }
  ClearParent() { value(this).parent = undefined; }
  GetWorld() {
    const first = value(this);
    if(first.nativeWorldCache)return new Mat4(first.world??Mat4.Identity);
    if (!first.nodes.valid(first.parent)) return new Mat4(localMatrix(first));
    const chain = [], seen = new Set(); let transform = this;
    while (transform.IsValid()) {
      const v = value(transform);
      requireCondition(!seen.has(v) && chain.length < profile.limits.maxHierarchyDepth, 'HIERARCHY_CYCLE', 'Invalid transform hierarchy');
      seen.add(v); chain.push(localMatrix(v));
      const parent = transform.GetParent();
      if (!parent.IsValid()) break;
      transform = parent.GetTransform();
    }
    // Validate the starting handle even when the loop above did not execute.
    value(this);
    let world = Mat4.Identity;
    for (const local of chain.reverse()) world = world.mul(local);
    return world;
  }
}
function localMatrix(state) {
  state.local ??= TransformationMat4(state.pos, state.rot, state.scale);
  state.local.data.set(state.pos.data, 9);
  return state.local;
}
// Internal bridge for native CreateCamera/CreateObject/CreateSpotLight helpers.
// Preserve the supplied affine matrix and expose decomposed TRS values.
export function setTransformMatrix(transform, matrix) {
  requireCondition(matrix instanceof Mat4, 'INVALID_ARGUMENT', 'Expected Mat4');
  const state=value(transform), m=matrix.data;
  let sx=Math.hypot(...m.slice(0,3)), sy=Math.hypot(...m.slice(3,6)), sz=Math.hypot(...m.slice(6,9));
  requireCondition(sx>0&&sy>0&&sz>0,'INVALID_TRANSFORM','Singular matrix');
  const determinant=m[0]*(m[4]*m[8]-m[5]*m[7])-m[3]*(m[1]*m[8]-m[2]*m[7])+m[6]*(m[1]*m[5]-m[2]*m[4]);
  if(determinant<0) sx=-sx;
  const x=Math.asin(Math.max(-1,Math.min(1,-m[7]/sz))), cx=Math.cos(x);
  const y=Math.abs(cx)>1e-6?Math.atan2(m[6]/sz,m[8]/sz):Math.atan2(-m[2]/sx,m[0]/sx);
  const z=Math.abs(cx)>1e-6?Math.atan2(m[1]/sx,m[4]/sy):0;
  state.pos=new Vec3(m[9],m[10],m[11]); state.rot=new Vec3(x,y,z); state.scale=new Vec3(sx,sy,sz); state.local=new Mat4(matrix);
}
// Renderer-only borrowed storage; public GetWorld() continues to return a copy.
export function transformWorldData(transform) {
  const state=value(transform);
  if(state.nativeWorldCache)return (state.world??Mat4.Identity).data;
  return state.nodes.valid(state.parent)?transform.GetWorld().data:localMatrix(state).data;
}
function requireVec3(v) { requireCondition(v instanceof Vec3, 'INVALID_ARGUMENT', 'Expected Vec3'); }
// Internal renderer iteration bypasses public native NodeList value copies.
export function allSceneNodes(scene) {return Scene.prototype.GetAllNodes.call(scene);}
export class Node extends Handle {
  GetName() { return value(this).name; }
  SetName(name) { requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name'); value(this).name = name; }
  GetTransform() { const v = value(this); return new Transform(v.transforms, v.transform); }
  SetTransform(transform) {
    const v = value(this), next = token(transform, v.transforms), previous = v.transform;
    v.transform = next;
    try { transform.GetWorld(); } catch (error) { v.transform = previous; throw error; }
  }
  GetCamera() { const v = value(this); return new Camera(v.cameras, v.camera); }
  SetCamera(camera) { const v = value(this); v.camera = token(camera, v.cameras); }
  GetObject() { const v = value(this); return new ObjectComponent(v.objects, v.object); }
  SetObject(object) { const v = value(this); v.object = token(object, v.objects); }
  GetLight() { const v = value(this); return new Light(v.lights, v.light); }
  SetLight(light) { const v = value(this); v.light = token(light,v.lights); }
  GetInstance() { const v=value(this);return new Instance(v.instances,v.instance); }
  SetInstance(instance) { const v=value(this);v.instance=token(instance,v.instances); }
  IsInstantiatedBy() { const v=value(this);return new Node(v.nodes,v.instanceOwner); }
  GetInstanceSceneView() { return value(this).instanceView??new SceneView([]); }
  DestroyInstance() { destroyInstanceContent(value(this)); }
  GetInstanceSceneAnim(name) {
    requireCondition(typeof name==='string','INVALID_ARGUMENT','Expected animation name');
    const v=value(this);
    return (v.instanceAnimations??[]).find(ref=>GetSceneAnimInfo(v.animationScene,ref).name===name&&GetSceneAnimInfo(v.animationScene,ref).valid)??InvalidSceneAnimRef;
  }
  IsEnabled() { const v=value(this);return v.enabled&&!v.instanceDisabled; }
  IsItselfEnabled() { return value(this).enabled; }
  Enable() { value(this).enabled = true;if(this.IsEnabled())setInstanceEnabled(this,true); }
  Disable() { value(this).enabled = false;setInstanceEnabled(this,false); }
}
function destroyInstanceContent(state) {
  const children=state.instanceView?.GetNodes();if(!children)return;
  state.instanceView=undefined;
  removeAnimations(state.animationScene,state.instanceAnimations??[]);state.instanceAnimations=[];
  for(let i=0;i<children.length;++i) {
    const child=children.get(i);if(child.IsValid())state.animationScene.DestroyNode(child);
  }
}
function setInstanceEnabled(root,enabled) {
  const children=value(root).instanceView?.GetNodes();
  for(let i=0;i<(children?.length??0);++i) {const child=children.get(i);if(!child.IsValid())continue;
    value(child).instanceDisabled=!enabled;
    if(!enabled||child.IsEnabled())setInstanceEnabled(child,enabled);
  }
}
export class NodeList {
  #nodes;
  constructor(sequence=[]) {
    requireCondition(Array.isArray(sequence)&&sequence.every(node=>node instanceof Node),'INVALID_ARGUMENT','NodeList expects an array of Node values');
    this.#nodes=sequence.slice();
  }
  get length(){return this.#nodes.length;}
  size(){return BigInt(this.length);}
  clear(){this.#nodes.length=0;}
  reserve(count){integer(Number(count),0,4294967295,'capacity');}
  push_back(node){requireCondition(node instanceof Node,'INVALID_ARGUMENT','Expected Node');this.#nodes.push(node);}
  at(index){return this.get(index);}
  get(index){const node=this.#nodes[integer(Number(index),0,this.length-1,'node index')],ref=handles.get(node);return new Node(ref?.pool,ref);}
  set(index,node){requireCondition(node instanceof Node,'INVALID_ARGUMENT','Expected Node');this.#nodes[integer(Number(index),0,this.length-1,'node index')]=node;}
  equals(other){return other instanceof NodeList&&this.length===other.length&&this.#nodes.every((node,i)=>node.equals(other.#nodes[i]));}
}
export class Instance extends Handle {
  GetPath() { return value(this).path; }
  SetPath(path) { requireCondition(typeof path==='string','INVALID_ARGUMENT','Expected instance path');value(this).path=path; }
}
export class SceneView {
  #nodes;
  constructor(nodes) { this.#nodes=nodes.slice(); }
  GetNodes() { return new NodeList(this.#nodes); }
  GetNode(scene,name) { return this.#nodes.find(node=>node.IsValid()&&node.GetName()===name)??new Node(); }
}
export function attachInstanceView(root,children,scene,animations=[]) {
  const owner=handles.get(root);value(root).instanceView=new SceneView(children);
  value(root).instanceAnimations=animations;value(root).animationScene=scene;
  for(const child of children){value(child).instanceOwner=owner;value(child).instantiated=true;}
}
export class Camera extends Handle {
  GetZNear() { return value(this).near; }
  GetZFar() { return value(this).far; }
  GetFov() { return value(this).fov; }
  GetSize() { return value(this).size; }
  GetIsOrthographic() { return value(this).ortho; }
  SetFov(fov) { finite(fov); requireCondition(fov > 0 && fov < Math.PI, 'INVALID_CAMERA', 'FOV must be in (0, pi)'); value(this).fov = fov; }
  SetSize(size) { finite(size); requireCondition(size > 0, 'INVALID_CAMERA', 'Orthographic size must be positive'); value(this).size = size; }
  projection(aspect) {
    const c = value(this);
    return c.ortho ? ComputeOrthographicProjectionMatrix(c.near, c.far, c.size, aspect) :
      ComputePerspectiveProjectionMatrix(c.near, c.far, FovToZoomFactor(c.fov), aspect);
  }
}
export class ObjectComponent extends Handle {
  GetModelRef() { const state=value(this); return state.modelRef ?? state.model; }
  GetMaterialCount() { return BigInt(value(this).materials.length); }
  GetMaterial(index) { const v = value(this); return v.materials[integer(index, 0, v.materials.length - 1, 'material index')]; }
  GetMaterialName(index) { const v = value(this); integer(index, 0, v.materials.length - 1, 'material index'); return v.names[index] ?? ''; }
  SetMaterialName(index, name) { const v = value(this); integer(index, 0, v.materials.length - 1, 'material index'); requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected material name'); v.names[index] = name; }
}
// Native LightType values. Serialized assets use names, decoded at the boundary.
export const LT_Point = 0, LT_Spot = 1, LT_Linear = 2;
export function setObjectModelReference(object, ref) { value(object).modelRef=ref; }
export function objectModel(object) { return value(object).model; }
export class Light extends Handle {
  GetPSSMSplit() { return new Vec4(...(value(this).pssmSplit??[10,50,100,500])); }
  SetPSSMSplit(v) { requireCondition(v instanceof Vec4&&v.data.every((n,i)=>n>0&&(i===0||n>v.data[i-1])),'INVALID_LIGHT','Expected increasing shadow splits');value(this).pssmSplit=[...v.data]; }
  GetShadowType() { return value(this).shadowType ?? 0; }
  SetShadowType(type) { requireCondition(type === 0 || type === 1, 'INVALID_LIGHT', 'Unknown shadow type'); value(this).shadowType = type; }
  GetShadowBias() { return value(this).shadowBias ?? 0.0001; }
  SetShadowBias(n) { value(this).shadowBias = positiveLight(n); }
  GetShadowNear() { return value(this).shadowNear ?? 0.1; }
  SetShadowNear(n) { requireCondition(finite(n)>0, 'INVALID_LIGHT', 'Shadow near must be positive'); value(this).shadowNear = n; }
  GetShadowFar() { return value(this).shadowFar ?? 100; }
  SetShadowFar(n) { requireCondition(finite(n)>0, 'INVALID_LIGHT', 'Shadow far must be positive'); value(this).shadowFar = n; }
  GetType() { return value(this).type; }
  SetType(type) { requireCondition([LT_Linear,LT_Point,LT_Spot].includes(type),'INVALID_LIGHT','Unknown light type'); value(this).type = type; }
  GetDiffuseColor() { return new Color(...value(this).diffuse.data); }
  SetDiffuseColor(color) { requireLightColor(color); value(this).diffuse = new Color(...color.data); }
  GetSpecularColor() { return new Color(...value(this).specular.data); }
  SetSpecularColor(color) { requireLightColor(color); value(this).specular = new Color(...color.data); }
  GetDiffuseIntensity() { return value(this).diffuseIntensity; }
  SetDiffuseIntensity(n) { value(this).diffuseIntensity = positiveLight(n); }
  GetSpecularIntensity() { return value(this).specularIntensity; }
  SetSpecularIntensity(n) { value(this).specularIntensity = positiveLight(n); }
  GetRadius() { return value(this).radius; }
  SetRadius(n) { value(this).radius = positiveLight(n); }
  GetInnerAngle() { return value(this).inner; }
  SetInnerAngle(n) { requireCondition(finite(n) >= 0 && n <= Math.PI/2,'INVALID_LIGHT','Invalid inner angle'); value(this).inner = n; }
  GetOuterAngle() { return value(this).outer; }
  SetOuterAngle(n) { requireCondition(finite(n) >= 0 && n <= Math.PI/2,'INVALID_LIGHT','Invalid outer angle'); value(this).outer = n; }
  GetPriority() { return value(this).priority; }
  SetPriority(n) { value(this).priority = lightFloat(n); }
}
function lightFloat(n) { const value = Math.fround(finite(n)); requireCondition(Number.isFinite(value),'INVALID_LIGHT','Light value exceeds float32 range'); return value; }
function positiveLight(n) { const value = lightFloat(n); requireCondition(value >= 0,'INVALID_LIGHT','Expected a nonnegative light value'); return value; }
function requireLightColor(color) { requireCondition(color instanceof Color && color.data.every(n => Number.isFinite(n) && n >= 0),'INVALID_LIGHT','Expected a nonnegative Color'); }
export class Scene {
  #nodes = new HandlePool();
  #transforms = new HandlePool();
  #cameras = new HandlePool(); #objects = new HandlePool(); #currentCamera;
  #lights = new HandlePool();
  #instances = new HandlePool();
  #orphanInstances = [];
  #owned = [];
  #order = [];
  #nodeWrappers;
  #disposed = false;
  #maxNodes;
  #nativeWorldCache;
  constructor({maxNodes = profile.limits.maxNodes,nativeWorldCache=false} = {}) {
    this.#maxNodes = integer(maxNodes, 1, 16384, 'scene node limit');
    this.#nativeWorldCache=nativeWorldCache;
  }
  canvas = {clear_color: true, clear_z: true, color: new Color(0.05, 0.06, 0.08)};
  metadata = {};
  environment = {ambient:Color.Black, fog_near:0, fog_far:0, fog_color:Color.Black};
  #assertAlive() { requireCondition(!this.#disposed, 'DISPOSED', 'Scene is disposed'); }
  CreateNode(name = '') {
    this.#assertAlive();
    requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name');
    requireCondition(this.#nodes.size < this.#maxNodes, 'RESOURCE_BUDGET', 'Scene node budget exceeded');
    const ref = this.#nodes.allocate({name, nodes:this.#nodes, transforms: this.#transforms, cameras: this.#cameras, objects: this.#objects, lights:this.#lights, instances:this.#instances, transform: undefined, enabled: true});
    this.#order.push(ref);
    this.#nodeWrappers=undefined;
    return new Node(this.#nodes, ref);
  }
  GetNode(name) {
    this.#assertAlive();
    return new Node(this.#nodes, this.#order.find(t => this.#nodes.valid(t) && this.#nodes.get(t).name === name));
  }
  GetAllNodes() { this.#assertAlive(); this.#nodeWrappers??=this.#order.filter(t=>this.#nodes.valid(t)).map(t=>new Node(this.#nodes,t)); return this.#nodeWrappers.slice(); }
  GetNodes() { const all=Scene.prototype.GetAllNodes.call(this);return all.filter(n=>!value(n).instantiated); }
  GetNodeCount() { this.#assertAlive(); return BigInt(Scene.prototype.GetNodes.call(this).length); }
  GetAllNodeCount() { this.#assertAlive(); return BigInt(this.#nodes.size); }
  DestroyNode(node) {
    const ref = token(node, this.#nodes);
    const state=this.#nodes.get(ref);
    if(state.instanceView)this.#orphanInstances.push(state);
    try { notifyDestruction(ref); }
    finally {
      if (this.#nodes.valid(ref)) this.#nodes.release(ref);
      this.#order = this.#order.filter(t => t !== ref);
      this.#nodeWrappers=undefined;
    }
  }
  CreateTransform(pos = Vec3.Zero, rot = Vec3.Zero, scale = Vec3.One) {
    this.#assertAlive();
    [pos, rot, scale].forEach(requireVec3);
    return new Transform(this.#transforms, this.#transforms.allocate({pos: new Vec3(pos), rot: new Vec3(rot), scale: new Vec3(scale), nodes: this.#nodes,nativeWorldCache:this.#nativeWorldCache}));
  }
  DestroyTransform(transform) { this.#transforms.release(token(transform, this.#transforms)); }
  CreateCamera(near = 0.01, far = 1000, fov) {
    fov ??= arguments.length === 0 ? Deg(40) : Deg(45);
    this.#assertAlive(); [near, far, fov].forEach(v => finite(v));
    requireCondition(near > 0 && far > near && fov > 0 && fov < Math.PI, 'INVALID_CAMERA', 'Invalid camera range/FOV');
    return new Camera(this.#cameras, this.#cameras.allocate({near, far, fov, size: 1, ortho: false}));
  }
  CreateOrthographicCamera(near = 0.01, far = 1000, size = 1) {
    this.#assertAlive(); [near, far, size].forEach(v => finite(v));
    requireCondition(near >= 0 && far > near && size > 0, 'INVALID_CAMERA', 'Invalid orthographic camera');
    return new Camera(this.#cameras, this.#cameras.allocate({near, far, fov: Deg(40), size, ortho: true}));
  }
  DestroyCamera(camera) { this.#cameras.release(token(camera, this.#cameras)); }
  SetCurrentCamera(node) { const ref = token(node, this.#nodes); requireCondition(node.GetCamera().IsValid(), 'INVALID_CAMERA', 'Node has no camera'); this.#currentCamera = ref; }
  GetCurrentCamera() { this.#assertAlive(); return new Node(this.#nodes, this.#currentCamera); }
  ComputeCurrentCameraViewState(aspect) {
    const node = this.GetCurrentCamera(), camera = node.GetCamera();
    const [ok, view] = Inverse(node.GetTransform().GetWorld());
    requireCondition(ok, 'INVALID_CAMERA', 'Camera world transform is singular');
    const proj = camera.projection(aspect);
    return {view, proj, viewProjection: proj.mul(new Mat44(view))};
  }
  CreateObject(model, materials) {
    this.#assertAlive();
    requireCondition(model?.IsValid() && Array.isArray(materials) && materials.length > 0, 'INVALID_OBJECT', 'Valid model and materials required');
    requireCondition(materials.every(material => material instanceof Material),'INVALID_MATERIAL','Objects require validated Material instances');
    for (const submesh of model.submeshes) requireCondition(submesh.material < materials.length, 'INVALID_MATERIAL_SLOT', 'Model references a missing material slot');
    return new ObjectComponent(this.#objects, this.#objects.allocate({model, materials: [...materials], names: []}));
  }
  DestroyObject(object) { this.#objects.release(token(object, this.#objects)); }
  CreateLight() {
    this.#assertAlive();
    return new Light(this.#lights,this.#lights.allocate({type:LT_Point,diffuse:Color.White,specular:Color.White,
      diffuseIntensity:1,specularIntensity:1,radius:0,inner:Deg(30),outer:Deg(45),priority:0}));
  }
  DestroyLight(light) { this.#lights.release(token(light,this.#lights)); }
  CreateInstance(path='') { this.#assertAlive();return new Instance(this.#instances,this.#instances.allocate({path})); }
  DestroyInstance(instance) { this.#instances.release(token(instance,this.#instances)); }
  GarbageCollect() {
    this.#assertAlive();let count=0;
    // Native DestroyNode leaves instance views until garbage collection.
    while(this.#orphanInstances.length) {
      const before=this.#nodes.size;destroyInstanceContent(this.#orphanInstances.pop());count+=before-this.#nodes.size;
    }
    for(const [key,pool] of [['transform',this.#transforms],['camera',this.#cameras],['object',this.#objects],['light',this.#lights],['instance',this.#instances]]) {
      const references=[];this.#nodes.forEach(state=>references.push(state[key]));count+=pool.collect(references);
    }
    return BigInt(count);
  }
  GetLights() {
    this.#assertAlive(); const result=[];
    for(const ref of this.#order) if(this.#nodes.valid(ref) && this.#lights.valid(this.#nodes.get(ref).light)) result.push(new Node(this.#nodes,ref));
    return result;
  }
  own(resource) { this.#assertAlive(); this.#owned.push(resource); return resource; }
  Update(dt) {
    this.#assertAlive(); time_from_ns(dt);
    if(this.#nativeWorldCache) {this.ReadyWorldMatrices();this.ComputeWorldMatrices();return;}
    // Populate local caches. World queries compose the current parent chain;
    // authored animations are not part of this scene implementation.
    for (const ref of this.#order) {
      if(!this.#nodes.valid(ref)) continue;
      const transform=this.#nodes.get(ref).transform;
      if(this.#transforms.valid(transform)) localMatrix(this.#transforms.get(transform));
    }
  }
  ReadyWorldMatrices() {
    this.#assertAlive();
    this.#transforms.forEach(state=>{state.worldReady=false;});
  }
  ComputeWorldMatrices() {
    this.#assertAlive();
    const compute=(state,depth=0)=>{
      requireCondition(depth<profile.limits.maxHierarchyDepth,'HIERARCHY_CYCLE','Invalid transform hierarchy');
      if(state.worldReady)return state.world;
      let world=localMatrix(state);
      if(this.#nodes.valid(state.parent)) {
        const parent=this.#nodes.get(state.parent).transform;
        if(this.#transforms.valid(parent))world=compute(this.#transforms.get(parent),depth+1).mul(world);
      }
      state.world??=new Mat4();state.world.data.set(world.data);state.worldReady=true;return state.world;
    };
    this.#transforms.forEach(state=>compute(state));
  }
  Clear() {
    this.#assertAlive();
    this.#orphanInstances.length=0;
    const errors = [];
    for (const ref of [...this.#order]) { try { notifyDestruction(ref); } catch (e) { errors.push(e); } }
    this.#nodes.dispose(); this.#transforms.dispose(); this.#cameras.dispose(); this.#objects.dispose(); this.#lights.dispose();this.#instances.dispose();
    this.#nodes = new HandlePool(); this.#transforms = new HandlePool(); this.#cameras = new HandlePool();
    this.#objects = new HandlePool(); this.#lights = new HandlePool();this.#instances=new HandlePool(); this.#order.length = 0; this.#currentCamera = undefined; this.#nodeWrappers=undefined;
    this.environment = {ambient:Color.Black,fog_near:0,fog_far:0,fog_color:Color.Black}; this.metadata = {};
    for (const resource of this.#owned.splice(0).reverse()) { try { resource.dispose(); } catch (e) { errors.push(e); } }
    if (errors.length) throw new AggregateError(errors, 'Scene clearing failed');
  }
  get stats() { return {nodes: this.#nodes.size, transforms: this.#transforms.size, cameras: this.#cameras.size, objects: this.#objects.size, lights:this.#lights.size}; }
  dispose() {
    if (this.#disposed) return;
    this.#orphanInstances.length=0;
    this.#disposed = true;
    const errors = [];
    for (const ref of [...this.#order]) { try { notifyDestruction(ref); } catch (e) { errors.push(e); } }
    this.#nodes.dispose(); this.#transforms.dispose(); this.#cameras.dispose(); this.#objects.dispose(); this.#lights.dispose();this.#instances.dispose(); this.#order.length = 0; this.#nodeWrappers=undefined;
    for (const owned of this.#owned.splice(0).reverse()) { try { owned.dispose(); } catch (e) { errors.push(e); } }
    if (errors.length) throw new AggregateError(errors, 'Scene destruction callback failed');
  }
}
