#version 300 es
// Adapted from HARFANG default_vs.sc (GPL-3.0, see LICENSE).
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=4) in vec4 i_col0;
layout(location=5) in vec4 i_col1;
layout(location=6) in vec4 i_col2;
layout(location=7) in vec4 i_col3;
uniform mat4 u_viewProjection;
out vec3 v_world, v_normal;
void main() {
  mat4 world = mat4(i_col0,i_col1,i_col2,i_col3);
  vec4 p = world * vec4(a_position,1.0);
  v_world = p.xyz;
  vec3 n = floor((clamp(a_normal,-1.0,1.0)*0.5+0.5)*255.0)/255.0*2.0-1.0;
  v_normal = mat3(normalize(world[0].xyz),normalize(world[1].xyz),normalize(world[2].xyz))*n;
  gl_Position = u_viewProjection*p;
}
