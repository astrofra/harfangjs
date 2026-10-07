import {createNativeBrowserApplication} from 'harfang/browser';
import {main} from './scene_instances.js';

const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),metrics=document.querySelector('#metrics');
const pause=document.querySelector('#pause'),restart=document.querySelector('#restart'),error=document.querySelector('#error');
const parameters=new URLSearchParams(location.search),testing=parameters.has('test');
const frameLimit=testing?Number(parameters.get('frames')??12):Infinity;
let application,completion,lastTime,smoothed=0;
async function start() {
  pause.disabled=restart.disabled=true;error.textContent='';status.hidden=false;status.textContent='Loading assets 0%';
  window.instancesScene={state:'loading',history:[],captures:{}};lastTime=undefined;
  try {
    application=await createNativeBrowserApplication({canvas,manifestURL:new URL('./resources_compiled/manifest.json',import.meta.url),
      onAssetProgress(progress) {
        window.instancesScene.loadingProgress=progress;
        const label=progress.phase==='ready'?'Assets loaded 100% - preparing scene...':`Loading assets ${progress.percent}%`;
        if(status.textContent!==label)status.textContent=label;
      },
      fixedDeltaNs:testing?16666667n:undefined,
      onFrame(host) {
        const now=performance.now();if(lastTime!==undefined)smoothed=smoothed?smoothed*.9+(now-lastTime)*.1:now-lastTime;lastTime=now;
        status.hidden=true;const s=host.metrics;
        metrics.textContent=`${smoothed?(1000/smoothed).toFixed(0):'—'} FPS · ${host.currentScene.GetPlayingAnimRefs().length} actors · ${s.scene.nodes} nodes · ${s.shadowPasses} shadow passes`;
        window.instancesScene.state='running';window.instancesScene.metrics=s;
        if(testing) {
          window.instancesScene.history.push(s);
          if(host.frames===4||host.frames===frameLimit)window.instancesScene.captures[host.frames]=canvas.toDataURL('image/png');
        }
      }});
    window.instancesScene.host=application;pause.disabled=restart.disabled=false;pause.textContent='Pause';
    completion=application.run(main,{frameLimit});await completion;
    window.instancesScene.state=application.state;window.instancesScene.finalResources=application.finalResources;
    pause.disabled=true;status.hidden=false;status.textContent='Stopped';
  } catch(e) {
    console.error(e);window.instancesScene.state='failed';window.instancesScene.error=String(e);
    error.textContent=String(e);status.textContent='Unable to start';restart.disabled=false;pause.disabled=true;
  }
}
pause.onclick=()=>{
  if(application.paused){application.resume();pause.textContent='Pause';status.hidden=true;}
  else{application.pause();pause.textContent='Resume';status.hidden=false;status.textContent='Paused';}
};
restart.onclick=async()=>{restart.disabled=true;await application?.stop();await completion?.catch(()=>{});await start();};
void start();
