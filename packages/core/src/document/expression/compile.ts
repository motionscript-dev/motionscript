/**
 * The document's back end: an {@link ExpressionNode} tree into the binding a
 * `PropSlot` takes.
 *
 * The tree is compiled into closures once rather than walked per read — the
 * difference matters on a scene where a hundred props read the same variable
 * every frame. A dialect with a different target compiles the same AST its own
 * way; `@motionscript/math` emits `(x, y) => number` from this one, and shares
 * the front end rather than this file.
 */
import { DOCUMENT_FUNCTIONS } from "./parse";
import { ExpressionError } from "./types";
import type { ExpressionNode, ParsedExpression, VariableResolver } from "./types";

/**
 * Coerce a variable's value into the number arithmetic needs.
 *
 * A number is itself, a boolean is `1` or `0`, and a string is what `Number`
 * reads from it (`"5"` is 5, `"0x10"` is 16) unless it is empty after trimming,
 * which is `NaN`. Anything else — `null`, `undefined`, an object — is `NaN`
 * too. That is the intent: a `width` of `NaN` is visible in the first frame,
 * where a silent `0` looks like a deliberate collapse and gets debugged as a
 * layout problem, and `Number("")` is exactly that silent zero.
 */
function toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") return value.trim() === "" ? NaN : Number(value);
    return NaN;
}

/**
 * `path` is where in the props bag the formula was written, so a reference to
 * something undeclared names the prop and not just the formula.
 */
export function compile(parsed: ParsedExpression, resolve: VariableResolver, path?: string): () => unknown {
    const readOf = (name: string): (() => unknown) => {
        const read = resolve(name);
        if (!read) {
            throw new ExpressionError(
                `"${name}" resolves to nothing in this document — a reference names a variable ` +
                `(declared with a "variable" command), a constant (a \`constants\` row), or another ` +
                `node's prop as "[key.prop]" (\`key\` on that node's row)`,
                parsed.source, -1, path,
            );
        }
        return read;
    };

    // A lone `[x]` hands the value over untouched: see `passthrough`.
    if (parsed.passthrough) return readOf((parsed.root as { name: string }).name);

    const emit = (node: ExpressionNode): (() => number) => {
        switch (node.kind) {
            case "const": {
                const { value } = node;
                return () => value;
            }
            case "ref": {
                const read = readOf(node.name);
                return () => toNumber(read());
            }
            case "unary": {
                const operand = emit(node.operand);
                return () => -operand();
            }
            case "binary": {
                const left = emit(node.left);
                const right = emit(node.right);
                switch (node.op) {
                    case "+": return () => left() + right();
                    case "-": return () => left() - right();
                    case "*": return () => left() * right();
                    case "/": return () => left() / right();
                    case "%": return () => left() % right();
                    case "^": return () => left() ** right();
                }
                break;
            }
            case "call": {
                const { apply } = DOCUMENT_FUNCTIONS[node.name];
                const args = node.args.map(emit);
                return () => apply(args.map((a) => a()));
            }
        }
        throw new ExpressionError("unsupported expression node", parsed.source, -1, path);
    };

    return emit(parsed.root);
}
