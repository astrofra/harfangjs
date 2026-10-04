import * as hg from 'harfang';

export const cases = ['basic_loop', 'draw_lines', 'draw_lines_starfield', 'render_resize_to_window.lines',
  'input_read_keyboard_basic', 'input_read_keyboard_advanced', 'input_read_mouse_basic', 'input_read_mouse_advanced', 'scene_lua_script.js'];

export function createApplication(caseId = 'draw_lines', seed = 1337) {
  if (!cases.includes(caseId)) throw new Error(`Unknown tutorial case: ${caseId}`);
  let scene, actor, program, vertices, behavior, angle = 0, steps = 0, elapsedNs = 0n;
  let randomState = seed >>> 0;
  const random = () => { randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0; return randomState / 4294967296; };
  const stars = Array.from({length: 1000}, () => new hg.Vec3(random() * 20 - 10, random() * 20 - 10, random() * 20 - 10));
  const starfield = caseId === 'draw_lines_starfield';
  const lines = caseId === 'draw_lines' || starfield || caseId === 'render_resize_to_window.lines';
  const stats = {caseId, seed, steps: 0, elapsedNs: '0', disposed: false, actorPosition: [0, 0, 0], input: {}};
  return {
    requires: ['math.foundation', 'scene.handles', 'render.lines', 'input.keyboard', 'input.mouse'],
    stats,
    async init(ctx) {
      scene = new hg.Scene(); actor = scene.CreateNode('Actor'); actor.SetTransform(scene.CreateTransform());
      if (lines) {
        const layout = new hg.VertexLayout().Begin().Add(hg.A_Position, 3, hg.AT_Float);
        if (starfield) layout.Add(hg.A_Color0, 3, hg.AT_Float);
        layout.End(); vertices = new hg.Vertices(layout, 2000);
        program = ctx.renderer.createLineProgram(starfield ? 'shaders/pos_rgb' : 'shaders/white');
      }
      if (caseId === 'scene_lua_script.js') {
        behavior = await ctx.scripts.attach('behaviors/communication.js', actor, {a: 4}, {signal: ctx.signal});
        ctx.scripts.setValue(behavior, 'a', 24);
        stats.scriptResult = ctx.scripts.call(behavior, 'CallToReturnValue');
      }
    },
    update(ctx, dtNs) {
      if (ctx.input.keyboard.Pressed(hg.K_Escape)) { void ctx.stop(); return; }
      elapsedNs += dtNs; ++steps;
      const dt = hg.time_to_sec_f(dtNs);
      const transform = actor.GetTransform();
      transform.SetPos(transform.GetPos().add(new hg.Vec3(0.1 * dt, 0, 0)));
      ctx.scripts.update(dtNs);
      if (lines) {
        vertices.Clear();
        for (let i = 0; i < 1000; ++i) {
          if (starfield) {
            const star = stars[i];
            star.z -= 2 * dt;
            // Preserve the source tutorial's threshold/wrap, including initial
            // negative depths. Guard its possible zero divisor explicitly.
            if (star.z < 10) star.z += 10;
            const z = Math.abs(star.z) < 1e-6 ? 1e-6 : star.z;
            vertices.Begin(i * 2).SetPos(new hg.Vec3(star.x / z, star.y / z, 0)).SetColor0(hg.Color.Black).End();
            vertices.Begin(i * 2 + 1).SetPos(new hg.Vec3(star.x * 1.04 / z, star.y * 1.04 / z, 0)).SetColor0(hg.Color.White).End();
          } else {
            vertices.Begin(i * 2).SetPos(new hg.Vec3(Math.sin(angle + i * 0.005), Math.cos(angle + i * 0.01), 0)).End();
            vertices.Begin(i * 2 + 1).SetPos(new hg.Vec3(Math.sin(angle - i * 0.005), Math.cos(angle + i * 0.005), 0)).End();
          }
        }
        angle += dt;
      }
      Object.assign(stats, {steps, elapsedNs: elapsedNs.toString(), actorPosition: [...transform.GetPos().data],
        input: {keys: ctx.input.keyboard.down, pressed: ctx.input.keyboard.pressed, released: ctx.input.keyboard.released,
          x: ctx.input.mouse.X(), y: ctx.input.mouse.Y(), dx: ctx.input.mouse.DtX(), dy: ctx.input.mouse.DtY(),
          buttons: ctx.input.mouse.down, mousePressed: ctx.input.mouse.pressed, mouseReleased: ctx.input.mouse.released, wheel: ctx.input.mouse.Wheel()}});
    },
    render(ctx) {
      ctx.renderer.beginFrame(caseId === 'basic_loop' ? hg.Color.Green : starfield ? hg.Color.Black : hg.ColorI(64, 64, 64));
      if (lines) {
        let matrix = hg.Mat44.Identity;
        if (caseId === 'render_resize_to_window.lines') {
          matrix = hg.ComputeOrthographicProjectionMatrix(0, 10, 2.4, hg.ComputeAspectRatioX(ctx.width, ctx.height))
            .mul(new hg.Mat44(hg.TranslationMat4(new hg.Vec3(0, 0, 1))));
        }
        ctx.renderer.drawLines(vertices, program, matrix);
      }
    },
    resize(ctx, width, height) { stats.viewport = [width, height]; },
    dispose() {
      program?.dispose(); vertices?.dispose(); scene?.dispose(); stats.disposed = true;
    }
  };
}
