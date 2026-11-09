---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

Each built-in effect is one declarative spec, and a host can read it.

- An effect's parameters (kind, default, range, step, unit and inspector hints such as the label key, control and order) are declared once in core. The effect's type, its builder's defaults and options, and its `lerp`/`equals` are derived from that declaration rather than written beside it. Saved documents are unchanged: the same `type` keys, field names, defaults and stored key order, and every builder, `lerp` and `equals` gives what it gave before.
- `describeEffect(type)` and `effectDescriptors()` (core and `@motionscript/sdk`) return each effect's fields as plain JSON: `{ type, group, surface, scalar, defaultMode, onlyOn, neutral, params: [{ name, kind, default, required, optional, min, max, step, unit, options, animatable, label, control, inline, order, zero, optionsLabel, hidden, initial }] }`. A host builds its effect inspector from it instead of keeping its own copy of the defaults.
- The `XOptions` builder option types are now type aliases derived from the specs, with the same fields.
