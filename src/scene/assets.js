import {ResourceManager} from '../core/resources.js';
import {abortError, HarfangError, requireCondition} from '../core/errors.js';
import {Scene} from './scene.js';
import {Vec3, Vec2, Color, Deg3, Deg} from '../core/math.js';
import {decodeMesh, watchModel} from '../render/models.js';
import {Picture, watchImage} from '../render/images.js';
import {createMaterial} from '../render/materials.js';
import {validateSceneJSON, nullReference} from './schema.js';

export class StaticAssets extends ResourceManager {
  #pending = new Set(); #scenes = new Set(); #models = new Set(); #pictures = new Set(); #disposed = false; #renderer;
  constructor(options) { super(options); this.#renderer = options.renderer; }
  async #run(source, signal, work) {
    requireCondition(!this.#disposed, 'DISPOSED', 'Asset loader is disposed', source);
    if (signal?.aborted) throw abortError(source);
    const controller = new AbortController(), cancel = () => controller.abort();
    this.#pending.add(controller); signal?.addEventListener('abort', cancel, {once: true});
    try {
      const result = await work(controller.signal);
      if (controller.signal.aborted || this.#disposed) { result?.dispose?.(); throw abortError(source); }
      return result;
    } catch (error) {
      throw new HarfangError(error.code ?? 'ASSET_LOAD_FAILED', error.message, source, {cause: error});
    } finally { signal?.removeEventListener('abort', cancel); this.#pending.delete(controller); }
  }
  async #json(id, signal) {
    const lease = await this.acquire(id, {signal});
    try { return JSON.parse(lease.text()); }
    catch (error) { throw new HarfangError('CORRUPT_ASSET', `Invalid JSON: ${error.message}`, id, {cause: error}); }
    finally { lease.dispose(); }
  }
  loadModel(id, {signal} = {}) {
    return this.#run(id, signal, async signal => {
      const entry = this.describe(id);
      requireCondition(entry.kind === 'mesh', 'INVALID_ASSET_KIND', 'Expected a compiled mesh', id);
      const descriptor = await this.#json(id, signal);
      requireCondition(entry.dependencies?.includes(descriptor.buffer) && this.describe(descriptor.buffer).kind === 'bytes', 'MISSING_ASSET', 'Mesh buffer is not declared in dependencies', id);
      const lease = await this.acquire(descriptor.buffer, {signal});
      try {
        const model = decodeMesh(descriptor, lease.bytes());
        this.#models.add(model); watchModel(model, () => this.#models.delete(model)); return model;
      } finally { lease.dispose(); }
    });
  }
  loadPicture(id, {signal} = {}) {
    return this.#run(id, signal, async signal => {
      const entry = this.describe(id);
      requireCondition(entry.kind === 'image' && ['image/png', 'image/jpeg'].includes(entry.mime), 'INVALID_ASSET_KIND', 'Expected compiled PNG or JPEG', id);
      const lease = await this.acquire(id, {signal}); let bitmap;
      try {
        bitmap = await createImageBitmap(new Blob([lease.bytes()], {type: entry.mime}), {imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
        if (signal.aborted) throw abortError(id);
        requireCondition(bitmap.width === entry.width && bitmap.height === entry.height, 'CORRUPT_ASSET', 'Decoded dimensions differ from manifest', id);
        const picture = new Picture(bitmap, id); this.#pictures.add(picture); watchImage(picture, () => this.#pictures.delete(picture));
        bitmap = undefined; return picture;
      } finally { bitmap?.close(); lease.dispose(); }
    });
  }
  async loadTexture(id, options) {
    requireCondition(this.#renderer, 'INVALID_RENDERER', 'Texture loading needs a renderer', id);
    const picture = await this.loadPicture(id, options);
    try { this.#renderer.prepareTexture(picture); return [picture, {width: picture.GetWidth(), height: picture.GetHeight()}]; }
    catch (error) { picture.dispose(); throw error; }
  }
  loadScene(id, {signal, structure = false} = {}) {
    return this.#run(id, signal, async signal => {
      const entry = this.describe(id);
      requireCondition(entry.kind === 'scene-json', 'INVALID_ASSET_KIND', 'Expected compiled native scene JSON', id);
      requireCondition(entry.mode !== 'structure' || structure, 'UNSUPPORTED_SCENE_FEATURE', 'This scene requires explicit structure: true diagnostic rendering', id);
      requireCondition(!structure || entry.mode === 'structure', 'INVALID_SCENE_MODE', 'Structural approximation was not approved by the compiler', id);
      return this.#createScene(await this.#json(id, signal), {source: id, signal, structure, dependencies: entry.dependencies,
        lighting:entry.mode === 'forward', ...entry.lighting});
    });
  }
  loadSceneJSON(body, {signal, source = 'scene-json', structure = false, lighting = false, ignoreShadows = false, ambientEnvironment = false} = {}) {
    // Explicit development entry for an unmodified supported native JSON body.
    // All dependencies still resolve exclusively through the compiled manifest.
    return this.#run(source, signal, signal => this.#createScene(body, {source, signal, structure, lighting, ignoreShadows, ambientEnvironment}));
  }
  async #createScene(body, {source, signal, structure, dependencies, lighting = false, ignoreShadows = false, ambientEnvironment = false}) {
    validateSceneJSON(body, {source, structure, lighting, ignoreShadows, ambientEnvironment});
    const scene = new Scene(), models = new Map(), pictures = new Map();
    const requireDependency = id => {
      requireCondition(!dependencies || dependencies.includes(id), 'MISSING_ASSET', `Undeclared dependency ${id}`, source);
      return id;
    };
    try {
      scene.metadata = structuredClone({key_values: body.key_values ?? {}, environment: body.environment ?? {},
        lights: body.lights ?? [], structure, source, lighting, adaptations:{ignoreShadows,ambientEnvironment}});
      if (lighting) {
        const env = body.environment ?? {};
        scene.environment = {ambient:new Color(...(env.ambient ?? [0,0,0,255]).map(c => c/255)),
          fog_color:new Color(...(env.fog_color ?? [0,0,0,255]).map(c => c/255)), fog_near:env.fog_near ?? 0, fog_far:env.fog_far ?? 0};
      }
      scene.canvas = {clear_color: body.canvas?.clear_color ?? true, clear_z: body.canvas?.clear_z ?? true,
        color: body.canvas?.color ? new Color(...body.canvas.color.map(c => c / 255)) : new Color(0.05,0.06,0.08)};
      const objects = [];
      for (const object of body.objects ?? []) {
        const id = requireDependency(object.name);
        if (!models.has(id)) models.set(id, scene.own(await this.loadModel(id, {signal})));
        const materials = [];
        for (const material of object.materials) {
          const textureRefs = new Map();
          for (const texture of structure ? [] : material.textures ?? []) {
            if (!texture.path) continue;
            const imageId = requireDependency(texture.path);
            if (!pictures.has(imageId)) pictures.set(imageId, scene.own(await this.loadPicture(imageId, {signal})));
            textureRefs.set(texture.name,pictures.get(imageId));
          }
          requireCondition(!textureRefs.has('uNormalMap') || models.get(id).hasTangents,'MISSING_TANGENTS','Normal mapping requires compiled tangent frames',id);
          materials.push(createMaterial(material, textureRefs, {structure}));
        }
        const component = scene.CreateObject(models.get(id), materials);
        (object.material_infos ?? []).forEach((info, i) => { if (i < materials.length) component.SetMaterialName(i, info.name ?? ''); });
        objects.push(component);
      }
      if (signal.aborted) throw abortError(source);
      this.#renderer?.prepareMaterials(objects.flatMap(object => Array.from({length:object.GetMaterialCount()},(_,i) => object.GetMaterial(i))));
      const transforms = (body.transforms ?? []).map(t => scene.CreateTransform(new Vec3(...t.pos), Deg3(...t.rot), new Vec3(...t.scl)));
      const cameras = (body.cameras ?? []).map(c => {
        const camera = c.ortho ? scene.CreateOrthographicCamera(c.zrange?.znear ?? 0.01, c.zrange?.zfar ?? 1000, c.size ?? 1) :
          scene.CreateCamera(c.zrange?.znear ?? 0.01, c.zrange?.zfar ?? 1000, c.fov ?? Deg(40));
        camera.SetFov(c.fov ?? Deg(40)); camera.SetSize(c.size ?? 1); return camera;
      });
      const nodes = new Map();
      const lights = lighting ? (body.lights ?? []).map(authored => {
        const light = scene.CreateLight(); light.SetType(authored.type);
        light.SetDiffuseColor(new Color(...authored.diffuse.map(c => c/255))); light.SetSpecularColor(new Color(...authored.specular.map(c => c/255)));
        light.SetDiffuseIntensity(authored.diffuse_intensity ?? 1); light.SetSpecularIntensity(authored.specular_intensity ?? 1);
        light.SetRadius(authored.radius ?? 0); light.SetInnerAngle(authored.inner_angle ?? Deg(30)); light.SetOuterAngle(authored.outer_angle ?? Deg(45)); light.SetPriority(authored.priority ?? 0);
        return light;
      }) : [];
      for (const authored of body.nodes ?? []) {
        const node = scene.CreateNode(authored.name); nodes.set(authored.idx, node);
        const [t, c, o, l] = authored.components;
        if (!nullReference(t)) node.SetTransform(transforms[t]);
        if (!nullReference(c)) node.SetCamera(cameras[c]);
        if (!nullReference(o)) node.SetObject(objects[o]);
        if (lighting && !nullReference(l)) node.SetLight(lights[l]);
        if (authored.disabled) node.Disable();
      }
      (body.transforms ?? []).forEach((t, i) => { if (!nullReference(t.parent)) transforms[i].SetParent(nodes.get(t.parent)); });
      if (!nullReference(body.environment?.current_camera)) {
        scene.SetCurrentCamera(nodes.get(body.environment.current_camera)); scene.ComputeCurrentCameraViewState(new Vec2(1,1));
      }
      this.#scenes.add(scene); scene.own({dispose: () => this.#scenes.delete(scene)});
      return scene;
    } catch (error) { scene.dispose(); throw error; }
  }
  get stats() { return {...super.stats, scenes: this.#scenes.size, models: this.#models.size, pictures: this.#pictures.size, operations: this.#pending.size}; }
  cancelPending() { for (const controller of [...this.#pending]) controller.abort(); super.cancelPending(); }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true; this.cancelPending(); const errors = [];
    for (const item of [...this.#scenes, ...this.#models, ...this.#pictures]) { try { item.dispose(); } catch (error) { errors.push(error); } }
    super.dispose();
    if (errors.length) throw new AggregateError(errors, 'Static asset disposal failed');
  }
}

export const LoadSceneFromAssetsAsync = (assets, id, options) => assets.loadScene(id, options);
export const LoadPictureFromAssetsAsync = (assets, id, options) => assets.loadPicture(id, options);
export const LoadTextureFromAssetsAsync = (assets, id, options) => assets.loadTexture(id, options);
