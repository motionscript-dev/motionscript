import { PropSlot, PropSnapshot } from "@/props/slot";
import { ensureCells, PropHost, TweenFn } from "@/props/host";
import { EasingFunction } from "@/tween/ease/type";
import { driveCommand, type Command } from "@/tween/command";
import { TweenStepper } from "@/tween/stepper";
import { PropOptions } from "@/attributes/properties/decorator";

/** Companion implementation of {@link Node2D}'s property machinery and save/restore stack: free functions over a narrow {@link ReactiveHost}, so `node.ts` keeps thin delegators (and the hot-path `set`/`_writeProp` inline). */

/** The slice of a {@link Node2D} these helpers touch: the {@link PropHost} maps plus the write/tween seams. `_writeProp` and `_prepareStep` stay methods on `Node2D` and are called through, preserving subclass behaviour and the inline hot path. */
/** @internal */
export interface ReactiveHost extends PropHost {
    readonly id: string;
    _writeProp(field: string, value: unknown): void;
    _prepareStep(to: Record<string, unknown>, duration: number, easing?: EasingFunction): TweenStepper;
    _stateStack: Map<string, PropSnapshot<any>>[];
}

/** Creates the {@link PropSlot} for a freshly declared prop, places it in its class's `PropLayout` (whose prototype accessor routes writes through `host._writeProp`) and registers its tween/mapper metadata. */
/** @internal */
export function registerProp<Int>(host: ReactiveHost, field: string, options?: PropOptions<any, Int>): void {
    const slot = new PropSlot<Int>(undefined as unknown as Int, host, field);
    const cells = ensureCells(host);
    cells.slots.set(field, slot);
    cells.list[cells.layout.place(field)] = slot;
    if (options?.tween) {
        (cells.tweens ??= new Map()).set(field, options.tween as TweenFn<any>);
    }
    if (options?.mapper) {
        (cells.mappers ??= new Map()).set(field, options.mapper as (ext: any, prev?: any) => any);
    }
    // Something of the instance's own, or its class's, already answers to the name: shadow it.
    if (!cells.layout.serves(host, field)) {
        Object.defineProperty(host, field, {
            get: () => slot.get(),
            set: (value: any) => host._writeProp(field, value),
            enumerable: true,
            configurable: true,
        });
    }
}

/** Applies (or re-applies) a prop's initial value plus optional tween/mapper. A repeat call for a field reuses the cell and only refines tween/mapper, so a subclass can override a parent default without losing the cell or its bindings. */
/** @internal */
export function applyProp<Ext, Int = Ext>(
    host: ReactiveHost,
    field: string,
    initial: Ext | (() => Ext) | undefined,
    options?: PropOptions<Ext, Int>,
): void {
    const existing = host.__cells?.slots.get(field);
    if (!existing) {
        registerProp<Int>(host, field, options);
    } else if (options) {
        if (options.tween) {
            (ensureCells(host).tweens ??= new Map()).set(field, options.tween as TweenFn<any>);
        }
        if (options.mapper) {
            (ensureCells(host).mappers ??= new Map()).set(field, options.mapper as (ext: any, prev?: any) => any);
        }
    }
    host._writeProp(field, initial);
}

/** Snapshot every registered prop's current value/binding into a plain object. */
/** @internal */
export function collectProperties(host: ReactiveHost): Record<string, any> {
    const result: Record<string, any> = {};
    if (host.__cells) {
        for (const key of host.__cells.slots.keys()) {
            result[key] = (host as any)[key];
        }
    }
    return result;
}

/** Every declared prop of a node as the value **or binding** its slot holds (see {@link Node2D.captureProps}), keyed by name. Opaque on purpose: a slot holds the *mapped* internal form, and reading it out to write back through `set` is the round-trip a layer avoids. */
export type PropLayer = Map<string, PropSnapshot<any>>;

/** Snapshot every prop slot (value or binding) into a fresh layer. */
/** @internal */
export function captureLayer(host: ReactiveHost): PropLayer {
    const layer: PropLayer = new Map();
    const slots = host.__cells?.slots;
    if (!slots) return layer;
    for (const [key, slot] of slots) {
        layer.set(key, slot.snapshot());
    }
    return layer;
}

/** @internal */
export function saveState(host: ReactiveHost): void {
    if (!host.__cells) return;
    host._stateStack.push(captureLayer(host));
}

/** Pop the top snapshot layer, or `undefined` if the stack is empty. */
/** @internal */
export function popState(host: ReactiveHost): PropLayer | undefined {
    return host._stateStack.pop();
}

/** Instantly reapply a snapshot layer to every captured slot. */
/** @internal */
export function applySnapshotLayer(host: ReactiveHost, layer: PropLayer): void {
    const slots = host.__cells?.slots;
    if (!slots) return;
    for (const [key, snap] of layer) {
        slots.get(key)?.restoreFrom(snap);
    }
}

/** Animated restore: tweens numeric / custom-tweenable props toward their saved resolved values, then reapplies the full snapshot so bindings are restored (not frozen at the landing value) and non-tweened props snap. A {@link Command}: the `_prepareStep` stepper is a pure function of elapsed time, and the snapshot reapply fires at `t === 1` (the shape `packages/components/code`'s `runTransition` uses). `_prepareStep` runs **lazily on first evaluation**, since it snapshots each `from` off the live node; building eagerly would capture the node as of the `restore()` call, which can differ if the caller does more to it in between. */
/** @internal */
export function restoreAnimated(
    host: ReactiveHost,
    layer: PropLayer | undefined,
    duration: number,
    easing?: EasingFunction,
): Command<Record<string, never>> {
    let stepper: TweenStepper | null = null;

    return driveCommand(duration, (t) => {
        if (!stepper) {
            // `to()` reads each snapshot's resolved `value` (correct even for a
            // bound slot), so the node animates back to where it *was*.
            const target: Record<string, unknown> = {};
            if (layer) {
                for (const [key, snap] of layer) {
                    target[key] = snap.value;
                }
            }
            stepper = host._prepareStep(target, duration);
        }
        stepper.seek(t * duration);
        if (layer && t >= 1) applySnapshotLayer(host, layer);
    }, easing);
}
