import {InputManager} from '../core/input.js';
import {integer,requireCondition} from '../core/errors.js';
import {InstancedForwardRenderer} from '../render/instanced-forward.js';
import {NativeSceneRenderer} from '../render/native-scene.js';
import {loadProgramAssets} from './program-assets.js';
import {getHost,setHost} from './context.js';
import {profile} from './profile.js';

// Browser-only lifecycle. A native application's window helper may be replaced
// by `export {runWindow} from 'harfang/browser'` without altering scene code.
export async function createNativeBrowserApplication({canvas,manifestURL,onFrame=()=>{},beforeFrame=()=>{},onAssetProgress=()=>{},fixedDeltaNs,signal,centerMouse=false,
  maxAssetBytes=profile.limits.maxGPUBytes,maxGPUBytes=profile.limits.maxGPUBytes}={}) {
  requireCondition(canvas instanceof HTMLCanvasElement,'INVALID_CANVAS','Expected a canvas');
  requireCondition(fixedDeltaNs===undefined || (typeof fixedDeltaNs==='bigint'&&fixedDeltaNs>=0n),'INVALID_ARGUMENT','Expected a nonnegative BigInt test delta');
  integer(maxGPUBytes,1,536870912,'GPU byte budget');
  const assets=await loadProgramAssets(manifestURL,signal,onAssetProgress,maxAssetBytes);
  const host={canvas,assets,scenes:new Set(),resources:new Set(),pipelines:new Set(),warnings:[],
    requestedSize:[1280,720],frames:0,state:'ready',metrics:{},closed:false,paused:false};
  const listeners=[]; let request,waiter,previous,completion;
  const on=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
  const cancel=()=>{if(request!==undefined) cancelAnimationFrame(request); request=undefined;};
  function resize() {
    const rect=canvas.getBoundingClientRect(), ratio=Math.min(devicePixelRatio||1,profile.limits.maxPixelRatio), caps=host.renderer.capabilities;
    const width=Math.max(1,Math.min(Math.round(rect.width*ratio),caps.maxViewport[0],profile.limits.maxDrawingBufferSize));
    const height=Math.max(1,Math.min(Math.round(rect.height*ratio),caps.maxViewport[1],profile.limits.maxDrawingBufferSize));
    if(canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
    host.presentation={...host.presentation,requestedSize:host.requestedSize.slice(),effectiveSize:[width,height],pixelRatio:ratio,
      antialias:host.renderer.capabilities.antialias,samples:host.renderer.capabilities.samples};
  }
  function schedule() {
    if(!waiter || host.paused || document.hidden || request!==undefined || host.closed) return;
    request=requestAnimationFrame(time=>{
      request=undefined; const pending=waiter; waiter=undefined;
      try {
        resize();beforeFrame(host); host.input.snapshot();
        const dt=fixedDeltaNs??BigInt(Math.round(previous===undefined?0:Math.min(profile.limits.maxFrameDeltaMs,Math.max(0,time-previous))*1e6));
        previous=time; pending.resolve({closed:false,dtNs:dt});
      } catch(error) {pending.reject(error);}
    });
  }
  host.nextFrame=()=>new Promise((resolve,reject)=>{
    requireCondition(!waiter,'FRAME_PENDING','Only one outstanding frame wait is supported');
    if(host.failure) {reject(host.failure);return;}
    if(host.closed) {resolve({closed:true,dtNs:0n});return;}
    waiter={resolve,reject}; schedule();
  });
  host.stop=()=>{
    host.closed=true; cancel(); const pending=waiter; waiter=undefined;
    pending?.resolve({closed:true,dtNs:0n}); return completion??Promise.resolve();
  };
  host.pause=()=>{host.paused=true;cancel();previous=undefined;host.input?.reset();};
  host.resume=()=>{host.paused=false;previous=undefined;schedule();};
  host.warn=message=>{if(!host.warnings.includes(message)) {host.warnings.push(message);console.warn(message);}};
  host.run=async(main,options={})=>{
    requireCondition(host.state==='ready','INVALID_LIFECYCLE','Create a new browser application to restart');
    setHost(host); host.state='running';
    completion=(async()=>{
      try {await main(options);}
      catch(error) {host.failure=error;throw error;}
      finally {
        host.closed=true;cancel();
        const errors=[];
        const clean=fn=>{try{fn();}catch(error){errors.push(error);}};
        for(const scene of host.scenes) clean(()=>scene.dispose());
        for(const resource of host.resources) {clean(()=>resource.DestroyAllTextures());clean(()=>resource.DestroyAllModels());clean(()=>resource.DestroyAllPrograms());}
        for(const pipeline of host.pipelines) pipeline.alive=false;
        clean(()=>host.lines?.dispose());clean(()=>host.renderer?.dispose());clean(()=>host.input?.dispose());
        host.finalResources=host.renderer?{...host.renderer.stats,...(host.lines?{linePrograms:host.lines.stats.programs,lineBufferBytes:host.lines.stats.gpuBufferBytes}:{})}:{};
        host.scenes.clear();host.resources.clear();host.pipelines.clear();host.currentScene=undefined;
        for(const off of listeners.splice(0)) off();setHost(undefined);
        host.state=host.failure||errors.length?'failed':'stopped';
        if(errors.length&&!host.failure) throw new AggregateError(errors,'Browser cleanup failed');
      }
    })();
    return completion;
  };
  host.open=(title,width,height,resetFlags)=>{
    host.requestedSize=[width,height];
    canvas.setAttribute('aria-label',title);
    const Renderer=assets.manifest.profile==='web-native-scene/1'?NativeSceneRenderer:InstancedForwardRenderer;
    host.renderer=new Renderer(canvas,{antialias:false,maxGPUBytes});
    host.input=new InputManager().attach(canvas);canvas.focus();resize();
    if(centerMouse)host.input.move(canvas.width/2,canvas.height/2);
    host.presentation.requestedResetFlags=resetFlags??0;
    if((resetFlags??0)&0x70) host.warn('[HARFANG Web] Requested MSAA is ignored by this host; antialiasing is disabled.');
    on(document,'visibilitychange',()=>{previous=undefined;if(document.hidden){cancel();host.input.reset();}else schedule();});
    on(window,'pagehide',()=>{void host.stop();});
    on(canvas,'webglcontextlost',event=>{
      event.preventDefault();host.failure=new Error('WebGL context lost; restart the application after restoration');
      host.closed=true;cancel();const pending=waiter;waiter=undefined;pending?.reject(host.failure);
    });
  };
  host.record=(dt,drawMs)=>{
    host.frames++;host.metrics={...host.renderer.stats,frame:host.frames,dtNs:String(dt),drawMs,
      scene:host.currentScene?.stats,presentation:{...host.presentation},warnings:host.warnings.slice(),...(host.lines?{lines:{...host.lines.stats}}:{})};
    onFrame(host);
  };
  return host;
}

export async function runWindow(title,create,{width=1280,height=720,resetFlags,frameLimit=Infinity,renderer,capturePath}={}) {
  const host=getHost();
  requireCondition(renderer===undefined && capturePath===undefined,'UNSUPPORTED_HOST_OPTION','Use browser capture; native renderer/capturePath options are unavailable');
  requireCondition(frameLimit===Infinity || (Number.isInteger(frameLimit)&&frameLimit>=0),'INVALID_ARGUMENT','Invalid frame limit');
  let app;
  try {
    host.open(title,width,height,resetFlags); const start=performance.now();app=create();host.initMs=performance.now()-start;
    for(let frame=0;frame<frameLimit;++frame) {
      const state=await host.nextFrame();if(state.closed||host.input.keyboard.Key('Escape')||host.input.keyboard.Pressed('Escape')) break;
      const start=performance.now();app.draw(state.dtNs,host.canvas.width,host.canvas.height);
      host.record(state.dtNs,performance.now()-start);
    }
  } finally {if(app) app.dispose();}
}
