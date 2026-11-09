---
"@motionscript/core": patch
"@motionscript/geography": patch
---

`to()` maps a prop's destination once, so a mapper that is not idempotent no longer moves the prop twice as far.

- A numeric prop behind a mapper was interpolated between stored values and then written through the setter, which ran the mapper on every step again: with `mapper: (v) => v * 2`, `to({ dbl: 10 })` ended at 40 and was at 20 halfway, and a second tween started from the wrong place. A string that snaps at the end was mapped twice the same way. The destination is now mapped once and every step is stored as it is, which is what a prop with a `tween` already did. A clamp behaves as before for any ease that stays between the two ends.
- An ease that overshoots (`back`, `elastic`) is no longer held by a mapper alone. A prop that must stay in range says so in its `tween`, as `Globe`'s `elevation` and `zoom` now do, so they still stop at 89° and 1.02 under an overshooting ease.
