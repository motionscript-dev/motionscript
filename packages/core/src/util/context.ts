/** Typed context tokens for passing inherited data down the node tree, like React's `createContext` / `useContext` but resolved over the scene-node tree. A {@link Context} is an opaque token with a phantom type `T` and a default; providers attach a value to the {@link ContextMap} pushed to descendants, and `node.useContext(token)` reads the nearest ancestor's value or the default. */
export interface Context<T> {
    /** Identity used as the map key. Unique per `createContext` call. */
    readonly id: symbol;
    /** Value returned by `useContext` when no ancestor provides this token. */
    readonly defaultValue: T;
    readonly name?: string;
}

/**
 * @example
 * const Money = createContext<number>(0, "money");
 * // provide: <Provider context={Money} value={500}>…</Provider>
 * // consume: init() { const m = this.useContext(Money); }  // m: number
 */
export function createContext<T>(defaultValue: T, name?: string): Context<T> {
    return { id: Symbol(name ?? "context"), defaultValue, name };
}

/** An immutable, layered token→value map carried down the tree. Each provider derives a child map via {@link with}, so a deeper provider shadows a shallower one (nearest-ancestor-wins) with no stack bookkeeping. */
export class ContextMap {
    private constructor(private readonly entries: ReadonlyMap<symbol, unknown>) { }

    static readonly EMPTY = new ContextMap(new Map());

    with<T>(ctx: Context<T>, value: T): ContextMap {
        const next = new Map(this.entries);
        next.set(ctx.id, value);
        return new ContextMap(next);
    }

    get<T>(ctx: Context<T>): T {
        return this.entries.has(ctx.id) ? (this.entries.get(ctx.id) as T) : ctx.defaultValue;
    }
}
