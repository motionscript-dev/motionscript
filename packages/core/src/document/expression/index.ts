/**
 * **Expressions**: a prop that follows a variable instead of holding a value.
 *
 * A document is data, so it cannot carry a function — which is exactly what a
 * derived prop is (`packages/core/src/props/`: a `property`'s slot either holds
 * a value or is *bound* to a thunk). An expression is that function written as
 * a string a document can store:
 *
 * ```json
 * { "id": "card", "type": "rect", "props": { "x": "=4[g]+3", "opacity": "=[g]" } }
 * ```
 *
 * A leading `=` marks the string as a formula rather than a value, and `[name]`
 * reads the `VariableSpec` with that id. What it compiles to is an ordinary
 * prop binding, so nothing underneath it changes: a command writes the
 * variable's slot, and a bound prop recomputes on every read, so each of them
 * sees the new value without anything being invalidated. That is what makes one
 * variable able to drive twenty nodes without twenty copies of the same tween.
 *
 * Three rules the syntax turns on, each of which removes a question a reader
 * would otherwise have to ask:
 *
 * - **`=` marks the whole string, not part of it.** There is no `${…}` hole in
 *   surrounding text. A prop is either a value or a formula, so nothing has to
 *   define what a half-interpolated `cornerRadius` means. A literal string that
 *   really does start with `=` is written `"=="`.
 * - **A lone `[x]` passes the value through, unconverted.** `"=[c]"` on a `fill`
 *   yields whatever `c` holds — a colour string, a `Vector2`, an object — while
 *   anything with arithmetic in it is numeric. Without that rule a variable
 *   could only ever be a number, and driving four nodes' `fill` from one place
 *   is half the reason variables exist.
 * - **Angles are degrees**, matching every angle in the library (`rotation`,
 *   `startAngle`, 3D Euler rotations). `sin(30)` is `0.5`.
 *
 * Expressions **bind**; they are not tween destinations. See
 * `document/timeline.ts` for where that is enforced and why.
 *
 * One value — {@link expressionOps} — carries every operation: recognition,
 * parsing, compiling, the authored-value walk, and the name lists a host's
 * completion needs. The free functions this used to export
 * (`isExpressionSource`, `unescapeExpression`, `parseExpression`,
 * `tryParseExpression`, `compileExpression`, `compileValue`, `compileProps`,
 * `collectExpressions`, `expressionFunctionNames`, `expressionConstantNames`)
 * are those methods now.
 */
export { expressionOps } from "./ops";
export { ExpressionError } from "./types";
export type * from "./types";
