// Declarative shared contract. The offline writer reads the JSON after '='; keep this module data-only.
export const materialContract = {
  "families": {
    "shaders/unlit.hps": {
      "family": "unlit", "values": {"uColor": [1, 1, 1, 1]}, "textures": {"uColorMap": 0}, "flags": ["EnableAlphaCut"]
    },
    "core/shader/default.hps": {
      "family": "default", "values": {"uDiffuseColor": [0, 0, 0, 0], "uSpecularColor": [0, 0, 0, 1], "uSelfColor": [0, 0, 0, 0]},
      "textures": {"uDiffuseMap": 0}, "flags": []
    },
    "core/shader/pbr.hps": {
      "family": "pbr", "values": {"uBaseOpacityColor": [0, 0, 0, 0], "uOcclusionRoughnessMetalnessColor": [1, 1, 0, 0], "uSelfColor": [0, 0, 0, 0]},
      "textures": {"uBaseOpacityMap": 0, "uOcclusionRoughnessMetalnessMap": 1, "uNormalMap": 2, "uSelfMap": 4}, "flags": ["EnableAlphaCut"]
    }
  },
  "blendModes": ["opaque", "alpha", "add", "multiply", "screen", "darken", "lighten", "linearburn", "alphaRGB_addAlpha"],
  "depthTests": ["less", "leq", "eq", "geq", "greater", "neq", "never", "always", "disabled"],
  "culling": ["disabled", "cw", "ccw"]
};
