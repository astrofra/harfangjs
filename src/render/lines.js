import {Color, Mat44, Vec3} from '../core/math.js';
import {integer, requireCondition, HarfangError} from '../core/errors.js';
import {HandlePool} from '../core/handles.js';
import {profile} from '../profile.js';

export const A_Position = 'Position', A_Color0 = 'Color0', AT_Float = 'Float';
export class VertexLayout {
  #attributes = []; #done = false; #colorCount=0;
  Begin() { this.#attributes = []; this.#done = false;this.#colorCount=0; return this; }
  Add(attribute, count, type) {
    requireCondition(!this.#done && (count===3||attribute===A_Color0&&count===4) && type === AT_Float, 'UNSUPPORTED_LAYOUT', 'Position requires Float x3; Color0 requires Float x3 or x4');
    if(attribute===A_Color0)this.#colorCount=count;
    this.#attributes.push(attribute); return this;
  }
  End() {
    requireCondition(['Position', 'Position,Color0'].includes(this.#attributes.join(',')), 'UNSUPPORTED_LAYOUT', 'Supported layouts are Position and Position + Color0');
    this.#done = true; return this;
  }
  get hasColor() { requireCondition(this.#done, 'INVALID_LAYOUT', 'Call End() first'); return this.#attributes.length === 2; }
  get colorCount(){return this.hasColor?this.#colorCount:0;}
}
export class Vertices {
  #data; #capacity; #color; #cursor = -1; #written = new Set(); #positionSet = false; #colorSet = false;
  constructor(layout, count) {
    this.#capacity = integer(count, 2, profile.limits.maxLineVertices, 'vertex count');
    this.#color = layout.colorCount;
    this.#data = new Float32Array(count * (3+this.#color));
  }
  #alive() { requireCondition(this.#data, 'DISPOSED', 'Vertices are disposed'); }
  Clear() { this.#alive(); this.#written.clear(); this.#cursor = -1; return this; }
  Begin(index) {
    this.#alive(); this.#cursor = integer(index, 0, this.#capacity - 1, 'vertex index');
    this.#positionSet = this.#colorSet = false; return this;
  }
  SetPos(position) {
    this.#alive();
    requireCondition(this.#cursor >= 0 && position instanceof Vec3, 'INVALID_VERTEX', 'Begin(index) and Vec3 position required');
    this.#data.set(position.data, this.#cursor * this.stride); this.#positionSet = true; return this;
  }
  SetColor0(color) {
    this.#alive();
    requireCondition(this.#cursor >= 0 && this.#color && color instanceof Color, 'INVALID_VERTEX', 'Color0 layout and Color required');
    this.#data.set(color.data.subarray(0, this.#color), this.#cursor * this.stride + 3); this.#colorSet = true; return this;
  }
  End() {
    requireCondition(this.#cursor >= 0 && this.#positionSet && (!this.#color || this.#colorSet), 'INVALID_VERTEX', 'Vertex attributes are incomplete');
    this.#written.add(this.#cursor); this.#cursor = -1; return this;
  }
  get stride() { return 3+this.#color; }
  get hasColor() { return !!this.#color; }
  get count() { return this.#written.size; }
  dataForUpload() {
    this.#alive();
    requireCondition(this.#cursor === -1 && this.count % 2 === 0 && [...this.#written].every(i => i < this.count),
      'INVALID_VERTEX', 'DrawLines needs consecutive complete pairs of vertices');
    return this.#data.subarray(0, this.count * this.stride);
  }
  dispose() { this.#data = undefined; this.#written.clear(); }
}

const programTokens = new WeakMap();
class LineProgram {
  #renderer; #pool; #token;
  constructor(renderer, pool, token) {
    this.#renderer = renderer; this.#pool = pool; this.#token = token; programTokens.set(this, token);
  }
  IsValid() { return this.#pool.valid(this.#token); }
  dispose() { if (this.IsValid()) this.#renderer.releaseProgram(this); }
}
export class LineRenderer {
  #gl; #buffer; #vao; #programs = new HandlePool(); #livePrograms = new Set(); #disposed = false;
  #drawCalls = 0; #vertices = 0; #bufferBytes = 0;
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: true, depth: true});
    requireCondition(gl, 'WEBGL2_REQUIRED', 'A WebGL 2 context is required');
    this.canvas = canvas; this.#gl = gl;
    this.capabilities = Object.freeze({renderer: 'WebGL2', version: gl.getParameter(gl.VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxViewportDimensions: [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)],
      antialias: gl.getContextAttributes().antialias});
    this.#buffer = gl.createBuffer(); this.#vao = gl.createVertexArray();
    if (!this.#buffer || !this.#vao) { LineRenderer.prototype.dispose.call(this); throw new HarfangError('GPU_ALLOCATION_FAILED', 'Cannot allocate line buffers'); }
  }
  #alive() {
    requireCondition(!this.#disposed, 'DISPOSED', 'Renderer is disposed');
    requireCondition(!this.#gl.isContextLost(), 'CONTEXT_LOST', 'WebGL context lost; restart the application after restoration');
  }
  createLineProgram(logicalId, compiledSources) {
    this.#alive();
    requireCondition(logicalId === 'shaders/pos_rgb', 'UNSUPPORTED_PROGRAM', 'No reviewed WebGL line adapter', logicalId);
    requireCondition(typeof compiledSources?.vertex === 'string' && typeof compiledSources?.fragment === 'string',
      'UNSUPPORTED_PROGRAM', 'Expected shader sources compiled by assetc-web', logicalId);
    const gl = this.#gl, shaders = [];
    let program;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, compiledSources.vertex], [gl.FRAGMENT_SHADER, compiledSources.fragment]]) {
        const shader = gl.createShader(type);
        requireCondition(shader, 'GPU_ALLOCATION_FAILED', 'Cannot allocate shader', logicalId);
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        requireCondition(gl.getShaderParameter(shader, gl.COMPILE_STATUS), 'SHADER_FAILED', gl.getShaderInfoLog(shader), logicalId);
      }
      program = gl.createProgram();
      requireCondition(program, 'GPU_ALLOCATION_FAILED', 'Cannot allocate program', logicalId);
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      requireCondition(gl.getProgramParameter(program, gl.LINK_STATUS), 'SHADER_FAILED', gl.getProgramInfoLog(program), logicalId);
      const token = this.#programs.allocate({program, matrix: gl.getUniformLocation(program, 'u_modelViewProj'), color: logicalId === 'shaders/pos_rgb'});
      const wrapper = new LineProgram(this, this.#programs, token); this.#livePrograms.add(wrapper); return wrapper;
    } catch (error) { if (program) gl.deleteProgram(program); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  releaseProgram(wrapper) {
    const token = programTokens.get(wrapper);
    this.#gl.deleteProgram(this.#programs.get(token).program);
    this.#programs.release(token); this.#livePrograms.delete(wrapper);
  }
  beginFrame(color = new Color(0.04, 0.05, 0.07), {clearColor = true, clearDepth = true} = {}) {
    this.#alive();
    requireCondition(color instanceof Color, 'INVALID_ARGUMENT', 'Clear color requires Color');
    const gl = this.#gl;
    this.#drawCalls = this.#vertices = 0;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS); gl.depthMask(true); gl.clearDepth(1);
    gl.colorMask(true,true,true,true); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(color.r, color.g, color.b, color.a); gl.clear((clearColor ? gl.COLOR_BUFFER_BIT : 0) | (clearDepth ? gl.DEPTH_BUFFER_BIT : 0));
  }
  drawLines(vertices, wrapper, matrix = Mat44.Identity) {
    this.#alive();
    const gl = this.#gl, entry = this.#programs.get(programTokens.get(wrapper));
    requireCondition(vertices instanceof Vertices && entry.color === vertices.hasColor, 'UNSUPPORTED_LAYOUT', 'Program and line layout do not match');
    requireCondition(matrix instanceof Mat44, 'INVALID_ARGUMENT', 'drawLines requires a Mat44 projection/model-view matrix');
    const data = vertices.dataForUpload();
    gl.bindVertexArray(this.#vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    if (data.byteLength > this.#bufferBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW); this.#bufferBytes = data.byteLength;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, vertices.stride * 4, 0);
    if (entry.color) { gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, vertices.stride-3, gl.FLOAT, false, vertices.stride*4, 12); }
    else { gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 1, 1, 1); }
    gl.useProgram(entry.program); gl.uniformMatrix4fv(entry.matrix, false, matrix.toArray());
    gl.drawArrays(gl.LINES, 0, vertices.count); gl.bindVertexArray(null);
    ++this.#drawCalls; this.#vertices += vertices.count;
  }
  get stats() { return {drawCalls: this.#drawCalls, vertices: this.#vertices, programs: this.#programs.size, gpuBufferBytes: this.#bufferBytes}; }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const wrapper of [...this.#livePrograms]) wrapper.dispose();
    this.#programs.dispose();
    this.#gl.deleteBuffer(this.#buffer); this.#gl.deleteVertexArray(this.#vao); this.#bufferBytes = 0;
  }
}
