// Explicit temporary omissions in the native-shaped Web API.
import {Vec4} from '../core/math.js';
import {integer,requireCondition} from '../core/errors.js';
import {optionalHost} from './context.js';

const warned=new Set();
export function warnStub(feature) {
  const message=feature==='AAA'?'[HARFANG Web] AAA is a stub: using forward rendering without AAA post-processing.':
    '[HARFANG Web] Animation playback is a stub: animation tracks are ignored; scripted transforms remain active.';
  const host=optionalHost();
  if(host)host.warn(message);
  else if(!warned.has(message)){warned.add(message);console.warn(message);}
}

export const BR_Equal=0,BR_Half=1,BR_Quarter=2,BR_Eighth=3,BR_Sixteenth=4,BR_Double=5;
export const FPAAADB_None=0,FPAAADB_SSGI=1,FPAAADB_SSR=2;
export class ForwardPipelineAAAConfig {
  constructor() {
    // Only members exposed by bind_harfang.py, with native float32 defaults.
    Object.assign(this,{temporal_aa_weight:Math.fround(.1),sample_count:2,max_distance:100,z_thickness:Math.fround(.1),
      bloom_threshold:5,bloom_bias:.5,bloom_intensity:Math.fround(.1),motion_blur:1,exposure:1,gamma:Math.fround(2.2),
      dof_focus_point:0,dof_focus_length:0});
    for(let i=0;i<4;++i)this[`compositing_params${i}`]=new Vec4(0,0,0,0);
  }
}
const pipelines=new WeakMap();
export class ForwardPipelineAAA {
  Flip(viewState){requireCondition(viewState&&typeof viewState==='object','INVALID_ARGUMENT','Expected ViewState');warnStub('AAA');}
}
export function CreateForwardPipelineAAAFromAssets(path,config,ssgiRatio=BR_Half,ssrRatio=BR_Half) {
  requireCondition(typeof path==='string'&&config instanceof ForwardPipelineAAAConfig,'INVALID_ARGUMENT','Expected asset path and ForwardPipelineAAAConfig');
  integer(ssgiRatio,0,5,'SSGI ratio');integer(ssrRatio,0,5,'SSR ratio');warnStub('AAA');
  const pipeline=new ForwardPipelineAAA();pipelines.set(pipeline,{alive:true,host:optionalHost()});return pipeline;
}
export function DestroyForwardPipelineAAA(pipeline) {
  requireCondition(pipeline instanceof ForwardPipelineAAA,'INVALID_ARGUMENT','Expected ForwardPipelineAAA');
  const data=pipelines.get(pipeline);if(data)data.alive=false;
}
export function IsValid(pipeline) {
  requireCondition(pipeline instanceof ForwardPipelineAAA,'UNSUPPORTED_OVERLOAD','IsValid currently supports ForwardPipelineAAA');
  return false; // No AAA GPU resources were created.
}
export function validateAAAArguments(args) {
  requireCondition(args.length===3,'UNSUPPORTED_OVERLOAD','Expected AAA pipeline, config and frame');
  const [pipeline,config,frame]=args,data=pipelines.get(pipeline);
  requireCondition(data?.alive&&data.host===optionalHost()&&config instanceof ForwardPipelineAAAConfig,'INVALID_HANDLE','Invalid AAA forward fallback');
  integer(frame,-2147483648,2147483647,'AAA frame');warnStub('AAA');
}

export const ALM_Once=0,ALM_Infinite=1,ALM_Loop=2,E_Linear=0;
export const UnspecifiedAnimTime=9223372036854775807n;
export class SceneAnimRef {
  equals(other){return other instanceof SceneAnimRef;}
  notEquals(other){return !this.equals(other);}
}
export class ScenePlayAnimRef {
  equals(other){return other instanceof ScenePlayAnimRef;}
  notEquals(other){return !this.equals(other);}
}
export const InvalidSceneAnimRef=Object.freeze(new SceneAnimRef());
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
export const animationMethods={
  GetSceneAnims(){warnStub('animation');return new SceneAnimRefList();},
  GetSceneAnim(name){requireCondition(typeof name==='string','INVALID_ARGUMENT','Expected animation name');warnStub('animation');return InvalidSceneAnimRef;},
  PlayAnim(ref,loop=ALM_Once,easing=E_Linear,start=UnspecifiedAnimTime,end=UnspecifiedAnimTime,paused=false,scale=1){
    requireCondition(ref instanceof SceneAnimRef&&typeof start==='bigint'&&typeof end==='bigint'&&typeof paused==='boolean'&&Number.isFinite(scale),
      'INVALID_ARGUMENT','Expected native PlayAnim arguments');integer(loop,0,2,'animation loop mode');integer(easing,0,42,'easing');
    warnStub('animation');return new ScenePlayAnimRef();
  },
  IsPlaying(ref){requireCondition(ref instanceof ScenePlayAnimRef,'INVALID_ARGUMENT','Expected ScenePlayAnimRef');warnStub('animation');return false;},
  StopAnim(ref){requireCondition(ref instanceof ScenePlayAnimRef,'INVALID_ARGUMENT','Expected ScenePlayAnimRef');warnStub('animation');},
  StopAllAnims(){warnStub('animation');},
  GetPlayingAnimNames(){warnStub('animation');return new StringList();},
  GetPlayingAnimRefs(){warnStub('animation');return new ScenePlayAnimRefList();},
  UpdatePlayingAnims(dt){requireCondition(typeof dt==='bigint','INVALID_ARGUMENT','Expected nanoseconds as BigInt');warnStub('animation');},
};
