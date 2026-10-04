// Reviewed adapters of tutorials/resources/core/shader/{default,pbr}_{vs,fs}.sc
// and forward_pipeline.sh. HARFANG (C) 2022 Emmanuel Julien, NWNC HARFANG.
// Released under GPL/LGPL/Commercial Licence; this package uses GPL-3.0 (see LICENSE).
// Two programs (Phong/PBR); texture and alpha-cut features are runtime uniforms.
export function forwardVertexSource(pbr) { return `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec3 a_tangent;
layout(location=4) in vec3 a_binormal;
uniform mat4 u_mvp, u_world;
out vec3 v_world, v_normal, v_tangent, v_binormal;
out vec2 v_uv;
vec3 unpackNormal(vec3 n) { return floor((clamp(n,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0; }
void main() {
  gl_Position = u_mvp * vec4(a_position,1.0);
  v_world = (u_world * vec4(a_position,1.0)).xyz; v_uv = a_uv;
  mat3 m = mat3(u_world);
  ${pbr ? 'm = transpose(m);' : ''}
  m = mat3(normalize(m[0]),normalize(m[1]),normalize(m[2]));
  ${pbr ? 'm = transpose(m);' : ''}
  v_normal = m * unpackNormal(a_normal);
  v_tangent = (u_world * vec4(unpackNormal(a_tangent),0.0)).xyz;
  v_binormal = (u_world * vec4(unpackNormal(a_binormal),0.0)).xyz;
}`; }

const common = `
precision highp float;
in vec3 v_world, v_normal, v_tangent, v_binormal;
in vec2 v_uv;
uniform mat4 u_view;
uniform vec3 u_eye, u_ambient, u_fogColor;
uniform vec2 u_fog;
uniform vec4 u_lightPos[8], u_lightDir[8], u_lightDiffuse[8], u_lightSpecular[8];
uniform vec4 u_base, u_surface, u_self;
uniform sampler2D u_baseMap, u_surfaceMap, u_normalMap, u_selfMap;
uniform ivec4 u_maps;
uniform bool u_alphaCut;
out vec4 fragColor;
float attenuation(vec3 L, float dist, int i) {
  float k = u_lightPos[i].w > 0.0 ? max(1.0-dist*u_lightPos[i].w,0.0) : 1.0;
  float outer = u_lightDiffuse[i].w, inner = u_lightDir[i].w;
  if (outer > 0.0) {
    float c = dot(L,u_lightDir[i].xyz);
    k *= abs(outer-inner) < 1e-8 ? step(inner,c) : clamp(1.0-(c-inner)/(outer-inner),0.0,1.0);
  }
  return k;
}
vec3 fog(vec3 color) {
  float z = (u_view * vec4(v_world,1.0)).z;
  return mix(color,u_fogColor,clamp((z-u_fog.x)*u_fog.y,0.0,1.0));
}
vec3 safeNormalize(vec3 v) { return v * inversesqrt(max(dot(v,v),1e-16)); }
`;

const pbrMath = `
const float PI = 3.14159265358979323846;
vec3 srgbToLinear(vec3 v) {
  return mix(pow((v+0.055)/1.055,vec3(2.4)), v*0.0773993808, lessThan(v,vec3(0.04045)));
}
float distribution(float NdotH, float roughness) {
  float a = roughness*roughness, a2 = a*a;
  float d = NdotH*NdotH*(a2-1.0)+1.0;
  return a2/max(PI*d*d,1e-8);
}
float geometry(float NdotW, float k) {
  float d = NdotW*(1.0-k)+k;
  return NdotW/(abs(d)>1e-8 ? d : 1e-8);
}
vec3 ggx(vec3 V, vec3 N, float NdotV, vec3 L, vec3 base, float rough, float metal, vec3 F0, vec3 diff, vec3 spec) {
  vec3 H = safeNormalize(V-L);
  float NdotH = max(dot(N,H),0.0), NdotL = max(-dot(N,L),0.0), HdotV = max(dot(H,V),0.0);
  float D = distribution(NdotH,rough), r = rough+1.0, k = r*r/8.0;
  float G = geometry(NdotV,k)*geometry(NdotL,k);
  vec3 F = F0+(1.0-F0)*pow(max(1.0-HdotV,0.0),5.0);
  vec3 specBRDF = F*D*G/max(4.0*NdotV*NdotL,0.001);
  vec3 diffBRDF = (1.0-F)*(1.0-metal)*base;
  return (diff*diffBRDF+spec*specBRDF)*NdotL;
}
`;

export function forwardFragmentSource(pbr) { return '#version 300 es\n' + common + (pbr ? pbrMath + `
void main() {
  vec4 base = u_maps.x != 0 ? texture(u_baseMap,v_uv) : u_base;
  if (u_maps.x != 0) base.rgb = srgbToLinear(base.rgb);
  if (u_alphaCut && base.a < 0.8) discard;
  vec3 orm = u_maps.y != 0 ? texture(u_surfaceMap,v_uv).rgb : u_surface.rgb;
  vec3 self = u_maps.w != 0 ? texture(u_selfMap,v_uv).rgb : u_self.rgb;
  vec3 V = safeNormalize(u_eye-v_world);
  vec3 N = sign(dot(V,v_normal))*safeNormalize(v_normal);
  if (u_maps.z != 0) {
    vec2 xy = texture(u_normalMap,v_uv).xy*2.0-1.0;
    vec3 mapped = vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
    N = safeNormalize(mat3(safeNormalize(v_tangent),safeNormalize(v_binormal),N)*mapped);
  }
  float NdotV = clamp(dot(N,V),0.0,0.99);
  vec3 F0 = mix(vec3(0.04),base.rgb,orm.b);
  vec3 color = ggx(V,N,NdotV,u_lightDir[0].xyz,base.rgb,orm.g,orm.b,F0,u_lightDiffuse[0].rgb,u_lightSpecular[0].rgb);
  for (int i=1; i<8; ++i) {
    vec3 L = v_world-u_lightPos[i].xyz; float dist = length(L); L /= max(dist,1e-8);
    float k = attenuation(L,dist,i);
    color += ggx(V,N,NdotV,L,base.rgb,orm.g,orm.b,F0,u_lightDiffuse[i].rgb*k,u_lightSpecular[i].rgb*k);
  }
  // W2 ambient path: no probe sampling, explicitly declared by the compiler.
  color = (color+u_ambient)*orm.r+self;
  fragColor = vec4(pow(max(fog(color),vec3(0.0)),vec3(1.0/2.2)),base.a);
}` : `
void main() {
  vec3 diff = u_maps.x != 0 ? texture(u_baseMap,v_uv).rgb : u_base.rgb;
  vec3 V = safeNormalize(u_eye-v_world), N = safeNormalize(v_normal), R = reflect(-V,N);
  float gloss = 64.0/max(u_surface.w,1e-8);
  vec3 cDiff = u_lightDiffuse[0].rgb*max(-dot(u_lightDir[0].xyz,N),0.0);
  vec3 cSpec = u_lightSpecular[0].rgb*pow(max(-dot(u_lightDir[0].xyz,R),0.0),gloss);
  for (int i=1; i<8; ++i) {
    vec3 L = v_world-u_lightPos[i].xyz; float dist = length(L); L /= max(dist,1e-8);
    float k = attenuation(L,dist,i);
    cDiff += u_lightDiffuse[i].rgb*max(-dot(L,N),0.0)*k;
    cSpec += u_lightSpecular[i].rgb*pow(max(-dot(L,R),0.0),gloss)*k;
  }
  vec3 color = diff*(cDiff+u_ambient)+u_surface.rgb*cSpec+u_self.rgb;
  fragColor = vec4(pow(max(fog(color),vec3(0.0)),vec3(1.0/2.2)),1.0);
}`); }
