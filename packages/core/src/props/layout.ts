import type { PropSlot } from "./slot";

/** What a prop accessor reads its slots from and writes through. */
interface LaidOutHost {
    __cells?: { layout: PropLayout; list: readonly (PropSlot<unknown> | undefined)[] };
    _writeProp?(field: string, value: unknown): void;
}

const LAYOUTS = new WeakMap<object, PropLayout>();

/** Where each prop of one node class sits in its instances' slot lists, and the accessors that read it, defined once on the class's prototype so every node of a type shares one hidden class and a prop read in layout or render stays monomorphic. Accessors reach their slot by index (closures made at one site share feedback, so a lookup by name would see every prop of every class). An instance that hasn't registered a field, or a prototype that already defines one, reads and writes as if the accessor were absent. */
export class PropLayout {
    static of(proto: object): PropLayout {
        let layout = LAYOUTS.get(proto);
        if (!layout) LAYOUTS.set(proto, (layout = new PropLayout(proto)));
        return layout;
    }

    /** `field`'s index, or -1 when no instance has registered it. */
    indexOf(field: string): number {
        return this._index.get(field) ?? -1;
    }

    /** `field`'s index, given its accessor the first time any instance registers it. */
    place(field: string): number {
        let i = this._index.get(field);
        if (i !== undefined) return i;
        this._index.set(field, (i = this._index.size));
        if (Object.prototype.hasOwnProperty.call(this._proto, field)) {
            this._foreign.add(field);
        } else {
            Object.defineProperty(this._proto, field, {
                get: this._getter(i, field),
                set: this._setter(i, field),
                enumerable: true,
                configurable: true,
            });
        }
        return i;
    }

    /** Whether reading `field` on `host` reaches this layout's accessor. */
    serves(host: object, field: string): boolean {
        return !this._foreign.has(field) && !Object.prototype.hasOwnProperty.call(host, field);
    }

    private constructor(private readonly _proto: object) {
        this._parent = Object.getPrototypeOf(_proto) as object | null;
    }

    private readonly _parent: object | null;
    private readonly _index = new Map<string, number>();
    private readonly _foreign = new Set<string>();

    private _getter(i: number, field: string): (this: LaidOutHost) => unknown {
        const layout = this;
        const parent = this._parent;
        return function () {
            const cells = this.__cells;
            const slot = cells !== undefined && cells.layout === layout ? cells.list[i] : undefined;
            if (slot !== undefined) return slot.get();
            return parent === null ? undefined : Reflect.get(parent, field, this);
        };
    }

    private _setter(i: number, field: string): (this: LaidOutHost, value: unknown) => void {
        const layout = this;
        const parent = this._parent;
        return function (value) {
            const cells = this.__cells;
            if (cells !== undefined && cells.layout === layout && cells.list[i] !== undefined) {
                this._writeProp!(field, value);
            } else if (parent !== null) {
                Reflect.set(parent, field, value, this);
            } else {
                Object.defineProperty(this, field, { value, writable: true, enumerable: true, configurable: true });
            }
        };
    }
}
