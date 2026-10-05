import {createNativeBrowserApplication} from 'harfang/browser';
import {main} from './game_mouse_flight.js';

const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),metrics=document.querySelector('#metrics');
const pause=document.querySelector('#pause'),restart=document.querySelector('#restart'),error=document.querySelector('#error');
const parameters=new URLSearchParams(location.search),testing=parameters.has('test');
const frameLimit=testing?Number(parameters.get('frames')??12):Infinity;
let application,completion,lastTime,smoothed=0;
async function start() {
  pause.disabled=restart.disabled=true;error.textContent='';status.hidden=false;status.textContent='Preparing assets…';
  window.mouseFlight={state:'loading',history:[],captures:{},samples:[]};lastTime=undefined;
  try {
    application=await createNativeBrowserApplication({canvas,manifestURL:new URL('./resources_compiled/manifest.json',import.meta.url),centerMouse:true,
      fixedDeltaNs:testing?16666667n:undefined,
      beforeFrame(host) {
        const position=window.flightInputFrames?.[host.frames];
        if(position)host.input.move(...position);
      },
      onFrame(host) {
        const now=performance.now();if(lastTime!==undefined)smoothed=smoothed?smoothed*.9+(now-lastTime)*.1:now-lastTime;lastTime=now;
        status.hidden=true;const s=host.metrics;
        metrics.textContent=`${smoothed?(1000/smoothed).toFixed(0):'—'} FPS · ${s.scene.nodes} nodes · ${s.shadowPasses} shadow splits`;
        window.mouseFlight.state='running';window.mouseFlight.metrics=s;
        if(testing) {
          window.mouseFlight.history.push(s);
          const plane=host.currentScene.GetNode('paper_plane/paper_plane.scn').GetTransform(),camera=host.currentScene.GetCurrentCamera().GetTransform();
          window.mouseFlight.samples.push({plane:{pos:[...plane.GetPos().data],rot:[...plane.GetRot().data]},camera:{pos:[...camera.GetPos().data],rot:[...camera.GetRot().data]},mouse:[host.input.mouse.X(),host.input.mouse.Y()]});
          if(host.frames===4||host.frames===frameLimit)window.mouseFlight.captures[host.frames]=canvas.toDataURL('image/png');
        }
      }});
    window.mouseFlight.host=application;pause.disabled=restart.disabled=false;pause.textContent='Pause';
    completion=application.run(main,{frameLimit});await completion;
    window.mouseFlight.state=application.state;window.mouseFlight.finalResources=application.finalResources;
    pause.disabled=true;status.hidden=false;status.textContent='Stopped';
  } catch(e) {
    console.error(e);window.mouseFlight.state='failed';window.mouseFlight.error=String(e);
    error.textContent=String(e);status.textContent='Unable to start';restart.disabled=false;pause.disabled=true;
  }
}
pause.onclick=()=>{
  if(application.paused){application.resume();pause.textContent='Pause';status.hidden=true;}
  else{application.pause();pause.textContent='Resume';status.hidden=false;status.textContent='Paused';}
};
restart.onclick=async()=>{restart.disabled=true;await application?.stop();await completion?.catch(()=>{});await start();};
void start();
