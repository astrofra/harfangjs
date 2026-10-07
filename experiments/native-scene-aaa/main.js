import {createNativeBrowserApplication} from 'harfang/browser';
import {main} from './scene_aaa.js';

const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),metrics=document.querySelector('#metrics');
const pause=document.querySelector('#pause'),restart=document.querySelector('#restart'),error=document.querySelector('#error');
const parameters=new URLSearchParams(location.search),testing=parameters.has('test');
const frameLimit=testing?Number(parameters.get('frames')??12):Infinity;
let application,completion,lastTime,smoothed=0;
async function start() {
  pause.disabled=restart.disabled=true;error.textContent='';status.hidden=false;status.textContent='Loading assets 0%';
  window.engineScene={state:'loading',history:[],captures:{},samples:[],animationSamples:[]};lastTime=undefined;
  try {
    application=await createNativeBrowserApplication({canvas,manifestURL:new URL('./resources_compiled/manifest.json',import.meta.url),
      onAssetProgress(progress) {
        window.engineScene.loadingProgress=progress;
        const label=progress.phase==='ready'?'Assets loaded 100% - preparing scene...':`Loading assets ${progress.percent}%`;
        if(status.textContent!==label)status.textContent=label;
      },
      fixedDeltaNs:testing?16666667n:undefined,
      onFrame(host) {
        const now=performance.now();if(lastTime!==undefined)smoothed=smoothed?smoothed*.9+(now-lastTime)*.1:now-lastTime;lastTime=now;
        status.hidden=true;const s=host.metrics;
        metrics.textContent=`${smoothed?(1000/smoothed).toFixed(0):'—'} FPS · ${s.scene.nodes} nodes · ${s.shadowPasses} shadow passes`;
        window.engineScene.state='running';window.engineScene.metrics=s;
        if(testing) {
          window.engineScene.history.push(s);
          window.engineScene.samples.push([...host.currentScene.GetNode('engine_master').GetTransform().GetRot().data]);
          const source=host.assets.scenes.get('car_engine/engine.scn');
          const names=source.scene_anims[0].node_anims.map(b=>source.nodes.find(n=>n.idx===b.node).name);
          window.engineScene.animationSamples.push({playing:host.currentScene.GetPlayingAnimRefs().length,
            worlds:names.map(name=>[...host.currentScene.GetNode(name).GetTransform().GetWorld().data])});
          if(host.frames===4||host.frames===frameLimit)window.engineScene.captures[host.frames]=canvas.toDataURL('image/png');
        }
      }});
    window.engineScene.host=application;pause.disabled=restart.disabled=false;pause.textContent='Pause';
    completion=application.run(main,{frameLimit});await completion;
    window.engineScene.state=application.state;window.engineScene.finalResources=application.finalResources;
    pause.disabled=true;status.hidden=false;status.textContent='Stopped';
  } catch(e) {
    console.error(e);window.engineScene.state='failed';window.engineScene.error=String(e);
    error.textContent=String(e);status.textContent='Unable to start';restart.disabled=false;pause.disabled=true;
  }
}
pause.onclick=()=>{
  if(application.paused){application.resume();pause.textContent='Pause';status.hidden=true;}
  else{application.pause();pause.textContent='Resume';status.hidden=false;status.textContent='Paused';}
};
restart.onclick=async()=>{restart.disabled=true;await application?.stop();await completion?.catch(()=>{});await start();};
void start();
