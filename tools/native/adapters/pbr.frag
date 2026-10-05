#version 300 es
// Reviewed non-AAA PBR, legacy global IBL and four directional splits.
// Derived from HARFANG pbr_fs.sc / forward_pipeline.sh (GPL-3.0).
precision highp float;
precision highp sampler2DShadow;
in vec3 v_world,v_normal;
in vec2 v_uv;
uniform mat4 u_view,u_linearProjection[4];
uniform vec3 u_eye,u_ambient,u_fogColor;
uniform vec2 u_fog;
uniform vec4 u_lightPos[8],u_lightDir[8],u_lightDiffuse[8],u_lightSpecular[8];
uniform vec4 u_base,u_surface,u_self,u_linearSplits;
uniform sampler2D u_baseMap,u_brdfMap;
uniform samplerCube u_irradianceMap,u_radianceMap;
uniform sampler2DShadow u_linearShadowMap;
uniform bool u_hasBaseMap,u_hasEnvironment,u_hasLinearShadow;
uniform float u_linearShadowBias,u_linearShadowTexel;
out vec4 fragColor;
const float PI=3.14159265358979323846;
vec3 srgbToLinear(vec3 v) {return mix(pow((v+0.055)/1.055,vec3(2.4)),v*0.0773993808,lessThan(v,vec3(0.04045)));}
vec3 safeNormalize(vec3 v) {return v*inversesqrt(max(dot(v,v),1e-16));}
float distribution(float ndh,float rough) {float a=rough*rough,a2=a*a,d=ndh*ndh*(a2-1.0)+1.0;return a2/max(PI*d*d,1e-8);}
float geometry(float ndw,float k) {float d=ndw*(1.0-k)+k;return ndw/(abs(d)>1e-8?d:1e-8);}
vec3 ggx(vec3 V,vec3 N,float ndv,vec3 L,vec3 base,float rough,float metal,vec3 f0,vec3 diff,vec3 spec) {
  vec3 H=safeNormalize(V-L);float ndh=max(dot(N,H),0.0),ndl=max(-dot(N,L),0.0),hdv=max(dot(H,V),0.0);
  float D=distribution(ndh,rough),r=rough+1.0,k=r*r/8.0,G=geometry(ndv,k)*geometry(ndl,k);
  vec3 F=f0+(1.0-f0)*pow(max(1.0-hdv,0.0),5.0);
  return (diff*(1.0-F)*(1.0-metal)*base+spec*F*D*G/max(4.0*ndv*ndl,0.001))*ndl;
}
float shadowPCF(int slice) {
  vec4 clip=u_linearProjection[slice]*vec4(v_world,1.0);vec3 p=clip.xyz/clip.w*0.5+0.5;
  p.xy=p.xy*0.5+vec2(float(slice&1),float((slice>>1)&1))*0.5;
  float result=0.0;
  for(int y=0;y<2;++y)for(int x=0;x<2;++x)result+=texture(u_linearShadowMap,vec3(p.xy+(vec2(x,y)-0.5)*u_linearShadowTexel,p.z-u_linearShadowBias));
  return result*0.25;
}
void main() {
  vec4 base=u_hasBaseMap?texture(u_baseMap,v_uv):u_base;if(u_hasBaseMap)base.rgb=srgbToLinear(base.rgb);
  vec3 orm=u_surface.rgb,V=safeNormalize(u_eye-v_world),N=sign(dot(V,v_normal))*safeNormalize(v_normal),R=reflect(-V,N);
  float ndv=clamp(dot(N,V),0.0,0.99),viewZ=(u_view*vec4(v_world,1.0)).z;
  vec3 f0=mix(vec3(0.04),base.rgb,orm.b);float shadow=1.0;
  if(u_hasLinearShadow) {
    if(viewZ<u_linearSplits.x)shadow=shadowPCF(0);
    else if(viewZ<u_linearSplits.y)shadow=shadowPCF(1);
    else if(viewZ<u_linearSplits.z)shadow=shadowPCF(2);
    else if(viewZ<u_linearSplits.w) {float ramp=(u_linearSplits.w-u_linearSplits.z)*0.25;shadow=mix(shadowPCF(3),1.0,clamp((viewZ-(u_linearSplits.w-ramp))/max(ramp,1e-8),0.0,1.0));}
  }
  vec3 color=ggx(V,N,ndv,u_lightDir[0].xyz,base.rgb,orm.g,orm.b,f0,u_lightDiffuse[0].rgb*shadow,u_lightSpecular[0].rgb*shadow);
  for(int i=1;i<8;++i) {
    vec3 L=v_world-u_lightPos[i].xyz;float dist=length(L);L/=max(dist,1e-8);
    float k=u_lightPos[i].w>0.0?max(1.0-dist*u_lightPos[i].w,0.0):1.0;
    float outer=u_lightDiffuse[i].w,inner=u_lightDir[i].w;
    if(outer>0.0){float c=dot(L,u_lightDir[i].xyz);k*=abs(outer-inner)<1e-8?step(inner,c):clamp(1.0-(c-inner)/(outer-inner),0.0,1.0);}
    color+=ggx(V,N,ndv,L,base.rgb,orm.g,orm.b,f0,u_lightDiffuse[i].rgb*k,u_lightSpecular[i].rgb*k);
  }
  if(u_hasEnvironment) {
    vec3 irradiance=texture(u_irradianceMap,N).rgb,radiance=textureLod(u_radianceMap,R,orm.g*10.0).rgb;
    vec3 F=f0+(max(vec3(1.0-orm.g),f0)-f0)*pow(1.0-ndv,5.0);vec2 brdf=texture(u_brdfMap,vec2(ndv,orm.g)).rg;
    vec3 specular=radiance*(F*brdf.x+brdf.y);
    color+=(1.0-specular)*(1.0-orm.b)*irradiance*base.rgb+specular;
  }
  color=(color+u_ambient)*orm.r+u_self.rgb;
  color=mix(color,u_fogColor,clamp((viewZ-u_fog.x)*u_fog.y,0.0,1.0));
  fragColor=vec4(pow(max(color,vec3(0)),vec3(1.0/2.2)),base.a);
}
