import type { PropertyEditor } from "@/attributes/properties/decorator";
import type { TweenFn } from "@/props/host";
import type { Context } from "@/util/context";

/**
 * Where an entry takes its value when the author left it unset: from the
 * context its ancestors provide (`use`), given what was set (`given`). Read on
 * the node's first attach. `undefined` keeps the default.
 */
export type Inherit = (use: <T>(context: Context<T>) => T, given: Readonly<Record<string, unknown>>) => unknown;

/** What a state entry is at runtime: the `property` options it lowers onto, plus whether it is private. */
export interface TypeDef {
    /** Loose author form; mapped on construction. A function here is a factory, called once per node. */
    readonly default: unknown;
    readonly mapper?: (ext: any, prev?: any) => unknown;
    readonly tween?: TweenFn<any>;
    readonly editor: PropertyEditor;
    readonly private: boolean;
    readonly inherit?: Inherit;
}

export const TYPE_DEF = "_def";

export function isTypeLike(value: unknown): value is { readonly _def: TypeDef } {
    return (typeof value === "object" || typeof value === "function") && value !== null && TYPE_DEF in value;
}

/** A literal state entry (`value: 0`, `label: 'Hi'`, `on: true`) as the Type it stands for. */
export function defOf(entry: unknown): TypeDef {
    if (isTypeLike(entry)) return entry._def;
    switch (typeof entry) {
        case "number": return { default: entry, editor: { kind: "number" }, private: false };
        case "string": return { default: entry, editor: { kind: "text" }, private: false };
        case "boolean": return { default: entry, editor: { kind: "boolean" }, private: false };
        default: throw new TypeError(`A state entry is a Types.* value, a number, a string or a boolean; got ${String(entry)}.`);
    }
}
