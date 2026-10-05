// The same native/Web probe runs against an empty scene: stubs never claim playback.
import * as hg from 'harfang';
export function main() {
  const config=new hg.ForwardPipelineAAAConfig(),scene=new hg.Scene();
  const names=['temporal_aa_weight','sample_count','max_distance','z_thickness','bloom_threshold','bloom_bias','bloom_intensity',
    'motion_blur','exposure','gamma','dof_focus_point','dof_focus_length'];
  const ref=scene.GetSceneAnim('missing'),play=scene.PlayAnim(ref,hg.ALM_Loop,hg.E_Linear,hg.UnspecifiedAnimTime,hg.UnspecifiedAnimTime,false,1);
  const list=scene.GetSceneAnims(),refs=scene.GetPlayingAnimRefs(),playingNames=scene.GetPlayingAnimNames();
  const report={defaults:Object.fromEntries(names.map(name=>[name,config[name]])),
    vector:[config.compositing_params0.x,config.compositing_params0.y,config.compositing_params0.z,config.compositing_params0.w],
    enums:[hg.BR_Equal,hg.BR_Half,hg.BR_Quarter,hg.BR_Eighth,hg.BR_Sixteenth,hg.BR_Double,hg.ALM_Once,hg.ALM_Infinite,hg.ALM_Loop],
    unspecified:String(hg.UnspecifiedAnimTime),invalid:ref.equals(hg.InvalidSceneAnimRef),playing:scene.IsPlaying(play),
    lists:[list,refs,playingNames].map(value=>({type:value.constructor.name,length:value.length,size:String(value.size()),sizeType:typeof value.size()})),
    refs:[ref instanceof hg.SceneAnimRef,play instanceof hg.ScenePlayAnimRef]};
  scene.StopAnim(play);scene.StopAllAnims();scene.UpdatePlayingAnims(16666667n);scene.Clear();
  globalThis.engineContract=report;console.log('ENGINE_CONTRACT '+JSON.stringify(report));
  return report;
}
