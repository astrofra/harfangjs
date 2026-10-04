export function createBehavior() {
  return {
    a: 4, updates: 0, attached: false,
    OnAttach(node) { this.attached = node.IsValid(); },
    OnSetScriptValue(name) { this.lastParameter = name; },
    OnUpdate() { ++this.updates; },
    OnDetach() { this.attached = false; },
    OnDestroy() { this.destroyed = true; },
    CallToReturnValue() { return `String returned from scene behavior to host (${this.a})`; },
    Echo(value) { return value; },
    NodeName(node) { return node.GetName(); }
  };
}
