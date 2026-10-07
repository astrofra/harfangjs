import {requireCondition} from '../core/errors.js';
import {profile} from '../profile.js';

// The first animation profile covers rigid node TRS and enable tracks.
// Reject other channels instead of silently dropping authored motion.
export function validateAnimations(scene, source='scene') {
  const check=(ok,message)=>requireCondition(ok,'INVALID_ANIMATION',message,source);
  const only=(value,keys)=>{
    check(value&&typeof value==='object'&&!Array.isArray(value),'Expected animation object');
    for(const key of Object.keys(value))requireCondition(keys.includes(key),'UNSUPPORTED_ANIMATION',`Unsupported animation field: ${key}`,source);
  };
  const time=t=>check(Number.isSafeInteger(t),'Animation timestamps must be safe integer nanoseconds');
  const range=value=>{time(value.t_start);time(value.t_end);check(value.t_end>=value.t_start,'Reversed animation time range');};
  const anims=scene.anims??[],clips=scene.scene_anims??[];
  check(Array.isArray(anims)&&Array.isArray(clips),'Expected animation arrays');
  check(anims.length<=profile.limits.maxNodes&&clips.length<=profile.limits.maxNodes,'Animation budget exceeded');
  const ids=new Set(),nodes=new Set((scene.nodes??[]).map(n=>n.idx));let keyCount=0;
  for(const record of anims) {
    only(record,['idx','anim']);
    check(Number.isInteger(record.idx)&&record.idx>=0&&record.idx<4294967295&&!ids.has(record.idx),'Invalid or duplicate animation index');ids.add(record.idx);
    const a=record.anim;only(a,['t_start','t_end','flags','vec3','quat','bool']);range(a);
    check(a.flags===undefined||Array.isArray(a.flags)&&a.flags.every(f=>f==='UseQuaternionForRotation'),'Unsupported animation flags');
    for(const kind of ['vec3','quat','bool']) {
      check(a[kind]===undefined||Array.isArray(a[kind]),'Expected animation track array');
      const targets=new Set();
      for(const track of a[kind]??[]) {
        only(track,['target','keys']);
        const supported=kind==='vec3'?['Position','Rotation','Scale']:kind==='quat'?['Rotation']:['Enable'];
        requireCondition(supported.includes(track.target),'UNSUPPORTED_ANIMATION',`Unsupported ${kind} target: ${track.target}`,source);
        check(!targets.has(track.target),'Duplicate animation target');targets.add(track.target);
        check(track.keys===undefined||Array.isArray(track.keys),'Expected key array');
        let previous=-Infinity;
        for(const key of track.keys??[]) {
          only(key,kind==='vec3'?['t','v','tension','bias']:['t','v']);time(key.t);
          check(key.t>previous,'Animation key times must increase');previous=key.t;
          check(++keyCount<=1000000,'Animation key budget exceeded');
          if(kind==='bool')check(typeof key.v==='boolean','Invalid boolean key');
          else {
            check(Array.isArray(key.v)&&key.v.length===(kind==='quat'?4:3)&&key.v.every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))),'Invalid animation vector');
            if(kind==='quat')check(key.v.some(v=>Math.fround(v)!==0),'Zero quaternion');
            else check([key.tension,key.bias].every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))),'Invalid Hermite tension/bias');
          }
        }
      }
    }
  }
  for(const clip of clips) {
    only(clip,['name','t_start','t_end','frame_duration','anim','node_anims']);range(clip);
    check(typeof clip.name==='string','Invalid animation name');
    if(clip.frame_duration!==undefined){time(clip.frame_duration);check(clip.frame_duration>=0,'Invalid frame duration');}
    requireCondition(clip.anim===undefined||clip.anim===null||clip.anim===4294967295,'UNSUPPORTED_ANIMATION','Scene/environment animation channels are not supported',source);
    check(clip.node_anims===undefined||Array.isArray(clip.node_anims),'Expected node animation bindings');
    for(const binding of clip.node_anims??[]) {
      only(binding,['node','anim']);check(nodes.has(binding.node)&&ids.has(binding.anim),'Missing animation node or track');
    }
  }
}
