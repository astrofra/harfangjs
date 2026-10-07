import * as hg from '../../src/index.js';
import {addAnimations,removeAnimations} from '../../src/scene/animation.js';
import {validateAnimations} from '../../src/scene/animation-schema.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const near=(a,b,message)=>check(Math.abs(a-b)<1e-5,`${message}: ${a} != ${b}`);
const rejects=(fn,code)=>{try{fn();}catch(e){check(e.code===code,`${code}: ${e}`);return;}throw Error(`Expected ${code}`);};
const key=(t,x)=>({t,v:[x,0,0],tension:0,bias:0});
function fixture() {
  return {nodes:[{idx:7}],anims:[{idx:19,anim:{t_start:0,t_end:2000000000,flags:[],
    vec3:[{target:'Position',keys:[key(0,0),key(1000000000,10),key(2000000000,20)]}]}}],
    scene_anims:[{name:'motion',t_start:0,t_end:2000000000,frame_duration:50000000,anim:4294967295,node_anims:[{node:7,anim:19}]}]};
}
export function run() {
  const scene=new hg.Scene(),node=scene.CreateNode('animated');node.SetTransform(scene.CreateTransform());
  const body=fixture(),[clip]=addAnimations(scene,body,new Map([[7,node]])),transform=node.GetTransform();
  check(scene.GetSceneAnims().size()===1n&&scene.GetSceneAnim('motion').equals(clip),'Clip lookup/list');
  check(hg.GetSceneAnimInfo(scene,clip).t_end===2000000000n,'Native clip info');
  check(scene.GetSceneAnim('missing').equals(hg.InvalidSceneAnimRef),'Missing clip');
  check(scene.PlayAnim(hg.InvalidSceneAnimRef).equals(hg.InvalidScenePlayAnimRef),'Invalid playback');
  let play=scene.PlayAnim(clip);scene.Update(500000000n);
  near(transform.GetPos().x,4.375,'Native Hermite at half segment');
  near(hg.GetT(transform.GetWorld()).x,4.375,'World matrix updated after animation');
  scene.Update(1500000000n);near(transform.GetPos().x,20,'Once evaluates endpoint');check(!scene.IsPlaying(play),'Once stops');
  play=scene.PlayAnim(clip,hg.ALM_Loop);scene.Update(2000000000n);near(transform.GetPos().x,0,'Loop wraps exact endpoint');
  scene.Update(20500000000n);near(transform.GetPos().x,4.375,'Loop wraps multiple periods');
  check(scene.IsPlaying(play)&&scene.GetPlayingAnimNames().get(0)==='motion','Playing list');scene.StopAllAnims();
  play=scene.PlayAnim(clip,hg.ALM_Infinite);scene.Update(3000000000n);near(transform.GetPos().x,20,'Infinite clamps sample');
  check(scene.IsPlaying(play),'Infinite remains active');scene.StopAnim(play);check(!scene.IsPlaying(play),'Stop removes player');
  play=scene.PlayAnim(clip,hg.ALM_Loop,hg.E_Linear,hg.UnspecifiedAnimTime,hg.UnspecifiedAnimTime,true);
  scene.Update(500000000n);near(transform.GetPos().x,0,'Paused player holds start');scene.StopAllAnims();
  play=scene.PlayAnim(clip,hg.ALM_Loop,hg.E_Linear,0n,2000000000n,false,-1);
  scene.Update(500000000n);near(transform.GetPos().x,15.625,'Reverse loop');scene.StopAllAnims();
  play=scene.PlayAnim(clip,hg.ALM_Loop,hg.E_Linear,0n,2000000000n,false,.51);
  scene.Update(1000000000n);near(transform.GetPos().x,4.375,'Native speed quantization to sixteenths');scene.StopAllAnims();
  scene.PlayAnim(clip,hg.ALM_Loop,hg.E_Linear,1000000000n,1000000000n);scene.Update(5000000000n);
  near(transform.GetPos().x,10,'Zero-duration loop holds pose');scene.StopAllAnims();
  rejects(()=>scene.PlayAnim(clip,hg.ALM_Loop,1),'UNSUPPORTED_ANIMATION');
  rejects(()=>scene.PlayAnim(clip,hg.ALM_Loop,0,2n,1n),'INVALID_ARGUMENT');
  const other=new hg.Scene();check(!other.IsPlaying(scene.PlayAnim(clip)),'Cross-scene player rejected');
  check(other.PlayAnim(clip).equals(hg.InvalidScenePlayAnimRef),'Cross-scene clip rejected');scene.StopAllAnims();

  const quaternion=fixture();quaternion.scene_anims[0].name='rotation';
  quaternion.anims[0].anim={t_start:0,t_end:1000000000,flags:['UseQuaternionForRotation'],
    quat:[{target:'Rotation',keys:[{t:0,v:[0,0,0,1]},{t:1000000000,v:[0,1,0,0]}]}],
    bool:[{target:'Enable',keys:[{t:0,v:true},{t:1000000000,v:false}]}]};
  const [qclip]=addAnimations(scene,quaternion,new Map([[7,node]]));scene.PlayAnim(qclip);scene.Update(500000000n);
  near(transform.GetRot().y,Math.PI/2,'Normalized quaternion lerp');check(node.IsEnabled(),'Boolean step before key');
  scene.Update(500000000n);check(!node.IsEnabled(),'Boolean step at key');scene.StopAllAnims();

  const second=scene.CreateNode('second');second.SetTransform(scene.CreateTransform());
  const [instanceClip]=addAnimations(scene,body,new Map([[7,second]]),true);
  check(scene.GetSceneAnims().length===2,'Instance clips hidden from scene lookup');
  scene.PlayAnim(instanceClip);scene.Update(1000000000n);near(second.GetTransform().GetPos().x,10,'Remapped instance binding');
  removeAnimations(scene,[instanceClip]);check(scene.GetPlayingAnimRefs().length===0,'Removing instance stops its players');
  scene.PlayAnim(clip);scene.DestroyNode(node);scene.Update(10n); // dead targets must not be dereferenced
  scene.Clear();check(scene.GetSceneAnims().length===0&&!hg.GetSceneAnimInfo(scene,clip).valid,'Clear invalidates clips');
  check(!scene.IsPlaying(play)&&scene.PlayAnim(clip).equals(hg.InvalidScenePlayAnimRef),'Stale handles remain invalid');
  scene.dispose();rejects(()=>scene.GetSceneAnims(),'DISPOSED');other.dispose();

  for(const mutate of [
    x=>x.anims[0].anim.vec3[0].keys[1].t=0,
    x=>x.anims[0].anim.vec3[0].keys[1].t=Number.MAX_SAFE_INTEGER+1,
    x=>x.scene_anims[0].node_anims[0].node=42,
    x=>x.anims.push(x.anims[0])
  ]){const bad=fixture();mutate(bad);rejects(()=>validateAnimations(bad),'INVALID_ANIMATION');}
  const bad=fixture();bad.anims[0].anim.float=[];rejects(()=>validateAnimations(bad),'UNSUPPORTED_ANIMATION');
  return ['Hermite TRS and normalized quaternion lerp','boolean step tracks','once/infinite/loop/reverse/paused/zero duration',
    'native fixed-point speed','clip metadata, scoped references and lists','instance remapping and cleanup','destroyed nodes and stale handles','invalid tracks and unsupported channels'];
}
