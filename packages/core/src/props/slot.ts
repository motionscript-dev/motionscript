import type { SlotObserver } from "./observer";

/** A captured state of a {@link PropSlot} (the thunk it was bound to, or the plain value), from {@link PropSlot.snapshot} to {@link PropSlot.restoreFrom}. */
/** @internal */
export interface PropSnapshot<T> {
    value: T;
    /** Present only for a bound slot; restoring one re-binds rather than freezing it. */
    fn?: () => T;
}

/**
 * @internal The observer every slot reports to, or `null` — which is every frame of
 * playback, so the hot path pays one null check. Installed by `observeSlots`.
 */
export let _observer: SlotObserver | null = null;

/** @internal Only this module can reassign the binding. Returns the observer it replaced. */
export function _setObserver(observer: SlotObserver | null): SlotObserver | null {
    const previous = _observer;
    _observer = observer;
    return previous;
}

/**
 * The storage behind one `property`: a plain value, or a thunk evaluated on every read. There is no dependency graph and
 * nothing to invalidate: a bound slot recomputes when asked, so a document expression (`"=4[g]+3"`), an author's
 * `width={() => …}` and an alignment binding reading a box written mid-layout are all correct without declaring an
 * edge. (A cache-and-invalidate version could only get the last one right by observing the write, and paid for it at
 * every write path.) The bet is that recomputing is cheaper than tracking: bindings are arithmetic over a few reads.
 */
export class PropSlot<T> {
    private _value: T;
    private _fn: (() => T) | null = null;
    private _running = false;

    /** `_host` and `_name` only label the slot for an observer — see `slotLabel`. */
    constructor(
        initial: T,
        readonly _host: { readonly id: string } | null = null,
        readonly _name: string = "",
    ) {
        this._value = initial;
    }

    get(): T {
        // Before the re-entrancy check, so a binding's own reads are recorded
        // under whatever read it.
        if (_observer !== null) _observer.read(this);
        // A binding that reads its own slot re-enters here mid-evaluation —
        // `bind(() => mapper(ext(), slot.get()))` is how a mapper is handed the
        // previous value. It gets the last settled one instead of recursing.
        if (!this._fn || this._running) return this._value;
        this._running = true;
        try {
            return (this._value = this._fn());
        } finally {
            this._running = false;
        }
    }

    set(value: T): void {
        if (_observer !== null) _observer.write(this);
        this._fn = null;
        this._value = value;
    }

    bind(fn: () => T): void {
        if (_observer !== null) _observer.write(this);
        this._fn = fn;
    }

    /** Freeze a bound slot at what it currently computes. */
    unbind(): void {
        if (!this._fn) return;
        if (_observer !== null) _observer.write(this);
        this._value = this.get();
        this._fn = null;
    }

    isBound(): boolean {
        return this._fn !== null;
    }

    snapshot(): PropSnapshot<T> {
        return this._fn ? { value: this.get(), fn: this._fn } : { value: this._value };
    }

    restoreFrom(snap: PropSnapshot<T>): void {
        if (snap.fn) this.bind(snap.fn);
        else this.set(snap.value);
    }

    /** Releases the bound closure and the value slot. The slot is inert after this. */
    dispose(): void {
        this._fn = null;
        this._value = undefined as unknown as T;
    }
}
