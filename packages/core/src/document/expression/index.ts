/**
 * **Expressions**: a prop that follows a variable instead of holding a value, written as a string a document
 * can store: `{ "props": { "x": "=4[g]+3", "opacity": "=[g]" } }`. A leading `=` marks the whole string as a
 * formula and `[name]` reads the `VariableSpec` with that id. It compiles to an ordinary prop binding: a
 * command writes the variable's slot and a bound prop recomputes on every read, so nothing is invalidated and
 * one variable drives many nodes.
 *
 * Rules the syntax turns on: `=` marks the whole string, never part of it (no `${...}` holes; a literal string
 * starting with `=` is written `"=="`). A lone `[x]` passes the value through unconverted, so a variable can
 * hold a colour or `Vector2` and one variable can drive many nodes' `fill`; anything with arithmetic is
 * numeric. Angles are degrees, as everywhere in the library (`sin(30)` is `0.5`).
 *
 * Expressions bind; they are not tween destinations (enforced in `document/timeline.ts`). {@link
 * expressionOps} carries every operation.
 */
export { expressionOps } from "./ops";
export { ExpressionError } from "./types";
export type * from "./types";
