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
