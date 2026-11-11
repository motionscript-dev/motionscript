import { TweenFn } from "@/props/host";

export interface PropOptions<Ext, Int> {
    /** Lerp the *internal* (post-mapper) value during `to()`. Each step is stored as it returns, not mapped again, so a prop that must hold a range under an overshooting ease clamps here too. */
    tween?: TweenFn<Int>;
    /** Converts the external input into the internal stored value. Receives the previous internal value as the second arg when available. */
    mapper?: (ext: Ext, prev?: Int) => Int;
}


export interface PropertyMeta {
    key: string;
    default?: unknown;
    options?: PropOptions<any, any>;
    /** How a host edits this prop — see {@link PropertyEditor}. */
    editor?: PropertyEditor;
}

/** What a host needs to draw a control for a property. Declared **on the property**, not in a separate `fields` list beside the class, which drifts when one is renamed. Nothing here is read while rendering. */
export interface PropertyEditor {
    /** The control to draw; inferred when absent (a typed entry knows its own, a plain `property` reads the default's type). */
    kind?: string;
    /** Bounds and granularity for a numeric control. */
    min?: number;
    max?: number;
    step?: number;
    /** What the number means, for a host that labels it — `"°"`, `"s"`, `"×"`. */
    unit?: string;
    options?: readonly string[];
    /** Whether a document may tween it. Defaults to true. */
    animatable?: boolean;
    /** The controls *inside* an object-valued prop (an axis config, a theme), drawn as a group and kept attached to their parent prop. */
    properties?: Record<string, PropertyEditor>;
    /** Whatever a control needs that this vocabulary does not name. */
    [option: string]: unknown;
}

export const PROPERTY_META = Symbol("propertyMeta");

/** Every `property` on an instance's class, inherited included, ordered base -> subclass so `initProps` applies them in declaration order. A subclass redeclaring a key replaces the inherited declaration whole, at the position the base gave it. */
export function getPropertyMeta(instance: object): PropertyMeta[] {
    return mostDerived<PropertyMeta>(instance, PROPERTY_META);
}

/** The per-key declarations stored under `symbol` along the prototype chain: base first, one entry per key, the most-derived of each. */
export function mostDerived<M extends { key: string }>(instance: object, symbol: symbol): M[] {
    const chain: object[] = [];
    let proto = Object.getPrototypeOf(instance);
    while (proto && proto !== Object.prototype) {
        chain.unshift(proto);
        proto = Object.getPrototypeOf(proto);
    }
    const result: M[] = [];
    const at = new Map<string, number>();
    for (const p of chain) {
        if (!Object.prototype.hasOwnProperty.call(p, symbol)) continue;
        for (const m of (p as Record<symbol, M[]>)[symbol]) {
            const i = at.get(m.key);
            if (i === undefined) {
                at.set(m.key, result.length);
                result.push(m);
            } else {
                result[i] = m;
            }
        }
    }
    return result;
}

/** A registration for one member of a node class, applied to the prototype under the member's key by {@link declareMembers}. */
export type MemberRegistration = (target: object, key: string) => void;

/**
 * Registers properties and commands on a node class, in the order given. Core's own base classes declare their props
 * as `declare` fields and register them here, right after the class body. Order is meaningful: {@link getPropertyMeta}
 * lists properties in registration order, which is the order `Registry.describe` hands a host's inspector. Node types
 * outside core are components (`component2d`), which do this themselves.
 *
 * @example
 * ```ts
 * declareMembers(Dial, {
 *     level: property({ default: 0 }),
 *     turn: command({ args: ["by"] }),
 * });
 * ```
 */
export function declareMembers<C extends abstract new (...args: never[]) => object>(
    ctor: C,
    members: { [K in keyof InstanceType<C> & string]?: MemberRegistration },
): void {
    for (const [key, register] of Object.entries(members) as [string, MemberRegistration][]) {
        register(ctor.prototype as object, key);
    }
}

/**
 * Declares a property on a `Node` subclass, applied to the prototype under the property's key (directly or through
 * {@link declareMembers}). `default` is used when the key is absent from the constructor `props`; `mapper` / `tween`
 * are forwarded to `applyProp()`. Redeclaring an inherited key overrides it; see {@link getPropertyMeta}.
 */
export function property<Ext = any, Int = Ext>(opts?: {
    default?: Ext;
    mapper?: (ext: Ext, prev?: Int) => Int;
    tween?: TweenFn<Int>;
} & PropertyEditor) {
    return function (target: object, propertyKey: string | symbol): void {
        const key = propertyKey as string;
        // `default`, `mapper` and `tween` drive the prop slot; everything else is
        // the editor's, and is carried rather than interpreted.
        const { default: fallback, mapper, tween, ...editor } = opts ?? {};
        const meta: PropertyMeta = {
            key,
            default: fallback,
            options: (mapper != null || tween != null)
                ? { mapper: mapper as ((ext: any) => any) | undefined, tween: tween as TweenFn<any> | undefined }
                : undefined,
            ...(Object.keys(editor).length > 0 ? { editor: editor as PropertyEditor } : {}),
        };

        // Store metadata on the class prototype (own property so getPropertyMeta
        // can distinguish each class's own entries from inherited ones).
        if (!Object.prototype.hasOwnProperty.call(target, PROPERTY_META)) {
            (target as any)[PROPERTY_META] = [];
        }
        const list: PropertyMeta[] = (target as any)[PROPERTY_META];
        if (!list.some(m => m.key === key)) {
            list.push(meta);
        }
    };
}
