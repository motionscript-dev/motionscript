import { DataToken, SeedToken, ThemeToken } from "@/runtime/builtin-context";
import type { Context } from "@/util/context";
import { provides, type NodeOf, type Provided } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import type { Node2DProps } from "@/components/trees/2d/node2d";

/** Hands its subtree `value` under `context`, or the context's default when it has no value. */
export const Provider = component2d({
    key: "provider",
    state: { context: Types.custom<Context<unknown> | undefined>(undefined), value: Types.custom<unknown>(undefined) },
    provide: (state) => (state.context ? [provides(state.context, state.value !== undefined ? state.value : state.context.defaultValue)] : []),
});

/** Lays its theme and data over what it inherits, and seeds the randomness below it. */
export const ThemeProvider = component2d({
    key: "theme-provider",
    state: {
        theme: Types.custom<Record<string, unknown> | undefined>(undefined),
        data: Types.custom<Record<string, unknown> | undefined>(undefined),
        seed: Types.custom<string | number | undefined>(undefined),
    },
    provide: (state, inherited) => {
        const out: Provided[] = [];
        if (state.theme) out.push(provides(ThemeToken, { ...inherited(ThemeToken), ...state.theme }));
        if (state.data) out.push(provides(DataToken, { ...inherited(DataToken), ...state.data }));
        if (state.seed !== undefined) out.push(provides(SeedToken, state.seed));
        return out;
    },
});

export type Provider = NodeOf<typeof Provider>;
export type ThemeProvider = NodeOf<typeof ThemeProvider>;

// What code building a provider names its props as.

export interface ProviderProps<T> extends Node2DProps {
    /** The context token this provider supplies to its descendants. */
    context: Context<T>;
    /** The value to provide. Omitted → the token's default value. */
    value: T;
}

export interface ThemeProviderProps extends Node2DProps {
    /** Named values (e.g. colors) merged onto any ancestor theme, read via
     * `node.useContext(ThemeToken)`. */
    theme: Record<string, unknown>;
    /** Arbitrary data merged onto any ancestor data bag, read via
     * `node.useContext(DataToken)`. */
    data: Record<string, unknown>;
    /** A default seed passed down the tree, read via `node.useContext(SeedToken)`. */
    seed: string | number;
}
