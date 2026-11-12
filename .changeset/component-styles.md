---
"@motionscript/core": patch
"@motionscript/sdk": patch
---

`Types.style(family, groups, { presets })`: a component's whole look as one entry. Fields are written in groups and read flat (`state.style.palette`); a set lays a partial over the previous value and drops keys the component does not declare, so one preset or saved style dresses every component of the family; `to({ style })` tweens field by field. `describe()` reports it as `kind: "style"` with its family, presets and grouped fields, so a host can edit and save looks generically. `Types.palette(fills)` is a colour-per-item entry, tweened pairwise. The SDK exports the `StyleGroups`, `StyleInput`, `StyleOptions`, `StyleShape` and `StyleValues` types.
