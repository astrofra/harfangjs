#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=4) in vec4 i_col0;
layout(location=5) in vec4 i_col1;
layout(location=6) in vec4 i_col2;
layout(location=7) in vec4 i_col3;
uniform mat4 u_viewProjection;
void main() { gl_Position = u_viewProjection*mat4(i_col0,i_col1,i_col2,i_col3)*vec4(a_position,1.0); }
