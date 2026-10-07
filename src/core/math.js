import {finite, integer, requireCondition} from './errors.js';

const f32 = v => {
  const result = Math.fround(finite(v));
  requireCondition(Number.isFinite(result), 'INVALID_ARGUMENT', 'Value exceeds float32 range');
  return result;
};

export class Vec2 {
  constructor(x = 0, y = x) {
    this.data = new Float32Array(x instanceof Vec2 ? x.data : [f32(x), f32(y)]);
  }
  get x() { return this.data[0]; } set x(v) { this.data[0] = f32(v); }
  get y() { return this.data[1]; } set y(v) { this.data[1] = f32(v); }
  equals(v) { return v instanceof Vec2 && this.x === v.x && this.y === v.y; }
}

export class Vec3 {
  constructor(x = 0, y = x, z = x) {
    this.data = new Float32Array(x instanceof Vec3 ? x.data : [f32(x), f32(y), f32(z)]);
  }
  get x() { return this.data[0]; } set x(v) { this.data[0] = f32(v); }
  get y() { return this.data[1]; } set y(v) { this.data[1] = f32(v); }
  get z() { return this.data[2]; } set z(v) { this.data[2] = f32(v); }
  add(v) { return v instanceof Vec3 ? new Vec3(this.x + v.x, this.y + v.y, this.z + v.z) : new Vec3(this.x + finite(v), this.y + v, this.z + v); }
  sub(v) { return v instanceof Vec3 ? new Vec3(this.x - v.x, this.y - v.y, this.z - v.z) : new Vec3(this.x - finite(v), this.y - v, this.z - v); }
  mul(v) { return v instanceof Vec3 ? new Vec3(this.x * v.x, this.y * v.y, this.z * v.z) : new Vec3(this.x * finite(v), this.y * v, this.z * v); }
  div(v) { return v instanceof Vec3 ? new Vec3(this.x / v.x, this.y / v.y, this.z / v.z) : this.mul(1 / finite(v)); }
  equals(v) { return v instanceof Vec3 && this.data.every((n, i) => n === v.data[i]); }
  static get Zero() { return new Vec3(); }
  static get One() { return new Vec3(1); }
  static get Right() { return new Vec3(1, 0, 0); }
  static get Up() { return new Vec3(0, 1, 0); }
  static get Front() { return new Vec3(0, 0, 1); }
}

export class Vec4 {
  constructor(x = 0, y = x, z = x, w = x) {
    this.data = new Float32Array(x instanceof Vec4 ? x.data : [f32(x), f32(y), f32(z), f32(w)]);
  }
  get x() { return this.data[0]; } set x(v) { this.data[0] = f32(v); }
  get y() { return this.data[1]; } set y(v) { this.data[1] = f32(v); }
  get z() { return this.data[2]; } set z(v) { this.data[2] = f32(v); }
  get w() { return this.data[3]; } set w(v) { this.data[3] = f32(v); }
  equals(v) { return v instanceof Vec4 && this.data.every((n, i) => n === v.data[i]); }
}

export class Color extends Vec4 {
  constructor(r = 0, g = r, b = r, a = 1) { super(r, g, b, a); }
  get r() { return this.x; } set r(v) { this.x = v; }
  get g() { return this.y; } set g(v) { this.y = v; }
  get b() { return this.z; } set b(v) { this.z = v; }
  get a() { return this.w; } set a(v) { this.w = v; }
  static get Black() { return new Color(0, 0, 0); }
  static get White() { return new Color(1, 1, 1); }
  static get Green() { return new Color(0, 1, 0); }
}

export const ColorI = (r, g = r, b = r, a = 255) => new Color(...[r, g, b, a].map(v => integer(v, 0, 255) / 255));
export const Deg = degrees => finite(degrees) * Math.PI / 180;
export const Deg3 = (x, y, z) => new Vec3(Deg(x), Deg(y), Deg(z));
export const Dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const Len = v => Math.sqrt(Dot(v, v));
export const Normalize = v => Len(v) === 0 ? Vec3.Zero : v.div(Len(v));
export const Cross = (a, b) => new Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

const identity44 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; ++c) for (let r = 0; r < 4; ++r) {
    let n = 0;
    for (let k = 0; k < 4; ++k) n += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = n;
  }
  return out;
}

export class Mat44 {
  constructor(...values) {
    const source = values.length === 1 && values[0] instanceof Mat4 ? values[0].toArray() :
      values.length === 1 && values[0] instanceof Mat44 ? values[0].data : values;
    requireCondition(source.length === 0 || source.length === 16, 'INVALID_ARGUMENT', 'Mat44 requires 16 column-major values');
    this.data = source.length ? Float32Array.from(source, f32) : identity44();
  }
  static get Identity() { return new Mat44(); }
  toArray() { return this.data.slice(); }
  equals(m) { return m instanceof Mat44 && this.data.every((n, i) => n === m.data[i]); }
  mul(value) {
    if (value instanceof Mat44 || value instanceof Mat4) return new Mat44(...multiply(this.data, value.toArray()));
    requireCondition(value instanceof Vec4, 'INVALID_ARGUMENT', 'Mat44.mul requires a matrix or Vec4');
    const v = value.data, m = this.data;
    return new Vec4(...[0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]));
  }
}

export class Mat4 {
  constructor(...values) {
    const source = values.length === 1 && values[0] instanceof Mat4 ? values[0].data : values;
    requireCondition(source.length === 0 || source.length === 12, 'INVALID_ARGUMENT', 'Mat4 requires 12 column-major affine values');
    this.data = source.length ? Float32Array.from(source, f32) : new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  }
  static get Identity() { return new Mat4(); }
  toArray() {
    const out = identity44();
    for (let c = 0; c < 4; ++c) for (let r = 0; r < 3; ++r) out[c * 4 + r] = this.data[c * 3 + r];
    return out;
  }
  equals(m) { return m instanceof Mat4 && this.data.every((n, i) => n === m.data[i]); }
  mul(value) {
    if (value instanceof Mat4) return affineFrom44(multiply(this.toArray(), value.toArray()));
    if (value instanceof Mat44) return new Mat44(...multiply(this.toArray(), value.data));
    if (value instanceof Vec4) return new Mat44(this).mul(value);
    requireCondition(value instanceof Vec3, 'INVALID_ARGUMENT', 'Mat4.mul requires a matrix or vector');
    const out = new Mat44(this).mul(new Vec4(value.x, value.y, value.z, 1));
    return new Vec3(out.x, out.y, out.z);
  }
}
function affineFrom44(m) {
  return new Mat4(...Array.from({length: 12}, (_, i) => m[Math.floor(i / 3) * 4 + i % 3]));
}
export function GetColumn(m, index) {
  integer(index, 0, m instanceof Mat3?2:3, 'column');
  return m instanceof Mat4 || m instanceof Mat3 ? new Vec3(...m.data.slice(index * 3, index * 3 + 3)) : new Vec4(...m.data.slice(index * 4, index * 4 + 4));
}
export const GetX = m => m instanceof Mat3 ? new Vec3(...m.data.slice(0,3)) : GetColumn(m,0);
export const GetY = m => m instanceof Mat3 ? new Vec3(...m.data.slice(3,6)) : GetColumn(m,1);
export const GetZ = m => m instanceof Mat3 ? new Vec3(...m.data.slice(6,9)) : GetColumn(m,2);
export const GetT = m => GetColumn(m, 3);
export const GetTranslation = GetT;
export const Clamp = (value,minimum,maximum) => value instanceof Vec3 ?
  new Vec3(...value.data.map((v,i)=>Clamp(v,minimum.data[i],maximum.data[i]))) :
  f32(Math.max(f32(minimum),Math.min(f32(maximum),f32(value))));
export const Mtr = value => f32(value);
// Native foundation/rand.cpp's xorshf96 sequence; all arithmetic is uint32.
let randomX=0x75bcd15,randomY=0x159a55e5,randomZ=0x1f123bb5;
export function Rand(range=32767) {
  integer(range,0,4294967295,'random range');if(!range)return 0;
  randomX^=randomX<<16;randomX^=randomX>>>5;randomX^=randomX<<1;
  const t=randomX;randomX=randomY;randomY=randomZ;randomZ=(t^randomX^randomY)>>>0;
  return randomZ%range;
}
export const FRand = (range=1) => f32(f32(Rand(65536)*f32(range))/65536);
export const FRRand = (lo=-1,hi=1) => f32(f32(Rand(65536)/65536*f32(f32(hi)-f32(lo)))+f32(lo));
export function RandomVec3(minimum=-1,maximum=1) {
  if(minimum instanceof Vec3&&maximum instanceof Vec3)
    return new Vec3(FRRand(minimum.x,maximum.x),FRRand(minimum.y,maximum.y),FRRand(minimum.z,maximum.z));
  return new Vec3(FRRand(minimum,maximum),FRRand(minimum,maximum),FRRand(minimum,maximum));
}
export class Mat3 {
  constructor(...values) {
    const source=values.length===1&&values[0] instanceof Mat3?values[0].data:
      values.length===3&&values.every(v=>v instanceof Vec3)?values.flatMap(v=>[...v.data]):values;
    requireCondition(source.length===0||source.length===9,'INVALID_ARGUMENT','Mat3 requires nine scalars or three Vec3 columns');
    this.data=source.length?Float32Array.from(source,f32):new Float32Array([1,0,0,0,1,0,0,0,1]);
  }
  static get Identity() { return new Mat3(); }
}
export function Mat3LookAt(front,up) {
  requireCondition(front instanceof Vec3 && (up===undefined||up instanceof Vec3),'INVALID_ARGUMENT','Expected Vec3 direction/up');
  const length=Len(front);if(Math.abs(length)<1e-6)return Mat3.Identity;
  const z=front.div(length);
  const x=up?Normalize(Cross(Normalize(up),z)):
    Math.abs(z.x)>1e-6||Math.abs(z.z)>1e-6?Normalize(new Vec3(z.z,0,-z.x)):new Vec3(-1,0,0);
  return new Mat3(x,up?Normalize(Cross(z,x)):Cross(z,x),z);
}
export function ToEuler(matrix,order=4) {
  requireCondition(matrix instanceof Mat3&&order===4,'UNSUPPORTED_OVERLOAD','ToEuler currently supports Mat3 with the native default YXZ order');
  const m=matrix.data, cosine=Math.hypot(m[1],m[4]), x=Math.atan2(-m[7],cosine);
  return cosine>1.1920929e-7?new Vec3(x,Math.atan2(m[6],m[8]),Math.atan2(m[1],m[4])):
    new Vec3(x,0,-Math.sign(-m[7])*Math.atan2(-m[2],m[0]));
}
export function Mat4LookAt(position,at,scale=Vec3.One) {
  const rotation=Mat3LookAt(at.sub(position));
  return new Mat4(...rotation.data,...position.data).mul(ScaleMat4(scale));
}
export const TranslationMat4 = p => new Mat4(1, 0, 0, 0, 1, 0, 0, 0, 1, p.x, p.y, p.z);
export const ScaleMat4 = s => new Mat4(s.x, 0, 0, 0, s.y, 0, 0, 0, s.z, 0, 0, 0);

export function RotationMat4(rotation) {
  // Native RO_Default = RO_YXZ: Ry * Rx * Rz, positive-Z forward.
  const {x, y, z} = rotation;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return new Mat4(cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,
    sy * cx, -sx, cy * cx, 0, 0, 0);
}
export const TransformationMat4 = (p, r, s = Vec3.One) => TranslationMat4(p).mul(RotationMat4(r)).mul(ScaleMat4(s));

export function Inverse(matrix) {
  requireCondition(matrix instanceof Mat4 || matrix instanceof Mat44, 'INVALID_ARGUMENT', 'Inverse requires a matrix');
  const source = matrix.toArray();
  const rows = Array.from({length: 4}, (_, r) => [...[0, 1, 2, 3].map(c => source[c * 4 + r]), ...[0, 1, 2, 3].map(c => +(c === r))]);
  for (let c = 0; c < 4; ++c) {
    let pivot = c;
    for (let r = c + 1; r < 4; ++r) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    if (Math.abs(rows[pivot][c]) < 1e-12) return [false, matrix instanceof Mat4 ? Mat4.Identity : Mat44.Identity];
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const divisor = rows[c][c];
    rows[c] = rows[c].map(n => n / divisor);
    for (let r = 0; r < 4; ++r) if (r !== c) {
      const factor = rows[r][c];
      rows[r] = rows[r].map((n, i) => n - factor * rows[c][i]);
    }
  }
  const out = Array.from({length: 16}, (_, i) => rows[i % 4][4 + Math.floor(i / 4)]);
  return [true, matrix instanceof Mat4 ? affineFrom44(out) : new Mat44(...out)];
}

export const ComputeAspectRatioX = (w, h) => new Vec2(finite(w) / finite(h), 1);
export const FovToZoomFactor = fov => 1 / Math.tan(Math.max(Deg(0.1), Math.min(Deg(179.9), finite(fov))) / 2);
function projectionArgs(near, far, size, aspect) {
  [near, far, size, aspect.x, aspect.y].forEach(v => finite(v));
  requireCondition(near >= 0 && far > near && size > 0 && aspect.x > 0 && aspect.y > 0, 'INVALID_ARGUMENT', 'Invalid projection range, size, or aspect');
}
export function ComputePerspectiveProjectionMatrix(near, far, zoom, aspect, offset = new Vec2(), center = new Vec2()) {
  projectionArgs(near, far, zoom, aspect);
  requireCondition(near > 0, 'INVALID_ARGUMENT', 'Perspective near plane must be positive');
  return new Mat44(zoom / aspect.x, 0, 0, 0, 0, zoom / aspect.y, 0, 0, center.x, center.y,
    (far + near) / (far - near), 1, offset.x, offset.y, -2 * far * near / (far - near), 0);
}
export function ComputeOrthographicProjectionMatrix(near, far, size, aspect, offset = new Vec2()) {
  projectionArgs(near, far, size, aspect);
  return new Mat44(2 / size / aspect.x, 0, 0, 0, 0, 2 / size / aspect.y, 0, 0, 0, 0,
    2 / (far - near), 0, offset.x, offset.y, -(far + near) / (far - near), 1);
}
export class ViewState {
  constructor() { this.view=Mat4.Identity;this.proj=Mat44.Identity; }
  get viewProjection() { return this.proj.mul(new Mat44(this.view)); }
}
export function ComputePerspectiveViewState(world,fov,near,far,aspect) {
  requireCondition(world instanceof Mat4,'INVALID_ARGUMENT','Expected camera world Mat4');
  const [ok,view]=Inverse(world);requireCondition(ok,'INVALID_CAMERA','Singular camera transform');
  const state=new ViewState();state.view=view;state.proj=ComputePerspectiveProjectionMatrix(near,far,FovToZoomFactor(fov),aspect);
  return state;
}
export function ProjectToClipSpace(projection, point) {
  const p = projection.mul(new Vec4(point.x, point.y, point.z, 1));
  return p.w <= 0 ? [false, Vec3.Zero] : [true, new Vec3(p.x / p.w, p.y / p.w, p.z / p.w)];
}
export function ProjectToScreenSpace(projection, point, resolution) {
  const [ok, p] = ProjectToClipSpace(projection, point);
  return [ok, ok ? new Vec3((p.x + 1) * resolution.x / 2, (p.y + 1) * resolution.y / 2, p.z) : Vec3.Zero];
}
