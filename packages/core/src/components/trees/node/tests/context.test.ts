import { describe, it, expect } from "vitest";
import { createContext, ContextMap } from "@/util/context";
import { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Provider, ThemeProvider } from "@/components/builtins/providers/providers";
import { ThemeToken, DataToken, SeedToken } from "@/runtime/builtin-context";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { provides } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";

/** Assemble a tree and attach it, the way precomp does at the start of a pass. */
function bind(root: Node2D): void {
    root.attach(attachScope());
}

describe("createContext / ContextMap", () => {
    it("returns the default when a token is unset", () => {
        const Money = createContext<number>(7);
        expect(ContextMap.EMPTY.get(Money)).toBe(7);
    });

    it("with() is immutable and nearest-wins per token", () => {
        const Money = createContext<number>(0);
        const a = ContextMap.EMPTY.with(Money, 1);
        const b = a.with(Money, 2);
        expect(a.get(Money)).toBe(1); // unchanged by the later layer
        expect(b.get(Money)).toBe(2);
    });

    it("keeps distinct tokens independent", () => {
        const A = createContext<number>(0);
        const B = createContext<string>("x");
        const m = ContextMap.EMPTY.with(A, 5);
        expect(m.get(A)).toBe(5);
        expect(m.get(B)).toBe("x"); // B falls back to its own default
    });
});

describe("Provider / useContext over the tree", () => {
    const Money = createContext<number>(0, "money");

    it("a descendant reads the nearest provider's value", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const root = new Provider({ context: Money, value: 500, children: [leaf] });
        bind(root);
        expect(leaf.useContext(Money)).toBe(500);
    });

    it("falls back to the token default with no provider", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const root = new Rect({ children: [leaf] });
        bind(root);
        expect(leaf.useContext(Money)).toBe(0);
    });

    it("nested providers shadow nearest-wins", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const middle = new Rect({ children: [leaf] });
        const inner = new Provider({ context: Money, value: 2, children: [middle] });
        const outer = new Provider({ context: Money, value: 1, children: [inner] });
        bind(outer);
        expect(leaf.useContext(Money)).toBe(2);    // nearest = inner
        expect(middle.useContext(Money)).toBe(2);  // between inner and leaf
        expect(inner.useContext(Money)).toBe(2);   // a provider sees its own value
        expect(outer.useContext(Money)).toBe(1);   // only above inner sees the outer value
    });

    it("supports a reusable provider bound to one context", () => {
        const MoneyProvider = component2d({
            key: "moneyProvider",
            state: { value: Types.custom<number | undefined>(undefined) },
            provide: (state) => [provides(Money, state.value ?? Money.defaultValue)],
        });
        const leaf = new Rect({ width: 1, height: 1 });
        const root = new MoneyProvider({ value: 42, children: [leaf] }) as Node2D;
        bind(root);
        expect(leaf.useContext(Money)).toBe(42);
    });

    it("binds context onto children added after the bind walk", () => {
        const root = new Provider({ context: Money, value: 9 });
        bind(root);
        const late = new Rect({ width: 1, height: 1 });
        root.add(late); // addChild pushes context + runs resolveContext immediately
        expect(late.useContext(Money)).toBe(9);
    });
});

describe("ThemeProvider built-in tokens", () => {
    it("provides theme / data / seed and merges nested theme nearest-wins", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const inner = new ThemeProvider({ theme: { brand: "#0f0" }, children: [leaf] });
        const outer = new ThemeProvider(
            { theme: { brand: "#f00", muted: "#888" }, data: { n: 5 }, seed: "abc", children: [inner] },
        );
        bind(outer);
        expect(leaf.useContext(ThemeToken)).toEqual({ brand: "#0f0", muted: "#888" }); // brand from inner, muted from outer
        expect(leaf.useContext(DataToken)).toEqual({ n: 5 });
        expect(leaf.useContext(SeedToken)).toBe("abc");
    });
});

describe("Provider with a token missing", () => {
    const Money = createContext<number>(11, "money");

    it("with no token passes the parent's map through, unchanged", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const outer = new Provider({ context: Money, value: 5, children: [new Provider({ value: 99, children: [leaf] } as never)] });
        bind(outer);
        // The inner provider names no token, so it adds nothing and `value` is not read.
        expect(leaf.useContext(Money)).toBe(5);
    });

    it("with no token and no ancestor leaves a token at its default", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        bind(new Provider({ children: [leaf] } as never));
        expect(leaf.useContext(Money)).toBe(11);
    });

    it("with a token and no value provides the token's default, shadowing an outer value", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        const inner = new Provider({ context: Money, children: [leaf] } as never);
        bind(new Provider({ context: Money, value: 5, children: [inner] }));
        expect(leaf.useContext(Money)).toBe(11);
        expect(inner.useContext(Money)).toBe(11);
    });

    it("with a token and no value provides the default over no ancestor, too", () => {
        const leaf = new Rect({ width: 1, height: 1 });
        bind(new Provider({ context: Money, children: [leaf] } as never));
        expect(leaf.useContext(Money)).toBe(11);
    });

    it("provides a falsy value as it is, rather than the default", () => {
        const Flag = createContext<boolean>(true, "flag");
        const Count = createContext<number>(9, "count");
        const leaf = new Rect({ width: 1, height: 1 });
        const outer = new Provider({ context: Flag, value: false, children: [leaf] });
        bind(outer);
        expect(leaf.useContext(Flag)).toBe(false);
        const zero = new Provider({ context: Count, value: 0, children: [leaf] });
        bind(zero);
        expect(leaf.useContext(Count)).toBe(0);
    });

    it("a provider bound to one context, given no value, provides the default", () => {
        const MoneyProvider = component2d({
            key: "moneyProvider",
            state: { value: Types.custom<number | undefined>(undefined) },
            provide: (state) => [provides(Money, state.value ?? Money.defaultValue)],
        });
        const leaf = new Rect({ width: 1, height: 1 });
        bind(new MoneyProvider({ children: [leaf] }) as Node2D);
        expect(leaf.useContext(Money)).toBe(11);
    });

    it("a provider can compute the value it provides", () => {
        const Doubled = component2d({
            key: "doubled",
            state: { value: 0 },
            provide: (state) => [provides(Money, state.value * 2)],
        });
        const leaf = new Rect({ width: 1, height: 1 });
        bind(new Doubled({ value: 21, children: [leaf] }) as Node2D);
        expect(leaf.useContext(Money)).toBe(42);
    });

    it("provides nothing to a node outside its subtree", () => {
        const inside = new Rect({ width: 1, height: 1 });
        const outside = new Rect({ width: 1, height: 1 });
        const provider = new Provider({ context: Money, value: 5, children: [inside] });
        bind(provider);
        outside.attach(attachScope());
        expect(inside.useContext(Money)).toBe(5);
        expect(outside.useContext(Money)).toBe(11);
    });
});

describe("a node's clock", () => {
    it("starts at zero before it is first advanced", () => {
        const node = new Rect({});
        expect(node.time).toMatchObject({ total: 0, creation: 0, elapsed: 0 });
    });

    it("seeds creation from the first advance, so elapsed starts at zero whenever the node arrives", () => {
        const node = new Rect({});
        node.attach(attachScope(3.5));
        expect(node.time).toMatchObject({ total: 3.5, creation: 3.5, elapsed: 0 });
    });

    it("measures elapsed from that first advance onwards", () => {
        const node = new Rect({});
        node.attach(attachScope(2));
        node.attach(attachScope(2.75));
        node.attach(attachScope(5));
        expect(node.time).toMatchObject({ total: 5, creation: 2, elapsed: 3 });
    });

    it("does not reseed creation on a later advance, even one that goes back", () => {
        const node = new Rect({});
        node.attach(attachScope(4));
        node.attach(attachScope(1));
        expect(node.time).toMatchObject({ total: 1, creation: 4, elapsed: -3 });
    });

    it("starts a child's clock at the time of the live node it is added to", () => {
        const root = new Rect({});
        root.attach(attachScope(1));
        const late = new Rect({});
        root.add(late);
        root.attach(attachScope(6));
        expect(root.time.creation).toBe(1);
        expect(late.time.creation).toBe(1);
        const later = new Rect({});
        root.add(later);
        root.attach(attachScope(8));
        expect(later.time).toMatchObject({ creation: 6, elapsed: 2 });
    });

    it("seeds a child added to a live parent from the parent's clock", () => {
        const root = new Rect({});
        root.attach(attachScope(5));
        const child = new Rect({});
        root.add(child);
        expect(child.time).toMatchObject({ total: 5, creation: 5, elapsed: 0 });
    });

    it("samples the node on every advance, after its clock has moved", () => {
        const seen: number[] = [];
        class Ticker extends Node2D {
            override _sample(): void {
                super._sample();
                seen.push(this.time.total);
            }
        }
        const node = new Ticker({});
        node.attach(attachScope(1));
        node.attach(attachScope(2));
        expect(seen).toEqual([1, 2]);
    });

    it("advances each node's own clock once per attach, not once per ancestor", () => {
        const ticks: string[] = [];
        class Ticker extends Node2D {
            override _sample(): void {
                super._sample();
                ticks.push(this.id);
            }
        }
        const leaf = new Ticker({ id: 'leaf' });
        const mid = new Ticker({ id: 'mid', children: [leaf] });
        const root = new Ticker({ id: 'root', children: [mid] });
        root.attach(attachScope(1));
        expect(ticks.sort()).toEqual(['leaf', 'mid', 'root']);
    });
});
