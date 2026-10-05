import {createNativeBrowserApplication} from 'harfang/browser';
import {main} from './scene_many_nodes.js';

const canvas=document.querySelector('canvas'), status=document.querySelector('#status'), metrics=document.querySelector('#metrics');
const pause=document.querySelector('#pause'), restart=document.querySelector('#restart'), error=document.querySelector('#error');
const parameters=new URLSearchParams(location.search), testing=parameters.has('test');
const frameLimit=testing?Number(parameters.get('frames')??12):Infinity;
const fixedDeltaNs=testing?BigInt(parameters.get('dt')??'16666667'):undefined;
let application, completion, lastTime, smoothed=0;
window.manyNodes={state:'loading',history:[],captures:{}};
async function start() {
  pause.disabled=restart.disabled=true;error.textContent='';status.hidden=false;status.textContent='Preparing assets…';
  window.manyNodes={state:'loading',history:[],captures:{}};lastTime=undefined;
  try {
    application=await createNativeBrowserApplication({canvas,manifestURL:new URL('./resources_compiled/manifest.json',import.meta.url),fixedDeltaNs,
      onFrame(host) {
        const now=performance.now();if(lastTime!==undefined) smoothed=smoothed?smoothed*.9+(now-lastTime)*.1:now-lastTime;lastTime=now;
        status.hidden=true;const s=host.metrics;
        metrics.textContent=`${smoothed?(1000/smoothed).toFixed(0):'—'} FPS · ${s.scene.nodes.toLocaleString()} nodes · ${s.drawCalls+s.shadowDrawCalls} draws · ${s.shadowResolution} shadow map`;
        window.manyNodes.state='running';window.manyNodes.metrics=s;
        if(testing) {
          window.manyNodes.history.push(s);
          const nodes=host.currentScene.GetNodes();
          window.manyNodes.samples=[3,3+50*101+50,10203].map(i=>{
            const p=nodes[i].GetTransform().GetPos();return [p.x,p.y,p.z];
          });
          if(host.frames===4 || host.frames===frameLimit) window.manyNodes.captures[host.frames]=canvas.toDataURL('image/png');
        }
      }});
    window.manyNodes.host=application;
    pause.disabled=restart.disabled=false;pause.textContent='Pause';
    completion=application.run(main,{frameLimit});await completion;
    window.manyNodes.state=application.state;window.manyNodes.finalResources=application.finalResources;
    pause.disabled=true;status.hidden=false;status.textContent='Stopped';
  } catch(e) {
    console.error(e);window.manyNodes.state='failed';window.manyNodes.error=String(e);
    error.textContent=String(e);status.textContent='Unable to start';restart.disabled=false;pause.disabled=true;
  }
}
pause.onclick=()=>{
  if(application.paused) {application.resume();pause.textContent='Pause';status.hidden=true;}
  else {application.pause();pause.textContent='Resume';status.hidden=false;status.textContent='Paused';}
};
restart.onclick=async()=>{restart.disabled=true;await application?.stop();await completion?.catch(()=>{});await start();};
void start();
