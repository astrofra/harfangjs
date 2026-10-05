import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
import {createApplication} from './viewer/application.js';

async function main() {
  hg.AddAssetsFolder('resources_compiled');
  hg.WindowSystemInit();
  const window = hg.NewWindow('HGJS native scene', 256, 256, 32, hg.WV_Hidden);
  let pipeline, initialized = false;
  try {
    if (!hg.RenderInit(window)) throw Error('Native renderer initialization failed');
    initialized = true;
    const viewer = createApplication();
    try {
      await viewer.init();
      viewer.update(0n); viewer.render(256, 256); hg.Frame();
    } finally { viewer.dispose(); }
    pipeline = hg.CreateForwardPipeline();
    for (const name of ['room', 'lighting', 'pbr-ambient']) {
      const scene = new hg.Scene(), resources = new hg.PipelineResources();
      try {
        if (!hg.LoadSceneFromAssets(`scenes/${name}.scn`, scene, resources, hg.GetForwardPipelineInfo())) throw Error(`Scene load failed: ${name}`);
        if (name === 'room') scene.SetCurrentCamera(scene.GetNode('Perspective'));
        for (let frame = 0; frame < 6; frame++) {
          const state = await nextFrame(window);
          if (state.closed) throw Error('Window closed before capture');
          scene.Update(0n);
          const outputs = hg.SubmitSceneToPipeline(0, scene, new hg.IntRect(0, 0, 256, 256), true, pipeline, resources);
          if (!Array.isArray(outputs) || outputs.length !== 2) throw Error('SubmitSceneToPipeline output order');
          if (frame === 3) hg.RequestScreenShot(hg.InvalidFrameBufferHandle, `hgjs-${name}`);
          hg.Frame();
        }
      } finally {
        scene.Clear();
        resources.DestroyAllTextures(); resources.DestroyAllModels(); resources.DestroyAllPrograms();
      }
    }
  } finally {
    if (pipeline) hg.DestroyForwardPipeline(pipeline);
    if (initialized) hg.RenderShutdown();
    hg.DestroyWindow(window); hg.WindowSystemShutdown();
  }
  for (const name of ['room', 'lighting', 'pbr-ambient']) {
    const picture = new hg.Picture();
    if (!hg.LoadPicture(picture, `hgjs-${name}.tga`) || !hg.SavePNG(picture, `hgjs-${name}.png`)) throw Error(`Capture conversion failed: ${name}`);
  }
  console.log('HGJS_RENDER_OK');
}
export const completion = main();
