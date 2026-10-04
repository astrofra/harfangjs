import {LineRenderer} from './lines.js';
import {modelData, watchModel} from './models.js';
import {imageData, watchImage} from './images.js';
import {Color, Mat4, Mat44, ComputeAspectRatioX} from '../core/math.js';
import {requireCondition, HarfangError} from '../core/errors.js';
import {validateMaterial} from '../scene/schema.js';
import {profile} from '../profile.js';

const vertexSource = `#version 300 es
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
uniform mat4 u_mvp;
uniform mat4 u_world;
out vec2 v_uv;
out vec3 v_normal;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_uv = a_uv;
  // The retained mdl tutorial decodes a packed unsigned normal then uses the
  // model matrix (not an inverse transpose). Keep its shader's behavior.
  vec3 packedNormal = floor((clamp(a_normal,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0;
  v_normal = (u_world * vec4(packedNormal, 0.0)).xyz;
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_normal;
uniform vec4 u_color;
uniform sampler2D u_image;
uniform bool u_textured;
uniform bool u_tutorial;
out vec4 fragColor;
void main() {
  if (u_tutorial) {
    vec3 light = normalize(vec3(1.0,0.8,0.5));
    vec3 normal = normalize(v_normal);
    float mainLight = max(0.0,-dot(normal,light));
    float backLight = max(0.0,dot(normal,light))*0.5;
    fragColor = min(vec4(vec3(mainLight) + vec3(0.75,0.85,1.0)*backLight + vec3(0.1,0.1,0.2), 1.0), vec4(1.0));
  } else {
    fragColor = u_color * (u_textured ? texture(u_image, v_uv) : vec4(1.0));
  }
}`;

function makeProgram(gl) {
  const shaders = []; let program;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type); requireCondition(shader, 'GPU_ALLOCATION_FAILED', 'Cannot allocate static shader'); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      requireCondition(gl.getShaderParameter(shader, gl.COMPILE_STATUS), 'SHADER_FAILED', gl.getShaderInfoLog(shader), 'static-mesh');
    }
    program = gl.createProgram(); requireCondition(program, 'GPU_ALLOCATION_FAILED', 'Cannot allocate static program');
    shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
    requireCondition(gl.getProgramParameter(program, gl.LINK_STATUS), 'SHADER_FAILED', gl.getProgramInfoLog(program), 'static-mesh');
    return program;
  } catch (error) { if (program) gl.deleteProgram(program); throw error; }
  finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}

export class StaticRenderer extends LineRenderer {
  #gl; #program; #uniforms; #meshes = new Map(); #textures = new Map();
  #gpuBytes = 0; #draws = 0; #triangles = 0; #disposed = false; #white;
  constructor(canvas) {
    super(canvas);
    this.#gl = canvas.getContext('webgl2');
    try {
      this.#program = makeProgram(this.#gl);
      this.#uniforms = Object.fromEntries(['mvp', 'world', 'color', 'image', 'textured', 'tutorial'].map(name => [name, this.#gl.getUniformLocation(this.#program, `u_${name}`)]));
      const gl = this.#gl;
      this.#white = gl.createTexture(); requireCondition(this.#white, 'GPU_ALLOCATION_FAILED', 'Cannot allocate default texture');
      gl.bindTexture(gl.TEXTURE_2D, this.#white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } catch (error) { this.dispose(); throw error; }
  }
  #alive() { requireCondition(!this.#disposed && !this.#gl.isContextLost(), this.#disposed ? 'DISPOSED' : 'CONTEXT_LOST', 'Static renderer is unavailable'); }
  #budget(bytes) { requireCondition(this.#gpuBytes + bytes <= profile.limits.maxGPUBytes, 'GPU_BUDGET', 'Static GPU byte budget exceeded'); }
  beginFrame(color = new Color(0.05, 0.06, 0.08), {clearColor = true, clearDepth = true} = {}) {
    this.#alive(); this.#draws = this.#triangles = 0;
    super.beginFrame(color, {clearColor, clearDepth});
  }
  #mesh(model) {
    const data = modelData(model);
    if (this.#meshes.has(model)) return this.#meshes.get(model);
    const gl = this.#gl, bytes = data.vertices.byteLength + data.indices.byteLength;
    this.#budget(bytes);
    const entry = {vao: gl.createVertexArray(), vertices: gl.createBuffer(), indices: gl.createBuffer(), bytes,
      indexType: data.indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, indexSize: data.indices.BYTES_PER_ELEMENT};
    const release = () => {
      gl.deleteVertexArray(entry.vao); gl.deleteBuffer(entry.vertices); gl.deleteBuffer(entry.indices);
      if (this.#meshes.delete(model)) this.#gpuBytes -= bytes;
      entry.unwatch?.();
    };
    try {
      requireCondition(entry.vao && entry.vertices && entry.indices, 'GPU_ALLOCATION_FAILED', 'Cannot allocate mesh buffers');
      gl.bindVertexArray(entry.vao); gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertices); gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      [3,3,2].forEach((components, index) => { gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, components, gl.FLOAT, false, 32, [0,12,24][index]); });
      gl.bindVertexArray(null);
      requireCondition(gl.getError() === gl.NO_ERROR, 'GPU_UPLOAD_FAILED', 'Mesh upload failed');
      entry.release = release; entry.unwatch = watchModel(model, release);
      this.#meshes.set(model, entry); this.#gpuBytes += bytes; return entry;
    } catch (error) { release(); throw error; }
  }
  prepareTexture(picture) {
    this.#alive();
    const data = imageData(picture);
    if (this.#textures.has(picture)) return this.#textures.get(picture).texture;
    const gl = this.#gl, width = picture.GetWidth(), height = picture.GetHeight(), bytes = width * height * 4;
    requireCondition(width <= this.capabilities.maxTextureSize && height <= this.capabilities.maxTextureSize, 'IMAGE_BUDGET', 'Image exceeds device limit', picture.logicalId);
    this.#budget(bytes);
    const texture = gl.createTexture(); requireCondition(texture, 'GPU_ALLOCATION_FAILED', 'Cannot allocate texture', picture.logicalId);
    const entry = {texture, bytes};
    const release = () => { gl.deleteTexture(texture); if (this.#textures.delete(picture)) this.#gpuBytes -= bytes; entry.unwatch?.(); };
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data.bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      requireCondition(gl.getError() === gl.NO_ERROR, 'GPU_UPLOAD_FAILED', 'Image upload failed', picture.logicalId);
      entry.release = release; entry.unwatch = watchImage(picture, release); this.#textures.set(picture, entry); this.#gpuBytes += bytes; return texture;
    } catch (error) { release(); throw error; }
  }
  drawModel(model, program = 'shaders/mdl', world = Mat4.Identity, viewProjection = Mat44.Identity, materials) {
    this.#alive();
    requireCondition(profile.modelPrograms.includes(program), 'UNSUPPORTED_PROGRAM', 'Unknown static program', program);
    requireCondition(world instanceof Mat4 && viewProjection instanceof Mat44, 'INVALID_ARGUMENT', 'Model needs Mat4 world and Mat44 view/projection');
    const gl = this.#gl, data = modelData(model), gpu = this.#mesh(model), u = this.#uniforms;
    gl.useProgram(this.#program); gl.bindVertexArray(gpu.vao);
    gl.uniformMatrix4fv(u.mvp, false, viewProjection.mul(new Mat44(world)).toArray()); gl.uniformMatrix4fv(u.world, false, world.toArray());
    gl.uniform1i(u.image, 0); gl.uniform1i(u.tutorial, program === 'shaders/mdl'); gl.activeTexture(gl.TEXTURE0);
    for (const submesh of data.submeshes) {
      const material = materials?.[submesh.material] ?? (program === 'shaders/mdl' ? {source: {face_culling: 'cw'}} : undefined);
      requireCondition(material, 'INVALID_MATERIAL_SLOT', `Missing material ${submesh.material}`);
      const state = material.source;
      const cull = state.face_culling ?? 'cw';
      if (cull === 'disabled') gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(cull === 'cw' ? gl.CCW : gl.CW); }
      const depth = state.depth_test ?? 'less';
      if (depth === 'disabled') gl.disable(gl.DEPTH_TEST);
      else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(depth === 'leq' ? gl.LEQUAL : depth === 'always' ? gl.ALWAYS : gl.LESS); }
      gl.depthMask(state.write_z ?? true); gl.colorMask(...['r','g','b','a'].map(c => state[`write_${c}`] ?? true)); gl.disable(gl.BLEND);
      gl.uniform4fv(u.color, material.color ?? [1,1,1,1]); gl.uniform1i(u.textured, !!material.picture);
      gl.bindTexture(gl.TEXTURE_2D, material.picture ? this.prepareTexture(material.picture) : this.#white);
      gl.drawElements(gl.TRIANGLES, submesh.indexCount, gpu.indexType, submesh.firstIndex * gpu.indexSize);
      ++this.#draws; this.#triangles += submesh.indexCount / 3;
    }
    gl.bindVertexArray(null);
  }
  submit(scene) {
    this.#alive();
    const camera = scene.GetCurrentCamera(); requireCondition(camera.IsValid() && camera.IsEnabled(), 'INVALID_CAMERA', 'Scene has no enabled current camera');
    const {viewProjection} = scene.ComputeCurrentCameraViewState(ComputeAspectRatioX(this.canvas.width, this.canvas.height));
    this.beginFrame(scene.canvas.color, {clearColor: scene.canvas.clear_color, clearDepth: scene.canvas.clear_z});
    for (const node of scene.GetNodes()) {
      if (!node.IsEnabled()) continue;
      const object = node.GetObject(); if (!object.IsValid()) continue;
      const materials = Array.from({length: object.GetMaterialCount()}, (_, i) => object.GetMaterial(i));
      this.drawModel(object.GetModelRef(), 'shaders/unlit.hps', node.GetTransform().GetWorld(), viewProjection, materials);
    }
  }
  get stats() { return {...super.stats, meshDrawCalls: this.#draws, triangles: this.#triangles, meshes: this.#meshes.size,
    textures: this.#textures.size, staticPrograms: this.#program ? 1 : 0, gpuStaticBytes: this.#gpuBytes}; }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#meshes.values()]) entry.release();
    for (const entry of [...this.#textures.values()]) entry.release();
    if (this.#program) this.#gl.deleteProgram(this.#program);
    if (this.#white) this.#gl.deleteTexture(this.#white);
    this.#program = undefined; super.dispose();
  }
}

export function createUnlitMaterial(source, picture, {structure = false} = {}) {
  validateMaterial(source, {structure});
  const diagnostic = source.program === 'core/shader/pbr.hps';
  const uniform = (source.values ?? []).find(v => v.name === (diagnostic ? 'uBaseOpacityColor' : 'uColor'));
  return {source: structuredClone(source), color: uniform?.value.slice() ?? [1,1,1,1], picture: diagnostic ? undefined : picture, diagnostic};
}
