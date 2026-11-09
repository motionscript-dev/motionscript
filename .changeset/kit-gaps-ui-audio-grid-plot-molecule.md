---
"@motionscript/audio": patch
"@motionscript/grids": patch
---

Kit gaps in waveforms, item grids and graphs.

- `@motionscript/audio`: documents that the host supplies the baked envelope and states its JSON form. `AudioEnvelope.magnitude` and `speaker` are typed `ArrayLike<number>`, which accepts the plain arrays a document stores as well as typed arrays. The package description no longer claims the meter responds to a signal.
- `@motionscript/grids`: the grids' descriptors name `children: "freeform"`, the one answer that is true of slot-placed children, in place of `flow` and `grid`.
- `@motionscript/plot`: new `curveEquationIssues`, `surfaceEquationIssues` and `equationIssues` return a `ValidationIssue` for each equation whose expression does not compile and so is not drawn, which `validateDocument` cannot see. The `Canvas3D` scene props that `Graph3D` inherits and ignores are documented in its docs and a README.
