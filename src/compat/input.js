import {getHost} from './context.js';
import {requireCondition} from '../core/errors.js';

export class MouseState {
  constructor(snapshot) {this.x=Math.trunc(snapshot?.X()??0);this.y=Math.trunc(snapshot?.Y()??0);this.wheel=Math.trunc(snapshot?.Wheel()??0);this.buttons=new Set(snapshot?.down??[]);}
  X(){return this.x;} Y(){return this.y;} Wheel(){return this.wheel;} HWheel(){return 0;}
  Button(button){return this.buttons.has(button);}
}
export function ReadMouse(name='default') {
  requireCondition(name==='default','UNSUPPORTED_DEVICE','Only the default browser mouse is available');
  return new MouseState(getHost().input.mouse);
}
export class Mouse {
  constructor(name='default') {requireCondition(name==='default','UNSUPPORTED_DEVICE','Only the default browser mouse is available');this.name=name;this.current=new MouseState();this.previous=new MouseState();}
  Update(){this.previous=this.current;this.current=ReadMouse(this.name);}
  X(){return this.current.X();} Y(){return this.current.Y();}
  DtX(){return this.X()-this.previous.X();} DtY(){return this.Y()-this.previous.Y();}
  Wheel(){return this.current.Wheel();} HWheel(){return this.current.HWheel();}
  Down(button){return this.current.Button(button);}
  Pressed(button){return this.Down(button)&&!this.previous.Button(button);}
  Released(button){return !this.Down(button)&&this.previous.Button(button);}
  GetState(){return new MouseState({X:()=>this.X(),Y:()=>this.Y(),Wheel:()=>this.Wheel(),down:[...this.current.buttons]});}
  GetOldState(){return new MouseState({X:()=>this.previous.X(),Y:()=>this.previous.Y(),Wheel:()=>this.previous.Wheel(),down:[...this.previous.buttons]});}
}
