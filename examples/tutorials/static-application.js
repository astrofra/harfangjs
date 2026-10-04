import * as hg from 'harfang';

export const staticCases = ['scene_static_room', 'draw_model_no_pipeline', 'render_resize_to_window',
  'filesystem_assets', 'picture_load', 'scene_pbr.structure'];

// Shared application code: host setup and asset URLs belong in the bootstrap.
export function createStaticApplication(caseId = 'scene_static_room') {
  if (!staticCases.includes(caseId)) throw new Error(`Unknown W1 case: ${caseId}`);
  let scene, cube, plane, picture, material, elapsed = 0n;
  const stats = {caseId, steps: 0, elapsedNs: '0', disposed: false};
  return {
    requires: ['scene.static', 'render.mesh', 'assets.images'], stats,
    async init(ctx) {
      if (caseId === 'scene_static_room' || caseId === 'scene_pbr.structure') {
        const structure = caseId === 'scene_pbr.structure';
        scene = await ctx.assets.loadScene(structure ? 'materials/materials.scn' : 'scenes/room.scn', {signal: ctx.signal, structure});
        stats.scene = scene.stats; stats.camera = scene.GetCurrentCamera().GetName();
        if (structure) stats.adaptation = 'Original scene structure; opaque unlit colors. PBR, textures, lights, fog and probes are not rendered.';
      } else if (caseId === 'picture_load' || caseId === 'filesystem_assets') {
        if (caseId === 'filesystem_assets') {
          const result = await hg.LoadTextureFromAssetsAsync(ctx.assets, 'pictures/owl.jpg', {signal: ctx.signal});
          picture = result[0]; stats.textureInfo = result[1];
        } else picture = await hg.LoadPictureFromAssetsAsync(ctx.assets, 'pictures/owl.jpg', {signal: ctx.signal});
        stats.picture = {width: picture.GetWidth(), height: picture.GetHeight()};
        // Supplemental preview of the same picture used by the original load tutorial.
        const ratio = picture.GetWidth() / picture.GetHeight();
        plane = hg.CreatePlaneModel(hg.VertexLayoutPosFloatNormUInt8(), 2 * ratio, 2);
        material = hg.createUnlitMaterial({program:'shaders/unlit.hps', face_culling:'disabled',
          textures:[{name:'uColorMap',stage:0,path:'pictures/owl.jpg'}]}, picture);
      } else {
        cube = hg.CreateCubeModel(hg.VertexLayoutPosFloatNormUInt8(), 1, 1, 1);
        plane = hg.CreatePlaneModel(hg.VertexLayoutPosFloatNormUInt8(), 5, 5, 1, 1);
      }
    },
    update(ctx, dt) {
      if (ctx.input.keyboard.Pressed(hg.K_Escape)) { void ctx.stop(); return; }
      elapsed += dt; stats.elapsedNs = String(elapsed); ++stats.steps;
      if (caseId === 'scene_static_room' && ctx.input.keyboard.Pressed('Space')) {
        scene.SetCurrentCamera(scene.GetNode(stats.camera === 'Perspective' ? 'Orthographic' : 'Perspective'));
        stats.camera = scene.GetCurrentCamera().GetName();
      }
    },
    render(ctx) {
      if (scene) { ctx.renderer.submit(scene); return; }
      ctx.renderer.beginFrame(caseId === 'render_resize_to_window' ? hg.ColorI(64,64,64) : hg.Color.Black);
      const aspect = hg.ComputeAspectRatioX(ctx.width, ctx.height);
      if (picture) {
        const projection = hg.ComputeOrthographicProjectionMatrix(.1, 10, 2.5, aspect);
        ctx.renderer.drawModel(plane, 'shaders/unlit.hps', hg.TransformationMat4(new hg.Vec3(0,0,2), hg.Deg3(90,0,0)), projection, [material]);
      } else if (caseId === 'render_resize_to_window') {
        const [ok, view] = hg.Inverse(hg.TransformationMat4(new hg.Vec3(1,1,-2), hg.Deg3(24,-27,0)));
        if (!ok) throw new Error('Invalid resize tutorial camera');
        const vp = hg.ComputePerspectiveProjectionMatrix(.01,100,1.8,aspect).mul(new hg.Mat44(view));
        ctx.renderer.drawModel(cube, 'shaders/mdl', hg.Mat4.Identity, vp);
      } else {
        const projection = hg.ComputePerspectiveProjectionMatrix(.01, 1000, 1.8, aspect);
        const vp = projection.mul(new hg.Mat44(hg.TranslationMat4(new hg.Vec3(0,-1,3))));
        const angle = hg.time_to_sec_f(elapsed);
        ctx.renderer.drawModel(cube, 'shaders/mdl', hg.TransformationMat4(new hg.Vec3(0,1,0), new hg.Vec3(angle,angle,angle)), vp);
        ctx.renderer.drawModel(plane, 'shaders/mdl', hg.Mat4.Identity, vp);
      }
    },
    resize(ctx, width, height) { stats.viewport = [width, height]; },
    dispose() { scene?.dispose(); cube?.dispose(); plane?.dispose(); picture?.dispose(); stats.disposed = true; }
  };
}
