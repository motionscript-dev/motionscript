import { expressionOps } from "./expression/ops";
import type { Registry } from "./registry";

/**
 * How a node type's props changed since documents first named it — declared by
 * a component spec's `renamed`, `deprecated` and `migrate`, applied to a row's
 * props whenever one is built, and callable by a host rewriting stored rows.
 *
 * Unlike a document migration this has no version to go by: a row stored a year
 * ago and one stored today pass through the same rules, so every rule has to
 * leave a current value alone.
 */
export interface PropEvolution {
    /** Old key → the entry it became. A row setting both keeps the new one. */
    readonly renamed: Readonly<Record<string, string>>;
    /** Entry → why it is deprecated and what to use instead. It still works. */
    readonly deprecated: Readonly<Record<string, string>>;
    /**
     * Key → a value hook. Keyed by an old key from {@link renamed}, it converts
     * only what was stored under that key (a unit change rides on a rename);
     * keyed by an entry, it runs on every stored value and must hand a current
     * one back unchanged. `undefined` drops the prop back to its default.
     */
    readonly migrate: Readonly<Record<string, (value: unknown) => unknown>>;
}

/** One prop a migration touched, or one a row still sets that is deprecated. */
export interface PropNote {
    prop: string;
    message: string;
}

export interface PropMigration {
    /** The props given, when nothing changed; a new object otherwise. */
    props: Record<string, unknown>;
    changes: PropNote[];
    deprecated: PropNote[];
}

const PROP_EVOLUTION = Symbol("propEvolution");

/** @internal Record `evolution` on a node class; a component factory does this for its generated class. */
export function declarePropEvolution(ctor: abstract new (...args: never[]) => object, evolution: PropEvolution): void {
    (ctor.prototype as Record<symbol, unknown>)[PROP_EVOLUTION] = evolution;
}

/** @internal What {@link declarePropEvolution} recorded on this exact class. */
export function propEvolutionOf(ctor: abstract new (...args: never[]) => object): PropEvolution | undefined {
    const proto = ctor.prototype as Record<symbol, unknown> | undefined;
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, PROP_EVOLUTION)) return undefined;
    return proto[PROP_EVOLUTION] as PropEvolution;
}

/**
 * Bring a stored row's props up to what `type` declares today: old keys
 * renamed, values migrated, deprecated props reported. A type this registry
 * does not know, or one that never changed, hands `props` back as it is.
 *
 * Applies equally to a `to`/`set` command's args, which are a props diff.
 * An expression is moved by a rename but handed to no value hook: a formula's
 * result cannot be converted by rewriting it, so it is noted and left as written.
 */
export function migrateNodeProps(registry: Registry, type: string, props: Record<string, unknown>): PropMigration {
    const ctor = registry.node(type)?.ctor;
    const evolution = ctor ? propEvolutionOf(ctor) : undefined;
    return evolution ? applyPropEvolution(evolution, props) : { props, changes: [], deprecated: [] };
}

/** @internal {@link migrateNodeProps} once the type's rules are in hand. */
export function applyPropEvolution(evolution: PropEvolution, props: Record<string, unknown>): PropMigration {
    const changes: PropNote[] = [];
    const deprecated: PropNote[] = [];
    let out: Record<string, unknown> | null = null;
    const write = () => (out ??= { ...props });
    const isExpression = (value: unknown) => expressionOps.collect(value, "").length > 0;

    const convert = (key: string, value: unknown, at: string): unknown => {
        const hook = evolution.migrate[key];
        if (!hook || value === undefined) return value;
        if (isExpression(value)) {
            changes.push({ prop: at, message: `"${at}" is an expression, so its value was left as written.` });
            return value;
        }
        return hook(value);
    };

    for (const [from, to] of Object.entries(evolution.renamed)) {
        if (!Object.hasOwn(props, from)) continue;
        const target = write();
        const value = convert(from, props[from], from);
        delete target[from];
        if (props[to] !== undefined) {
            changes.push({ prop: from, message: `"${from}" was renamed "${to}", which the row also sets; the old value was dropped.` });
            continue;
        }
        if (value === undefined) delete target[to];
        else target[to] = value;
        changes.push({ prop: from, message: `"${from}" was renamed "${to}".` });
    }

    for (const key of Object.keys(evolution.migrate)) {
        if (Object.hasOwn(evolution.renamed, key)) continue;
        const current = (out ?? props)[key];
        if (current === undefined) continue;
        const next = convert(key, current, key);
        if (next === current) continue;
        const target = write();
        if (next === undefined) delete target[key];
        else target[key] = next;
        changes.push({ prop: key, message: next === undefined ? `"${key}" was dropped back to its default.` : `"${key}" was migrated.` });
    }

    for (const [key, message] of Object.entries(evolution.deprecated)) {
        if ((out ?? props)[key] !== undefined) deprecated.push({ prop: key, message });
    }
    return { props: out ?? props, changes, deprecated };
}
