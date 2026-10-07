import {integer,requireCondition} from '../core/errors.js';
import {Vec3,Mat3,ToEuler} from '../core/math.js';
import {time_from_ns,time_to_sec_f} from '../core/time.js';
import {validateAnimations} from './animation-schema.js';

export const ALM_Once=0,ALM_Infinite=1,ALM_Loop=2,E_Linear=0;
export const UnspecifiedAnimTime=9223372036854775807n;
const references=new WeakMap(),states=new WeakMap();
export class SceneAnimRef {
  equals(other){return other instanceof SceneAnimRef&&references.get(this)===references.get(other);}
  notEquals(other){return !this.equals(other);}
}
export class ScenePlayAnimRef {
  equals(other){return other instanceof ScenePlayAnimRef&&references.get(this)===references.get(other);}
  notEquals(other){return !this.equals(other);}
}
export const InvalidSceneAnimRef=Object.freeze(new SceneAnimRef());
export const InvalidScenePlayAnimRef=Object.freeze(new ScenePlayAnimRef());
class NativeList {
  #values=[];
  constructor(type,values=[]) {this.type=type;for(const value of values)this.push_back(value);}
  check(value){requireCondition(this.type==='string'?typeof value==='string':value instanceof this.type,'INVALID_ARGUMENT','Invalid list value');}
  get length(){return this.#values.length;}
  size(){return BigInt(this.length);}
  clear(){this.#values.length=0;}
  reserve(count){integer(Number(count),0,4294967295,'capacity');}
  push_back(value){this.check(value);this.#values.push(value);}
  get(index){return this.#values[integer(Number(index),0,this.length-1,'list index')];}
  at(index){return this.get(index);}
  set(index,value){this.check(value);this.#values[integer(Number(index),0,this.length-1,'list index')]=value;}
  equals(other){return other instanceof this.constructor&&other.length===this.length&&this.#values.every((v,i)=>typeof v==='string'?v===other.get(i):v.equals(other.get(i)));}
}
export class SceneAnimRefList extends NativeList {constructor(values=[]){super(SceneAnimRef,values);}}
export class ScenePlayAnimRefList extends NativeList {constructor(values=[]){super(ScenePlayAnimRef,values);}}
export class StringList extends NativeList {constructor(values=[]){super('string',values);}}
function state(scene) {
  scene.GetAllNodeCount(); // also rejects a disposed scene
  if(!states.has(scene))states.set(scene,{clips:new Map(),players:new Map()});
  return states.get(scene);
}
const refFor=(Type,record)=>{const ref=new Type();references.set(ref,record);return ref;};
export function clearAnimations(scene) {states.delete(scene);}
export function removeAnimations(scene,refs) {
  const s=states.get(scene);if(!s)return;
  for(const ref of refs) {
    const clip=references.get(ref);s.clips.delete(clip);
    for(const [key,play] of s.players)if(play.clip===clip)s.players.delete(key);
  }
}
export function addAnimations(scene,body,nodes,instantiated=false) {
  validateAnimations(body);
  const s=state(scene),tracks=new Map((body.anims??[]).map(a=>[a.idx,prepare(a.anim)])),refs=[];
  requireCondition(s.clips.size+(body.scene_anims?.length??0)<=16384,'RESOURCE_BUDGET','Animation clip budget exceeded');
  for(const source of body.scene_anims??[]) {
    const clip={name:source.name,start:BigInt(source.t_start),end:BigInt(source.t_end),frame:BigInt(source.frame_duration??0),instantiated,
      bindings:(source.node_anims??[]).filter(b=>nodes.has(b.node)).map(b=>({node:nodes.get(b.node),tracks:tracks.get(b.anim)}))};
    const ref=refFor(SceneAnimRef,clip);clip.ref=ref;s.clips.set(clip,clip);refs.push(ref);
  }
  return refs;
}
function prepare(anim) {
  const quaternion=anim.flags?anim.flags.includes('UseQuaternionForRotation'):!!anim.quat?.length;
  const out=[];
  for(const kind of ['bool','vec3','quat'])for(const track of anim[kind]??[]) {
    if(track.target==='Rotation'&&(kind==='quat')!==quaternion)continue;
    out.push({kind,target:track.target,keys:(track.keys??[]).map(k=>({...k,t:BigInt(k.t),tension:Math.fround(k.tension??0),bias:Math.fround(k.bias??0),
      v:Array.isArray(k.v)?k.v.map(Math.fround):k.v}))});
  }
  return out;
}
// Match engine/animation.h: Hermite TRS; quaternion component lerp followed
// by normalization in the transform evaluator (not spherical interpolation).
function sample(track,t) {
  const keys=track.keys;if(!keys.length)return undefined;
  let lo=0,hi=keys.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(keys[mid].t<=t)lo=mid+1;else hi=mid;}
  const i=Math.max(0,lo-1),a=keys[i];
  if(lo===0||lo===keys.length||track.kind==='bool')return a.v;
  const b=keys[lo],u=Math.fround(time_to_sec_f(t-a.t)/time_to_sec_f(b.t-a.t));
  if(track.kind==='quat')return a.v.map((v,j)=>Math.fround(v+Math.fround((b.v[j]-v)*u)));
  const p=keys[Math.max(0,i-1)].v,n=keys[Math.min(keys.length-1,lo+1)].v;
  const u2=u*u,u3=u2*u,tension=a.tension,bias=a.bias;
  return a.v.map((v,j)=>{
    const m0=((v-p[j])*(1+bias)+(b.v[j]-v)*(1-bias))*(1-tension)/2;
    const m1=((b.v[j]-v)*(1+bias)+(n[j]-b.v[j])*(1-bias))*(1-tension)/2;
    return v*(2*u3-3*u2+1)+m0*(u3-2*u2+u)+m1*(u3-u2)+b.v[j]*(-2*u3+3*u2);
  });
}
function quaternionEuler(q) {
  const [x,y,z,w]=q,n=x*x+y*y+z*z+w*w;
  requireCondition(n>0&&Number.isFinite(n),'INVALID_ANIMATION','Degenerate quaternion interpolation');
  return ToEuler(new Mat3((x*x-y*y-z*z+w*w)/n,2*(x*y+z*w)/n,2*(x*z-y*w)/n,
    2*(x*y-z*w)/n,(-x*x+y*y-z*z+w*w)/n,2*(y*z+x*w)/n,
    2*(x*z+y*w)/n,2*(y*z-x*w)/n,(-x*x-y*y+z*z+w*w)/n));
}
function evaluate(clip,t) {
  for(const {node,tracks} of clip.bindings) {
    if(!node.IsValid())continue;
    const transform=node.GetTransform();
    for(const track of tracks) {
      const v=sample(track,t);if(v===undefined)continue;
      if(track.kind==='bool'){v?node.Enable():node.Disable();continue;}
      if(!transform.IsValid())continue;
      if(track.target==='Position')transform.SetPos(new Vec3(...v));
      else if(track.target==='Scale')transform.SetScale(new Vec3(...v));
      else transform.SetRot(track.kind==='quat'?quaternionEuler(v):new Vec3(...v));
    }
  }
}
export class SceneAnimInfo {
  constructor(){Object.assign(this,{valid:false,name:'',t_start:0n,t_end:0n,frame_duration:0n});}
}
export function GetSceneAnimInfo(scene,ref) {
  requireCondition(ref instanceof SceneAnimRef,'INVALID_ARGUMENT','Expected SceneAnimRef');
  const clip=state(scene).clips.get(references.get(ref)),info=new SceneAnimInfo();
  if(clip)Object.assign(info,{valid:true,name:clip.name,t_start:clip.start,t_end:clip.end,frame_duration:clip.frame});
  return info;
}
export const animationMethods={
  GetSceneAnims(){return new SceneAnimRefList([...state(this).clips.values()].filter(c=>!c.instantiated).map(c=>c.ref));},
  GetSceneAnim(name){
    requireCondition(typeof name==='string','INVALID_ARGUMENT','Expected animation name');
    return [...state(this).clips.values()].find(c=>!c.instantiated&&c.name===name)?.ref??InvalidSceneAnimRef;
  },
  PlayAnim(ref,loop=ALM_Once,easing=E_Linear,start=UnspecifiedAnimTime,end=UnspecifiedAnimTime,paused=false,scale=1) {
    requireCondition(ref instanceof SceneAnimRef&&typeof paused==='boolean'&&Number.isFinite(scale),'INVALID_ARGUMENT','Expected native PlayAnim arguments');
    time_from_ns(start);time_from_ns(end);integer(loop,0,2,'animation loop mode');
    requireCondition(easing===E_Linear,'UNSUPPORTED_ANIMATION','Only E_Linear playback is supported');
    const s=state(this),clip=s.clips.get(references.get(ref));if(!clip)return InvalidScenePlayAnimRef;
    start=start===UnspecifiedAnimTime?clip.start:start;end=end===UnspecifiedAnimTime?clip.end:end;
    requireCondition(end>=start,'INVALID_ARGUMENT','Reversed playback time range');
    // Native playback stores speed in sixteenths in a signed 8-bit field.
    const speed=Math.trunc(Math.fround(scale)*16);
    integer(speed,-128,127,'animation speed in sixteenths');
    requireCondition(s.players.size<16384,'RESOURCE_BUDGET','Animation player budget exceeded');
    const play={clip,start,end,t:start,speed:BigInt(speed),loop,paused};
    const result=refFor(ScenePlayAnimRef,play);play.ref=result;s.players.set(play,play);return result;
  },
  IsPlaying(ref){requireCondition(ref instanceof ScenePlayAnimRef,'INVALID_ARGUMENT','Expected ScenePlayAnimRef');return state(this).players.has(references.get(ref));},
  StopAnim(ref){requireCondition(ref instanceof ScenePlayAnimRef,'INVALID_ARGUMENT','Expected ScenePlayAnimRef');state(this).players.delete(references.get(ref));},
  StopAllAnims(){state(this).players.clear();},
  GetPlayingAnimNames(){return new StringList([...state(this).players.values()].map(p=>p.clip.name));},
  GetPlayingAnimRefs(){return new ScenePlayAnimRefList([...state(this).players.values()].map(p=>p.ref));},
  UpdatePlayingAnims(dt) {
    time_from_ns(dt);const s=state(this);
    for(const [key,p] of s.players) {
      if(!p.paused)p.t+=(dt*p.speed)>>4n;
      const duration=p.end-p.start;let finished=false;
      if(p.loop===ALM_Loop) {
        if(duration===0n)p.t=p.start;
        else if(p.speed>=0n&&p.t>=p.end)p.t=p.start+(p.t-p.start)%duration;
        else if(p.speed<0n&&p.t<=p.start)p.t=p.end-(p.start-p.t)%duration;
      } else if(p.loop===ALM_Once) {
        if(p.speed>=0n&&p.t>=p.end){p.t=p.end;finished=true;}
        else if(p.speed<0n&&p.t<=p.start){p.t=p.start;finished=true;}
      }
      evaluate(p.clip,p.t);if(finished)s.players.delete(key);
    }
  }
};
