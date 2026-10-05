import {HandlePool} from '../core/handles.js';
import {finite, integer, requireCondition} from '../core/errors.js';
import {profile} from '../profile.js';

const models = new HandlePool(), refs = new WeakMap(), observers = new WeakMap();
export function modelData(model) { return models.get(refs.get(model)); }
export function watchModel(model, callback) {
  modelData(model); let set = observers.get(model);
  if (!set) { set = new Set(); observers.set(model, set); }
  set.add(callback); return () => set.delete(callback);
}
export class Model {
  constructor(vertices, indices, submeshes, bounds, stride = 8) {
    requireCondition([8,14].includes(stride) && vertices instanceof Float32Array && vertices.length % stride === 0, 'INVALID_MESH', 'Expected position/normal/UV float32 vertices with optional tangent frame');
    integer(vertices.length / stride, 3, profile.limits.maxMeshVertices, 'mesh vertex count');
    requireCondition(indices instanceof Uint16Array || indices instanceof Uint32Array, 'INVALID_MESH', 'Expected uint16/uint32 indices');
    integer(indices.length, 3, profile.limits.maxMeshIndices, 'index count');
    requireCondition(indices.length % 3 === 0 && indices.every(i => i < vertices.length / stride), 'INVALID_MESH', 'Triangle index is out of range');
    for (const value of vertices) finite(value);
    requireCondition(Array.isArray(submeshes) && submeshes.length > 0, 'INVALID_MESH', 'Missing submeshes');
    let end = 0;
    for (const submesh of submeshes) {
      integer(submesh.material, 0, 255, 'material slot'); integer(submesh.indexCount, 3, indices.length, 'submesh count');
      requireCondition(submesh.firstIndex === end && submesh.indexCount % 3 === 0, 'INVALID_MESH', 'Submeshes must partition the index buffer');
      end += submesh.indexCount;
    }
    requireCondition(end === indices.length, 'INVALID_MESH', 'Submesh ranges do not cover indices');
    const actual = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
    for (let i = 0; i < vertices.length; i += stride) for (let j = 0; j < 3; ++j) {
      actual.min[j] = Math.min(actual.min[j], vertices[i + j]); actual.max[j] = Math.max(actual.max[j], vertices[i + j]);
    }
    if (bounds) for (const key of ['min', 'max']) {
      requireCondition(Array.isArray(bounds[key]) && bounds[key].length === 3, 'INVALID_MESH', 'Invalid bounds');
      bounds[key].forEach((n, i) => requireCondition(Number.isFinite(n) && Math.abs(n - actual[key][i]) < 0.001, 'INVALID_MESH', 'Bounds do not match positions'));
    }
    const parts = submeshes.map(part => {
      const bounds = {min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity]};
      for (let i = part.firstIndex; i < part.firstIndex + part.indexCount; ++i) for (let c = 0; c < 3; ++c) {
        const value = vertices[indices[i] * stride + c];
        bounds.min[c] = Math.min(bounds.min[c], value); bounds.max[c] = Math.max(bounds.max[c], value);
      }
      return {...part, bounds};
    });
    refs.set(this, models.allocate({vertices: vertices.slice(), indices: indices.slice(), submeshes: parts, bounds: actual, stride}));
  }
  IsValid() { return models.valid(refs.get(this)); }
  get bounds() { return structuredClone(modelData(this).bounds); }
  get submeshes() { return structuredClone(modelData(this).submeshes); }
  get vertexCount() { const data = modelData(this); return data.vertices.length / data.stride; }
  get hasTangents() { return modelData(this).stride === 14; }
  get indexCount() { return modelData(this).indices.length; }
  dispose() {
    if (!this.IsValid()) return;
    models.release(refs.get(this));
    const errors = [];
    for (const callback of observers.get(this) ?? []) { try { callback(); } catch (e) { errors.push(e); } }
    observers.delete(this);
    if (errors.length) throw new AggregateError(errors, 'Model cleanup failed');
  }
}

export function decodeMesh(descriptor, buffer) {
  requireCondition(['harfang-web-mesh/1','harfang-web-mesh/2'].includes(descriptor?.schema) && descriptor.primitive === 'triangles' && descriptor.byteOrder === 'little',
    'INVALID_MESH', 'Unsupported mesh schema, primitive or byte order');
  const attributes = [
    {name: 'position', type: 'float32', components: 3, offset: 0},
    {name: 'normal', type: 'float32', components: 3, offset: 12},
    {name: 'uv0', type: 'float32', components: 2, offset: 24}
  ];
  const stride = descriptor.schema === 'harfang-web-mesh/2' ? 56 : 32;
  if (stride === 56) attributes.push({name: 'tangent', type: 'float32', components: 3, offset: 32}, {name: 'binormal', type: 'float32', components: 3, offset: 44});
  requireCondition(Array.isArray(descriptor.attributes) && descriptor.attributes.length === attributes.length &&
    attributes.every((attribute, i) => Object.entries(attribute).every(([key,value]) => descriptor.attributes[i]?.[key] === value)) &&
    descriptor.stride === stride && buffer instanceof ArrayBuffer, 'INVALID_MESH', 'Unsupported mesh layout or buffer');
  const count = integer(descriptor.vertexCount, 3, profile.limits.maxMeshVertices, 'vertex count');
  const indexCount = integer(descriptor.indexCount, 3, profile.limits.maxMeshIndices, 'index count');
  const indexSize = descriptor.indexType === 'uint16' ? 2 : descriptor.indexType === 'uint32' ? 4 : 0;
  requireCondition(indexSize && descriptor.indexOffset === count * stride && buffer.byteLength === count * stride + indexCount * indexSize,
    'INVALID_MESH', 'Invalid mesh buffer length or alignment');
  const view = new DataView(buffer), vertices = new Float32Array(count * stride / 4);
  for (let i = 0; i < vertices.length; ++i) vertices[i] = view.getFloat32(i * 4, true);
  const indices = indexSize === 2 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  for (let i = 0; i < indices.length; ++i) indices[i] = indexSize === 2 ? view.getUint16(count * stride + i * 2, true) : view.getUint32(count * stride + i * 4, true);
  return new Model(vertices, indices, descriptor.submeshes, descriptor.bounds, stride / 4);
}

export function VertexLayoutPosFloatNormUInt8() { return Object.freeze({kind: 'position-normal-unorm8'}); }
function requireLayout(layout) { requireCondition(layout?.kind === 'position-normal-unorm8', 'UNSUPPORTED_LAYOUT', 'Model tutorial requires VertexLayoutPosFloatNormUInt8'); }
// Same rings, seam and triangle fans as engine/create_geometry.cpp.
export function CreateSphereModel(layout, radius, subdivisionsX, subdivisionsY) {
  requireLayout(layout);
  requireCondition(finite(radius) > 0, 'INVALID_MESH', 'Sphere radius must be positive');
  integer(subdivisionsX, 1, 512, 'sphere latitude subdivisions');
  integer(subdivisionsY, 3, 512, 'sphere longitude subdivisions');
  const vertices = [], indices = [], f = Math.fround;
  const vertex = (x,y,z) => {
    const length = Math.hypot(x,y,z), index = vertices.length / 8;
    vertices.push(x,y,z,x/length,y/length,z/length,0,0); return index;
  };
  const top = vertex(0,radius,0), bottom = vertex(0,-radius,0);
  let previous;
  for (let s=0; s<=subdivisionsX; ++s) {
    const angle = f(f((s+1)/(subdivisionsX+2))*f(Math.PI));
    const y = f(f(Math.cos(angle))*f(radius)), r = f(f(Math.sin(angle))*f(radius)), ring = [];
    for (let c=0; c<=subdivisionsY; ++c) {
      const a = f(f(c*f(2*Math.PI))/subdivisionsY);
      ring.push(vertex(f(f(Math.cos(a))*r),y,f(f(Math.sin(a))*r)));
      if (!c) continue;
      const i = ring[c-1], j = ring[c];
      if (s === 0) indices.push(top,i,j);
      else indices.push(previous[c],previous[c-1],i,previous[c],i,j);
      if (s === subdivisionsX) indices.push(i,bottom,j);
    }
    previous = ring;
  }
  const Index = vertices.length / 8 > 65535 ? Uint32Array : Uint16Array;
  return new Model(new Float32Array(vertices), new Index(indices), [{material:0,firstIndex:0,indexCount:indices.length}]);
}
export function CreateCubeModel(layout, width, height, depth) {
  requireLayout(layout); [width, height, depth].forEach(n => requireCondition(finite(n) > 0, 'INVALID_ARGUMENT', 'Cube dimensions must be positive'));
  const x = width / 2, y = height / 2, z = depth / 2;
  const faces = [
    [[0, 0, -1], [[-x,-y,-z],[-x,y,-z],[x,y,-z],[x,-y,-z]], true],
    [[0, 0, 1], [[-x,-y,z],[-x,y,z],[x,y,z],[x,-y,z]], false],
    [[0, -1, 0], [[-x,-y,-z],[-x,-y,z],[x,-y,z],[x,-y,-z]], false],
    [[0, 1, 0], [[-x,y,-z],[-x,y,z],[x,y,z],[x,y,-z]], true],
    [[-1, 0, 0], [[-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z]], true],
    [[1, 0, 0], [[x,-y,-z],[x,-y,z],[x,y,z],[x,y,-z]], false]
  ];
  const vertices = [], indices = [], uv = [[0,0],[0,1],[1,1],[1,0]];
  faces.forEach(([normal, positions, reverse], face) => {
    positions.forEach((p, i) => vertices.push(...p, ...normal, ...uv[i]));
    const base = face * 4;
    indices.push(...(reverse ? [3,2,1,3,1,0] : [0,1,2,0,2,3]).map(i => base + i));
  });
  return new Model(new Float32Array(vertices), new Uint16Array(indices), [{material: 0, firstIndex: 0, indexCount: indices.length}]);
}
export function CreatePlaneModel(layout, width, depth, subdivisionsX = 1, subdivisionsZ = 1) {
  requireLayout(layout);
  requireCondition(subdivisionsX === 1 && subdivisionsZ === 1, 'UNSUPPORTED_MODEL', 'W1 plane construction supports one quad');
  [width, depth].forEach(n => requireCondition(finite(n) > 0, 'INVALID_ARGUMENT', 'Plane dimensions must be positive'));
  const x = width / 2, z = depth / 2;
  return new Model(new Float32Array([-x,0,-z, 0,1,0, 0,0, -x,0,z, 0,1,0, 0,1, x,0,z, 0,1,0, 1,1, x,0,-z, 0,1,0, 1,0]),
    new Uint16Array([3,2,1, 3,1,0]), [{material: 0, firstIndex: 0, indexCount: 6}]);
}
