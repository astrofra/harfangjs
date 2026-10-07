# Web validation

The regression gates follow the supported native-compiler-to-browser pipeline.
Install `requirements-dev.txt` in a Python environment and provide Chrome, Edge
or Chromium. Then run:

```sh
python tools/validate.py
```

This audits runtime imports, builds `assetc-web`, packages all four demos and runs
their browser/compiler checks. `--demo many-nodes|mouse-flight|engine|pbr` selects
one demo; `--skip-build` validates the existing packages.

| Suite | Main checks |
| --- | --- |
| Compression | Upstream LZ4 vectors, malformed blocks, compressed/raw/mixed loading, stored/decoded hashes, decoded budgets, progress and corrupt-package rollback |
| Many Nodes | Compiler determinism/rejection, native API fixture, instancing/shadows, input/lifecycle, resource cleanup, corrupt assets and network boundaries |
| Mouse Flight | Scene/instance compilation, HDR, input/camera updates, native API fixture and cleanup |
| Engine | PBR maps, scene instances, shadow passes, explicit animation/AAA stubs, texture budgets and lifecycle |
| PBR Scene | JPEG conversion/mipmaps, alpha sorting, original texture budgets, asset integrity and lifecycle |

Reports and screenshots are written under
`build/experiments/<demo>/reports/`. The individual validators optionally accept
an external native HG JS executable and native asset compiler for reference
comparisons. These tools are only test oracles; they are not needed to build or
serve the Web packages.

The compression suite runs with `all` or `many-nodes`. After building Many Nodes,
it can also run directly with `python tools/validate_compression.py`; its report
is `build/reports/compression.json`. Python LZ4 is a validation dependency only;
compiler builds, packaging and browser execution do not require it.

The Many Nodes validator accepts `--browser PATH` and `--software` for a
SwiftShader smoke run. Other validators share its browser discovery. Hardware
image comparisons and software smoke results are distinct evidence.

Current desktop build coverage is Windows x64. Linux/macOS and the full target
architecture matrix must be checked on their respective hosts before claiming
release support. The four demo READMEs retain their dated visual/reference results;
the generated reports describe the most recent local runs.
