# Variables and expressions

A **variable** is a named value with no place in the tree. An **expression** is a node prop that follows a variable, or another node's prop. One `variableTo` command then drives any number of nodes, and re-timing it is one field ([why](./why.md#nodes-and-variables-are-fields-not-commands-a-constant-is-an-undriven-variable)). Code: `packages/core/src/document/expression/` (`parse.ts`, `compile.ts`, `walk.ts`, `refs.ts`, `ops.ts`, `types.ts`), the checks in `document/validate.ts`, the variable commands and lerps in `document/builtins.ts`, and the slots, resolver and binding in `document/timeline.ts`.

## Model

**Variables.** `VariableSpec { id, name?, value, lerp? }`, declared in `variables` on every clip kind. `value` is any JSON value except a formula string; `name` is a label no expression reads. A variable holds `value` from t=0 until a command changes it and has no `startAt`/`endAt`. On a still nothing can change one, so it is a fixed value. A constant is a variable no command drives; a `constants` field is a validation issue, which opening a document migrates into `variables`. `lerp` is a registry key ([registry.md](registry.md)): absent means `number` for a numeric `value` and `step` for anything else. An unregistered key throws at build (`Registry.requireLerp`), not in validation.

**Variable commands.** `variableTo` captures `from` on its first evaluation and writes `lerp(from, args.value, t)`; `args.lerp` overrides the variable's lerp for that tween. `variableSet` writes `args.value` and ignores `duration`. Both reach the variable through a `VariableTarget` (`id`, `get`, `set`, `lerp`), a handle that cannot subscribe to the variable or outlive the build. `Registry.addVariableCommand` adds a host's own; it must be a pure function of `t`.

**Expressions.** A string starting with `=` (not `==`), at any depth of a prop value, is a formula. The `=` marks the whole string (there is no `${}` hole) and is stripped before parsing. `[id]` reads a variable; `[key.prop]` reads prop `prop` of the node whose `NodeSpec.key` is `key`. The dot is the only discriminator: the scanner hands the bracket text over as one opaque name, and the validator, `splitNodeRef` (`expression/refs.ts`) and `ClipTimeline._resolveVariable` each split on it.

| A formula written in | Effect |
|---|---|
| a node's `props`, the root row (`id: ""`) included | binds from t=0: literal props go to the constructor, bound ones are applied afterwards with `node.set` |
| a `set` command's `args` | binds from that command's `at`; a seek back before it restores the authored prop |
| any other command's `args` | build error (`ClipTimeline._assertNoExpressions`); validation does not report it |

A compiled formula is a thunk bound to the prop's `PropSlot` and recomputed on every read: nothing is invalidated and no edge is declared ([why](./why.md#a-bound-prop-recomputes-on-every-read-there-is-no-dependency-graph)). A node driven only by formulas is never restored by the timeline, because nothing overwrote it.

## The language

One scanner, one grammar and one AST (`ExpressionNode`), parameterized by an `ExpressionDialect`: the function table, the constant table, how a reference is spelled (`"bracket"` `[id]` or `"bare"`), and the unknown-name message. The document's dialect is `DOCUMENT_DIALECT` (`parse.ts`); `@motionscript/math` defines another (bare references, radians) over the same grammar, which is how `sin` is degrees here and radians in a plot. Each language keeps its own back end; `compile.ts` turns a document AST into a prop binding. Everything is reached through `expressionOps` (`ops.ts`): `isSource`, `unescape`, `parse`, `tryParse`, `compile`, `bind`, `bindProps`, `collect`, `renameRefs`, `functions`, `constants`, `dialect`.

```
additive       = multiplicative { ("+" | "-") multiplicative }
multiplicative = unary { ("*" | "/" | "%") unary | unary }     second arm: implicit "*"
unary          = ("-" | "+") unary | power
power          = primary [ "^" unary ]
primary        = number | "[" name "]" | "(" additive ")" | ident "(" [ additive { "," additive } ] ")" | ident
```

- `^` is right-associative with a unary exponent: `2^3^2` is 512, `2^-1` is 0.5, `-2^2` is -4.
- Implicit multiplication has the level of `*` and groups left: `4[g]` is `4*[g]`, `2pi` is `2*pi`, and `1/2pi` is `(1/2)*pi`, not `1/(2*pi)`.
- Numbers have no sign; `.5` and `5.` scan; `e` is an exponent only when digits follow; a second `.` is an error. Whitespace is space, tab, LF, CR.
- A bare identifier is a constant (`pi`, `tau`, `e`) or an error that points at `[name]`. Function and constant names are looked up as own keys only, so `toString(1)` is an unknown function.
- Arity is checked at parse time; a call's arguments are full `additive` expressions.

The function library is a **closed, versioned set**: a stored document is evaluated by whatever version opens it later, so a name, an arity or a result changing breaks stored documents. A host cannot add a function or constant (it can add a lerp). `expressionOps.functions()` and `constants()` return sorted names.

| Group | Functions (24) |
|---|---|
| Sign and rounding | `abs`, `sign`, `floor`, `ceil`, `round(x)`, `round(x, step)` (halves go towards +Infinity; `step` 0 is a plain round) |
| Powers and logs | `sqrt`, `pow(a, b)`, `exp`, `log(x)`, `log(x, base)` |
| Range | `min(a, ...)` and `max(a, ...)` (at least 1 argument), `clamp(x, lo, hi)` (`lo > hi` gives `hi`), `mod(a, b)` (floored, takes the sign of `b`, `b = 0` is `NaN`) |
| Interpolation | `mix(a, b, t)` (`t` not clamped), `smoothstep(e0, e1, x)`, `step(edge, x)` (`NaN` if any argument is; `smoothstep` with equal edges is a step) |
| Trig, degrees | `sin`, `cos`, `tan` take degrees; `asin`, `acos`, `atan`, `atan2(y, x)` return degrees; `hypot(a, b, ...)` (at least 2 arguments) |

`%` is the JavaScript remainder (`-1 % 3` is -1); `mod` is the floored one. Results are IEEE doubles, not snapped at cardinal angles (`cos(60)` is `0.5000000000000001`).

## Invariants and traps

- **A lone `[x]` passes the value through untouched** (the parsed root is a single reference, so `+[c]` and `([c])` qualify, `-[c]` does not): a variable can hold a colour, a `Vector2` or a fill object. Add arithmetic and the result is numeric: operands coerce (number as is, boolean 1 or 0, string by `Number()` so `"0x10"` is 16, empty or whitespace-only and everything else `NaN`). `NaN` is deliberate: it shows in the first frame where a silent `0` reads as a collapse. Nothing throws at evaluation.
- **Expressions bind; they are not tween destinations.** `to` reads its destination once when the command compiles, so a formula there could only mean "whatever this was at build time". A command whose args reach `set()` opts in with `binds: true` (only `set` does); anywhere else the build throws, naming `set` and `variableTo` as the alternatives.
- **`==` escapes a literal string starting with `=`.** `bind` unescapes every literal string it walks. A variable's `value` is not walked: `"==x"` reaches a bound prop as `"==x"`, where a literal prop reads `"=x"`, and a `value` that is itself a formula (`"=..."`) is a validation issue.
- **A node reference resolves at read time.** `build` binds in document order, so the node named may not exist yet, and `syncPresence` adds and removes nodes, so one that exists can be absent at *t*. The thunk looks the node up on every read, gated on `Node.mounted` (not the timeline's `_present` set, which settles only at the end of `syncPresence`), and answers `undefined` for an absent node: `NaN` through arithmetic, an unset prop on its own. Throwing would make a node entering at 2s a crash at 0s. A prop behind a mapper never receives `undefined` (`Node._writeProp`): it holds its declared default through the mapper (`padding.left` is read everywhere). The read is `node[prop]`, so any member answers (`[card.to]` is a function).
- **Node references that cycle are a validation error, because the runtime does not crash.** `PropSlot.get` refuses to re-enter and returns the last settled value, so `a.x = "=[b.y]"` with `b.y = "=[a.x]"` renders a frame that quietly disagrees with the document. `checkExpressionCycles` (`validate.ts`) works per top-level prop (a formula nested in `padding` makes `padding` the reader), over props of keyed nodes and the args of a `set` on a keyed target. `a.x -> b.y -> a.z` terminates and is accepted. A cycle through an unkeyed node is not tracked. Variables cannot cycle: nothing can read one.
- **Ids and keys.** Node ids and variable ids share one id space (`checkIdSpace`): a command has one `targetId`, and the command type's scope says which table it names. `NodeSpec.key` is a separate space: `parentId` and `targetId` are always ids, `[...]` is a key (with a dot) or a variable id (without), so a key may equal a variable's id. A key is optional, never generated by the engine, unique among keys, and contains neither `]` nor `.`; a variable id contains no `]`. A variable id with a `.`, or an id or key with `[` or surrounding whitespace, passes validation and can never be named by a formula.
- **A variable has no presence span**, so the validator's "command runs before its target is present" rule skips variable targets: an expression naming a variable that "does not exist yet" would be a broken document, not an absent node.
- **Validation and build catch different things.** Validation (`checkExpressions`): a formula that does not parse, `[var]` undeclared, `[var]` naming a node key, a malformed or unknown `[key.prop]`, cycles. Build (`ClipTimeline`): duplicate variable ids, an unregistered lerp, a variable command with an undeclared or `null` target, an unregistered `args.lerp`, a formula in a non-binding command, and a reference the resolver cannot find (`ExpressionError`, with the prop's path). `variableTo` without `args.value` validates and interpolates to `undefined` (`NaN` through `number`).
- **Parse positions are relative to the text after the `=`**, one less than the author sees. `ExpressionError` carries `source`, `position` (0-based, or -1) and `path`.
- **`expressionOps.renameRefs`** rewrites `[ref]`s inside formulas only, passing the callback each name trimmed; a value with nothing to rewrite comes back by identity, as does `bind`'s static path.

## Where to look

- `document/expression/tests/expression.test.ts`: grammar corners, coercion, the closed set of 24 and each function's arity (pinned, because stored documents depend on them), dialects.
- `document/tests/variables.test.ts`, `node-refs.test.ts`: variable commands, lerps, node references, absent nodes, cycles.
- `document/tests/validate.test.ts`: the validation checks above.
- `src/tests/barrels.test.ts`: `expressionOps` and `ExpressionError` are on the root and `/sdk` barrels; `expressionRefs` and `splitNodeRef` are on neither.
