import {getHost} from './context.js';
import {integer,requireCondition} from '../core/errors.js';
import {Mat44,Color} from '../core/math.js';
import {VertexLayout,A_Position,A_Color0,AT_Float,LineRenderer} from '../render/lines.js';
import {applyMaterialState} from '../render/forward.js';

export const BM_Additive=0,BM_Alpha=1,BM_Darken=2,BM_Lighten=3,BM_Multiply=4,BM_Opaque=5,BM_Screen=6,BM_LinearBurn=7,BM_AlphaRGB_AddAlpha=8;
export const DT_Less=0,DT_LessEqual=1,DT_Equal=2,DT_GreaterEqual=3,DT_Greater=4,DT_NotEqual=5,DT_Never=6,DT_Always=7,DT_Disabled=8;
export const FC_Disabled=0,FC_Clockwise=1,FC_CounterClockwise=2;
export const CF_Color=1,CF_Depth=2,CF_Stencil=4;
const states=new WeakMap();
export const blendModes=['add','alpha','darken','lighten','multiply','opaque','screen','linearburn','alphaRGB_addAlpha'];
export const depthTests=['less','leq','eq','geq','greater','neq','never','always','disabled'];
export const cullingModes=['disabled','cw','ccw'];
export class RenderState {constructor(){states.set(this,{});}}
export function ComputeRenderState(blend=BM_Opaque,depth=DT_Less,cull=FC_Clockwise,writeZ=true,writeR=true,writeG=true,writeB=true,writeA=true) {
  integer(blend,0,8,'blend mode');integer(depth,0,8,'depth test');integer(cull,0,2,'face culling');
  requireCondition([writeZ,writeR,writeG,writeB,writeA].every(v=>typeof v==='boolean'),'INVALID_ARGUMENT','Expected boolean write masks');
  const state=new RenderState();states.set(state,{blend_mode:blendModes[blend],
    depth_test:depthTests[depth],face_culling:cullingModes[cull],
    write_z:writeZ,write_r:writeR,write_g:writeG,write_b:writeB,write_a:writeA});return state;
}
export const VertexLayoutPosFloatColorFloat=()=>new VertexLayout().Begin().Add(A_Position,3,AT_Float).Add(A_Color0,4,AT_Float).End();
export function LoadProgramFromAssets(name) {
  const host=getHost(),program=host.assets.programs.get(name);
  requireCondition(program?.adapter==='pos-rgb/1','UNSUPPORTED_PROGRAM',`No compiled line program: ${name}`);
  host.lines??=new LineRenderer(host.canvas);return host.lines.createLineProgram(name,program.forward);
}
export function DestroyProgram(program){program?.dispose();}
export function SetView2D(id,x,y,width,height,near=-1,far=1,clearFlags=CF_Color|CF_Depth,clearColor=Color.Black,clearDepth=1,clearStencil=0,yUp=false) {
  integer(id,0,65535,'view ID');
  requireCondition([x,y,width,height,near,far,clearDepth].every(Number.isFinite)&&width>0&&height>0&&far>near&&clearColor instanceof Color&&typeof yUp==='boolean',
    'INVALID_ARGUMENT','Invalid 2D view');
  const host=getHost(),gl=host.renderer.gl;
  host.views2D??=new Map();host.views2D.set(id,{x,y,width,height,clearFlags,clearColor,clearDepth,clearStencil,cleared:false,
    matrix:new Mat44(2/width,0,0,0,0,(yUp?2:-2)/height,0,0,0,0,2/(far-near),0,-1,yUp?-1:1,-(far+near)/(far-near),1)});
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}
export function DrawLines(id,vertices,program,state=ComputeRenderState()) {
  const host=getHost(),gl=host.renderer.gl,view=host.views2D?.get(id);
  requireCondition(view&&states.has(state),'INVALID_ARGUMENT','Expected configured 2D view and RenderState');
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(view.x,host.canvas.height-view.y-view.height,view.width,view.height);
  if(!view.cleared) {
    gl.enable(gl.SCISSOR_TEST);gl.scissor(view.x,host.canvas.height-view.y-view.height,view.width,view.height);
    gl.depthMask(true);gl.colorMask(true,true,true,true);gl.clearColor(...view.clearColor.data);gl.clearDepth(view.clearDepth);gl.clearStencil(view.clearStencil);
    gl.clear((view.clearFlags&CF_Color?gl.COLOR_BUFFER_BIT:0)|(view.clearFlags&CF_Depth?gl.DEPTH_BUFFER_BIT:0)|(view.clearFlags&CF_Stencil?gl.STENCIL_BUFFER_BIT:0));
    gl.disable(gl.SCISSOR_TEST);view.cleared=true;
  }
  applyMaterialState(gl,states.get(state));host.lines.drawLines(vertices,program,view.matrix);
  requireCondition(gl.getError()===gl.NO_ERROR,'GPU_RENDER_FAILED','Line rendering failed');
}
