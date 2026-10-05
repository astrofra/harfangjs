#version 300 es
// Adapted from HARFANG default_fs.sc / forward_pipeline.sh (GPL-3.0).
precision highp float;
precision highp sampler2DShadow;
in vec3 v_world, v_normal;
uniform mat4 u_view, u_shadowProjection;
uniform vec3 u_eye, u_ambient, u_fogColor;
uniform vec2 u_fog;
uniform vec4 u_lightPos[8], u_lightDir[8], u_lightDiffuse[8], u_lightSpecular[8];
uniform vec4 u_base, u_surface, u_self;
uniform sampler2DShadow u_shadowMap;
uniform bool u_hasShadow;
uniform float u_shadowBias, u_shadowTexel;
out vec4 fragColor;
float shadowFactor() {
  vec4 clip = u_shadowProjection*vec4(v_world,1.0);
  vec3 p = clip.xyz/clip.w*0.5+0.5;
  float result = 0.0;
  for (int y=0; y<2; ++y) for (int x=0; x<2; ++x)
    result += texture(u_shadowMap,vec3(p.xy+(vec2(x,y)-0.5)*u_shadowTexel,p.z-u_shadowBias));
  return result*0.25;
}
void main() {
  vec3 V = normalize(u_eye-v_world), N = normalize(v_normal), R = reflect(-V,N);
  float gloss = 64.0/max(u_surface.w,1e-8);
  vec3 diffuse = u_lightDiffuse[0].rgb*max(-dot(u_lightDir[0].xyz,N),0.0);
  vec3 specular = u_lightSpecular[0].rgb*pow(max(-dot(u_lightDir[0].xyz,R),0.0),gloss);
  for (int i=1; i<8; ++i) {
    vec3 incident = v_world-u_lightPos[i].xyz;
    float distanceToLight = length(incident);
    vec3 L = incident/max(distanceToLight,1e-8);
    float k = u_lightPos[i].w>0.0 ? max(1.0-distanceToLight*u_lightPos[i].w,0.0) : 1.0;
    float outer = u_lightDiffuse[i].w, inner = u_lightDir[i].w;
    if (outer>0.0) {
      float cosine = dot(L,u_lightDir[i].xyz);
      k *= abs(outer-inner)<1e-8 ? step(inner,cosine) : clamp(1.0-(cosine-inner)/(outer-inner),0.0,1.0);
    }
    if (i==1 && u_hasShadow) k *= shadowFactor();
    diffuse += u_lightDiffuse[i].rgb*max(-dot(L,N),0.0)*k;
    specular += u_lightSpecular[i].rgb*pow(max(-dot(L,R),0.0),gloss)*k;
  }
  vec3 color = u_base.rgb*(diffuse+u_ambient)+u_surface.rgb*specular+u_self.rgb;
  float distanceInView = (u_view*vec4(v_world,1.0)).z;
  color = mix(color,u_fogColor,clamp((distanceInView-u_fog.x)*u_fog.y,0.0,1.0));
  fragColor = vec4(pow(max(color,vec3(0)),vec3(1.0/2.2)),1.0);
}
