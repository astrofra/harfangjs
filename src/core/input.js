export const K_Escape = 'Escape';
export const K_Space = 'Space';
export const K_Left = 'ArrowLeft';
export const K_Right = 'ArrowRight';
export const K_Up = 'ArrowUp';
export const K_Down = 'ArrowDown';
export const MB_0 = 0, MB_1 = 1, MB_2 = 2;

class Buttons {
  #down; #pressed; #released;
  constructor(down, pressed, released) {
    this.#down = new Set(down); this.#pressed = new Set(pressed); this.#released = new Set(released);
  }
  Down(key) { return this.#down.has(key); }
  Key(key) { return this.Down(key); }
  Button(key) { return this.Down(key); }
  Pressed(key) { return this.#pressed.has(key); }
  Released(key) { return this.#released.has(key); }
  get down() { return [...this.#down]; }
  get pressed() { return [...this.#pressed]; }
  get released() { return [...this.#released]; }
}
class MouseSnapshot extends Buttons {
  #position;
  constructor(state) {
    super(state.down, state.pressed, state.released);
    this.#position = {...state.position};
  }
  X() { return this.#position.x; }
  Y() { return this.#position.y; }
  DtX() { return this.#position.dx; }
  DtY() { return this.#position.dy; }
  Wheel() { return this.#position.wheel; }
}
const buttons = () => ({down: new Set(), pressed: new Set(), released: new Set()});
function transition(state, code, down) {
  if (down && !state.down.has(code)) { state.down.add(code); state.pressed.add(code); }
  if (!down && state.down.delete(code)) state.released.add(code);
}
export class InputManager {
  #keys = buttons(); #mouse = {...buttons(), position: {x: 0, y: 0, dx: 0, dy: 0, wheel: 0}};
  #listeners = []; #disposed = false;
  constructor() { this.snapshot(); }
  key(code, down) { if (!this.#disposed) transition(this.#keys, code, down); }
  button(code, down) { if (!this.#disposed) transition(this.#mouse, code, down); }
  move(x, y) {
    if (this.#disposed) return;
    const p = this.#mouse.position;
    p.dx += x - p.x; p.dy += y - p.y; p.x = x; p.y = y;
  }
  wheel(steps) { if (!this.#disposed) this.#mouse.position.wheel += steps; }
  snapshot() {
    this.keyboard = Object.freeze(new Buttons(this.#keys.down, this.#keys.pressed, this.#keys.released));
    this.mouse = Object.freeze(new MouseSnapshot(this.#mouse));
    for (const state of [this.#keys, this.#mouse]) { state.pressed.clear(); state.released.clear(); }
    this.#mouse.position.dx = this.#mouse.position.dy = this.#mouse.position.wheel = 0;
    return {keyboard: this.keyboard, mouse: this.mouse};
  }
  reset() {
    for (const state of [this.#keys, this.#mouse]) {
      state.pressed.clear();
      for (const key of state.down) state.released.add(key);
      state.down.clear();
    }
    this.#mouse.position.dx = this.#mouse.position.dy = this.#mouse.position.wheel = 0;
  }
  attach(canvas, windowObject = window) {
    const on = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.#listeners.push(() => target.removeEventListener(type, fn, options));
    };
    const oldTabIndex = canvas.getAttribute('tabindex');
    if (oldTabIndex === null) canvas.tabIndex = 0;
    this.#listeners.push(() => { if (oldTabIndex === null) canvas.removeAttribute('tabindex'); });
    on(canvas, 'keydown', event => {
      if (event.isComposing) return;
      this.key(event.code, true);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    });
    on(canvas, 'keyup', event => this.key(event.code, false));
    const move = event => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) this.move((event.clientX - rect.left) * canvas.width / rect.width,
        (rect.bottom - event.clientY) * canvas.height / rect.height);
    };
    on(canvas, 'pointermove', move);
    const mapButton = button => button === 1 ? 2 : button === 2 ? 1 : button;
    on(canvas, 'pointerdown', event => {
      if (event.pointerType !== 'mouse') return;
      canvas.focus(); move(event); this.button(mapButton(event.button), true);
      canvas.setPointerCapture(event.pointerId);
    });
    on(canvas, 'pointerup', event => { if (event.pointerType === 'mouse') this.button(mapButton(event.button), false); });
    on(canvas, 'pointercancel', () => this.reset());
    on(canvas, 'lostpointercapture', () => { for (const b of this.#mouse.down) this.button(b, false); });
    on(canvas, 'wheel', event => { this.wheel(-Math.sign(event.deltaY)); event.preventDefault(); }, {passive: false});
    on(canvas, 'contextmenu', event => event.preventDefault());
    on(canvas, 'blur', () => this.reset());
    on(windowObject, 'blur', () => this.reset());
    return this;
  }
  dispose() {
    if (this.#disposed) return;
    this.reset(); this.snapshot(); this.#disposed = true;
    for (const off of this.#listeners.splice(0)) off();
  }
}
