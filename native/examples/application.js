import * as hg from 'harfang';

// Native renderer bootstrap. The shared portable W1/W2 facade is a later gate.
export function createApplication() {
  let scene, resources, pipeline;
  return {
    async init() {
      resources = new hg.PipelineResources();
      pipeline = hg.CreateForwardPipeline();
      scene = new hg.Scene();
      if (!hg.LoadSceneFromAssets('scenes/room.scn', scene, resources, hg.GetForwardPipelineInfo())) throw Error('Missing compiled room scene');
      scene.SetCurrentCamera(scene.GetNode('Perspective'));
    },
    update(dtNs) { scene.Update(dtNs); },
    render(width, height) {
      hg.SubmitSceneToPipeline(0, scene, new hg.IntRect(0, 0, width, height), true, pipeline, resources);
    },
    dispose() {
      if (scene) scene.Clear();
      if (resources) {
        resources.DestroyAllTextures(); resources.DestroyAllModels(); resources.DestroyAllPrograms();
      }
      if (pipeline) hg.DestroyForwardPipeline(pipeline);
    },
  };
}
