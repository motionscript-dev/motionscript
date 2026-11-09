# Commands, tweens and easing

A command is a value: a declared `duration` plus a pure `at(t)` that writes the frame at normalized time `t` onto its target. A document places one with a `CommandSpec`; a node type publishes one in its component's `commands`, which the factory lowers onto `command` methods. Code: `packages/core/src/tween/` (`command.ts`, `command-decorator.ts`, `to-command.ts`, `loop.ts`, `ease/`), the built-in keys in `document/builtins.ts`, the traits in `document/command-traits.ts`, and `Node._prepareStep` in `components/trees/node/node.ts`. Placement and sequencing are the timeline's ([timeline.md](timeline.md)): there is no `sequence`, `parallel` or `wait` command; a command carries its own `at`, so "after" is `at + duration`, "together" is a shared `at`, and a wait is a gap.

## Model

`CommandSpec { id, type, targetId, at, duration?, easing?, loop?, args }`. `targetId` is a node id, a variable id (for a variable-scoped command), or `null` for the root. `duration` is one pass in seconds. `easing` applies per pass. `loop` is a placement field wrapped around the built command, never an argument of any command. Which keys exist, and how a `type` resolves, is in [registry.md](registry.md).

| Time space | Range | Used by |
|---|---|---|
| Document seconds | 0 to the clip's length | `at`, `duration`, `loop` |
| Normalized | [0, 1] over one command's whole span | `Command.at(t)`, `EasingFunction`, `LerpFunction` |
| Elapsed | seconds from the command's start | `TweenStepper.seek(elapsed)`, `advance(dt)` |
| Pass-local normalized | [0, 1] over one loop pass | the inner command of `loopCommand`, `loopPhase` |

**`Command<P>`** (`tween/command.ts`): `duration` (for a looped command, the span of every pass) and `at(t)`, which clamps `t`, writes the frame onto the target as a side effect, and returns the props it wrote. `_stepper()` returns a fresh `TweenStepper` (`seek(elapsed)` jumps and moves the stepper's clock; `advance(dt)` returns true once the end frame is written). Constructors: `makeCommand` (a pure `t => props` function written with `target.set`), `driveCommand` (a pure `apply(t)` side effect, for state `set()` cannot reach), `commandSequence` and `commandParallel` (one command from several on one target), `toCommand` (what `node.to` returns), `loopCommand`. A `Command` on an unmounted node is inert (`inertCommand`): it lasts its duration and writes nothing.

**`args` shape.** A command's `args` is the props diff itself when it has exactly one argument: `to` and `set` take `{ x: 300 }`, not `{ props: { x: 300 } }`; `fillTo` reads `args.fill`. A named command with several arguments spells each by name (`moveTo`: `x`, `y`, `path`, `target`, `targetAnchor`). Document `args` keys the command does not list are dropped (`moveTo` lists no `pivot`, so a document cannot pass one). A command method takes one `CommandArgs { data, duration, easing, lerp? }`; `command({ args })` lists which document `args` keys become `data`'s fields, as strings or `CommandArgDescriptor` (`key`, `default`, and the `PropertyEditor` fields `kind`, `min`, `step`, `unit`, ...); `kind: "nodeRef"` marks an argument naming another node.

**Named commands.** Each tweenable attribute of a built-in has a command of its own, and a document states the change by name: `moveTo` (`x`, `y`, `path`, `target`), `fadeTo` (`opacity`), `rotateTo`, `scaleTo`, `layoutTo` (`width`, `height`, `padding`, whichever are given), `effectTo` (`effects`), `progressTo` on a shape (`start`, `end`, whichever are given), `fillTo`, `strokeTo`, `shadowTo`, `overlayTo`, and a type's own (`append`, `zoomTo`, a kit component's). Three more draw the eye to a node and leave it as it was: `pulse` (`factor`: swell and settle), `wiggle` (`angle`, `turns`: rock about its own turn) and, on a shape, `flash` (`portion`: a stretch of the outline travels along it; a shape resting at `end: 0` shows only the stretch). Their arguments are not props, so nothing after them needs restating. A 3D node has `moveTo` (`x`, `y`, `z`), `rotateTo` and `scaleTo` of its own, and a 3D scene is framed with `orbitTo` on its canvas or its camera ([3d.md](3d.md)). `to` is the general form underneath them, for a prop no command names. A custom node publishes its own the same way (the public guide is [motionscript.dev/docs/custom-node/commands](https://motionscript.dev/docs/custom-node/commands)).

**`Node._prepareStep`** routes each key of a `to` once, when the step is prepared; `from` is read from the live node then:

| Key | Route | Written |
|---|---|---|
| no prop slot | dropped | never |
| prop has a `tween` | `slot.set(tween(from, mapped, easedT))` | every step |
| number | `from + (end - from) * easedT` on the slot cell (`prepareNumericCellTween`) | every step |
| string, no `tween` | `slot.set(mapped)` | once, when `t >= 1` |
| anything else (boolean, object) | left alone, no error | never |

The destination is mapped once, before the route is chosen, and steps write stored values directly; a prop that must stay in range under an overshooting ease clamps in its `tween`. `Node2D` first expands `size` and `transform3D` into real keys, strips `pivot`, and resolves an alignment key (`center`, `topLeft`, ...) into `x`, `y` and `transformOrigin`.

### Component commands

A component's `commands` record (`components/factory/factory.ts`, `components/factory/timeline.ts`) holds three shapes, each published as a `command` method on the generated class:

| Shape | Args (`command({ args })`) | The method |
|---|---|---|
| `{ args: ["a", "b"] }` | the named entries, each with its entry's editor hints | `this.to` over the entries the document gave (`settling`); one argument also arrives bare, so the node-less `fillTo` reaches a component's `fillTo` |
| `(timeline, state, children) => piece` | none | builds the piece and returns its command |
| `{ args: { k: Types... }, run }` | the record, each with its default | resolves every arg (an omitted one takes its default, through the arg type's mapper), then builds `run`'s piece |

Either object form may carry `easing`, used when the row gives none, and `entrance: true` for a command that brings the node in: a timeline holds its first frame ahead of its `at` ([timeline.md](timeline.md)), and the registry reports it on the type's `NodeCommandEntry.entrance` so a host can offer it when the node is added. `state` is a snapshot of the node's values taken when the command is built; `children` are views of the node's own children (`to`, `run`, and their own `children`). The `timeline` handed to the function carries `args`, `duration`, `easing`, `node` (a read-only view: `id`, `size`), `ease(t)` and the builders: `tween`, `animate(frame, { eased })`, `sound`, `wait`, `together`, `sequence`, `stagger({ overlap })`.

`commandOf` turns the piece into the `Command` the timeline places. A lone `tween` is the node's own `to`. Anything else is built leaf by leaf (`timedOf`): each leaf command is built against the tree as the leaves before it left it and run to `at(1)` at once, so a later piece reads an earlier one's end, the rule the timeline keeps between whole commands. That holds inside `together` too, so two of its parts writing one entry do not start from the same value. `sequence` gives its untimed parts equal shares of what its `wait`s leave; `stagger` spaces n parts so they span the command exactly. A part that has not started writes nothing. The whole is one `driveCommand`, marked `settling` when every leaf only tweens slots (held commands, [timeline.md](timeline.md)). A `sound` piece writes nothing: it is scheduled off the built command (`commandSoundsOf`), cut when the command ends or played to its own end when the command has no length.

### Easing

`EaseSpec { kind, args? }` with `kind` one of `linear`, `in`, `out`, `inOut`, `custom`. `ClipTimeline` resolves it once per command build (`resolveEase`, module-private):

| `kind` | `args` | Resolves to |
|---|---|---|
| absent spec | | `undefined`: the command's own default, linear for every built-in |
| `linear` | ignored | `linear()` |
| `in`, `out`, `inOut` | a family name or `EaseConfig`, or absent (`quad`) | `easeIn`, `easeOut`, `easeInOut` |
| `custom` | `CurvePoint[]` passing `isEaseCurve` | `curveEase(points)` |
| `custom` | a string | `registry.ease(key)`; throws when unregistered |
| `custom` | anything else, or absent | throws |

Families (`StandardEase`): `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `back` (`overshoot`, default 1.70158), `elastic` (`amplitude` 1, `period` 0.3), `bounce`. Each is one ease-in function; out is `1 - in(1 - t)` and in-out is `in(2t) / 2` below 0.5, `1 - in(2(1 - t)) / 2` above. Only in-out retunes knobs: `back` overshoot times 1.525, `elastic` period defaults to 0.45. The standard eases clamp input to [0, 1] and are exactly 0 and 1 at the ends; `back` and `elastic` leave [0, 1] between. A function from `addEase` is trusted as given.

A custom curve is a chain of cubic Bezier segments (`curveSegments`): a missing handle is the Catmull-Rom tangent (`(next - previous) / 6`), a handle's x is clamped into its own segment's x span (y is not: overshoot is a real move), and evaluation inverts x by 30 steps of bisection (Newton fails on the flat ends of an ease-in-out).

### Loops

`LoopSpec { direction?: "normal" | "reverse" | "alternate", count: number | null }`; `count` is repeats after the first pass (0 is none, 3 is four passes, `null` repeats for as long as there is clip). `loopPasses`, `loopRepeats`, `loopSpan` and `loopPhase` (`tween/loop.ts`) are the arithmetic. The inner command never learns it is repeated and its easing applies per pass. A counted loop holds the end of its last pass; an unlimited one is never capped and may stop mid-pass where the clip ends. The timeline wraps a command only when `loopRepeats` holds, with fill `max(0, clip duration - at)`; a fill shorter than one pass still plays one.

### Command traits

`commandTraits(registry, spec, target)` (`document/command-traits.ts`, internal) says what a command does to the tree without building it: `{ scope, known, lifecycle, readsLayout, writesLayout }`, or `null` when the command resolves to nothing. `known` means it runs through the library's own implementation: none of the methods it passes through (`to`, `_prepareStep`, `_writeProp`, `command`, `set`, ... per command) is overridden by the class. A command that is not known, or is a lifecycle command (`removeChildAt`, `addChildAt`, `reparent`), is assumed to read and write layout. A known one reads layout when its args hold an alignment key (`ALIGNMENT_KEYS`), a `moveTo` names another node, or it takes a `from` over a prop bound to another node or over `x`/`y` of an alignment-authored row; it writes layout unless every written prop is neutral (`x`, `y`, `rotation`, `scale`, `opacity`, `fill`, `stroke`, `shadow`, `overlay`, `effects`, `blend`, `transformOrigin`, `zoom`, `lookAt`, `heading`, for the library's own classes; anything at all for an audio node; never for a custom type). The timeline's settle windows and the patch planner both read these.

## Invariants and traps

- **A frame is a function of `t`.** A custom `apply` or `at` must assign from `t`; accumulating (`x += ...`) looks right forwards and drifts the moment anything scrubs.
- **`from` is fixed when the command is built.** A factory reads the target's live props then (a `to`, on its first `at`), so commands must be built in timeline order with each run to `at(1)` first. Building against the wrong state gives every step the same `from`.
- **Easing is applied inside the command.** Callers pass raw normalized time; with no easing a command is linear.
- **`at` clamps to [0, 1]**, except `commandSequence.at(t)` for `t < 0`, which writes nothing (`commandParallel` writes every child's start). A prepared `to` stepper does not clamp below 0: `seek(-0.5)` writes the extrapolated value. `lerpNumber` extrapolates.
- **A stepper and a seek agree**: `seek(e)` and `advance` calls reaching `e` write the same frame. Prime a stepper with `seek(0)` before the first `advance`.
- **A stamp is a duration-0 command.** `at(1)` is its end; a stepper lands on the end at `seek(0)`. `loopCommand` returns a stamp untouched.
- **An argument a document leaves out reaches a type command as `undefined`** (`Registry.nodeCommand` copies every declared key). A command over a prop with a `tween` drops it before calling `to` (`layoutTo`, `progressTo`), or the tween is handed `undefined` as its destination; for a class, a descriptor's `default` is editor metadata and is never applied. A component's list command drops it the same way, and its record command applies the arg's default.
- **`to` ignores what it cannot tween.** A boolean or object prop without a `tween` never changes and raises no error.
- **`_prepareStep` expands sugar into its `props` argument in place**, so a caller owning the object (a document row) passes a copy; the built-in `to` does.
- **A node-less key hides a type's own command of that name** (see [registry.md](registry.md)); `command({ key })` renames the published key and dispatches to the registered method. A component command named like a member the node already has (`remove`, `clear`) is published through `_command_<key>`, so it neither shadows the member nor is shadowed by it.
- **Nothing validates ease knobs or curves.** `easeIn("nope")` builds and throws a `TypeError` on first call, which happens during the build; `elastic` with `amplitude < 1` or `period: 0` gives `NaN`. `isEaseCurve` needs only two or more points with finite `x` and `y`: an unanchored or unsorted curve jumps at its ends or runs erratically. Validation accepts `{ kind: "in", args: "nope" }`.
- **An unknown `easing.kind` runs as no easing** in the timeline (validation rejects it).

## Where to look

- `components/factory/tests/`: `component2d.test.ts`, `held-commands.test.ts` (component commands and the held timeline).
- `tween/tests/`: `command.test.ts`, `to-command.test.ts`, `prepare.test.ts` (routes), `eases.test.ts`, `curve.test.ts`, `loop.test.ts`.
- `document/tests/loop.test.ts` (looped commands in a timeline), `command-traits.test.ts`, `builtins.test.ts`.
- `src/tests/barrels.test.ts`: what is on the root, `/sdk` and `/component` barrels; `inertCommand` and `inertStepper` are on none.
