import {
    Paint,
    Types,
    type EntryOptions,
    type RenderContext,
    type Type,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";

const { overlay: _overlay, ...paint } = Paint.state;
const { overlayTo: _overlayTo, ...paintCommands } = Paint.commands;

/** A math node's paints: fill, stroke, shadow and the outline trim, with no overlay. */
export const PAINT = paint;
export const PAINT_COMMANDS = paintCommands;

/** One of `values`, held as text with its choices listed (no `kind: "enum"`). */
export function listed<const V extends readonly string[]>(values: V, initial: V[number], options?: Pick<EntryOptions, "animatable">): Type<V[number]>;
/** With no default: an arg left out is one the command was not given. */
export function listed<const V extends readonly string[]>(values: V, initial: undefined, options?: Pick<EntryOptions, "animatable">): Type<V[number] | undefined>;
export function listed(values: readonly string[], initial: string | undefined, options: Pick<EntryOptions, "animatable"> = {}): Type<string | undefined> {
    return Types.custom<string | undefined, string | undefined, EntryOptions & { readonly options: readonly string[] }>(initial, { ...options, options: values });
}

/** `record` without `keys`: the paints a node has no use for. */
export function omit<T extends object, const K extends keyof T>(record: T, ...keys: K[]): Omit<T, K> {
    const out = { ...record };
    for (const key of keys) delete out[key];
    return out;
}

/** A node's own paint under its children, then what it lays over them. */
export function painted(ctx: RenderContext, own: () => void, over: () => void = () => { }): void {
    ctx.inFront(own);
    ctx.children();
    ctx.inFront(over);
}
