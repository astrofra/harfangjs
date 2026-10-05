#version 300 es
// Adapted from HARFANG pbr_vs.sc (GPL-3.0, see LICENSE).
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec3 a_tangent;
layout(location=8) in vec3 a_bitangent;
layout(location=4) in vec4 i_col0;
layout(location=5) in vec4 i_col1;
layout(location=6) in vec4 i_col2;
layout(location=7) in vec4 i_col3;
uniform mat4 u_viewProjection;
out vec3 v_world,v_normal,v_tangent,v_bitangent;
out vec2 v_uv;
void main() {
  mat4 world=mat4(i_col0,i_col1,i_col2,i_col3);
  vec4 p=world*vec4(a_position,1.0);v_world=p.xyz;v_uv=a_uv;
  vec3 n=floor((clamp(a_normal,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0;
  mat3 m=transpose(mat3(world));m=transpose(mat3(normalize(m[0]),normalize(m[1]),normalize(m[2])));
  v_normal=m*n;
  vec3 t=floor((clamp(a_tangent,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0;
  vec3 b=floor((clamp(a_bitangent,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0;
  v_tangent=mat3(world)*t;v_bitangent=mat3(world)*b;gl_Position=u_viewProjection*p;
}
