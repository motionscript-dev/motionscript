import {
    Registry,
    type CommandSpec,
    type CompositionDocument,
    type EaseSpec,
    type StillDocument,
    type TimedNodeSpec,
    type VariableSpec,
} from '@motionscript/sdk';
import { NODES } from '../nodes';

/**
 * The e2e scenes' authoring surface — the `scene(build, steps)` and `createRef`
 * they were written against — recording a {@link CompositionDocument} instead of
 * building nodes.
 *
 * Steps are placed exactly as the old chain placed them: each starts where the
 * previous one ended, a number is a hold, and an array starts together and lasts
 * as long as its longest. The document's `duration` is the chain's total, so a
 * trailing hold is kept rather than read off the last command's end.
 *
 * A tree is written with {@link el}, and the same tree builds a {@link StillDocument}
 * through `still(build)`, which is the point of nodes being one shape: only
 * `startAt`/`endAt` and the steps are composition-only.
 */

/** One command a step records. */
export interface StepCommand {
    readonly type: string;
    /** `null` addresses the stage — the root row, which has no id of its own to name. */
    readonly targetId: string | null;
    readonly duration: number;
    readonly easing?: EaseSpec;
    readonly args: Record<string, unknown>;
}

export type Step = (() => StepCommand) | number | ReadonlyArray<() => StepCommand>;

/** What `el` returns: a node type and its props, not yet a row. */
export interface SpecElement {
    readonly ctor: abstract new (...args: never[]) => object;
    readonly props: Record<string, unknown>;
    readonly ref?: DocRef<unknown>;
    readonly startAt?: number;
    readonly endAt?: number;
    readonly children: readonly SpecElement[];
}

/** A child as `children` takes it: an array is a fragment, and `false`/`null`/`undefined` drop out. */
export type Child = SpecElement | readonly Child[] | null | undefined | boolean;

/** A component (`Rect`) or a node class: anything `new`-able, typed by its first parameter. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeType = abstract new (...args: any[]) => object;

/** A prop bound to a variable, `"=[id]"` — see core's `document/expression`. */
type Expression = `=${string}`;
type Authored<P> = { [K in keyof P]: P[K] | Expression };
/** Per member of a props union (`NumberNode`'s differ by `format`), so no member's keys are lost to `Omit`. */
type AuthoredProps<P> = P extends unknown ? Authored<Omit<P, 'children' | 'ref'>> : never;

/** What a row carries besides the node's props: its ref, its span, and its children. */
export interface ElementAttributes {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly ref?: DocRef<any>;
    readonly startAt?: number;
    readonly endAt?: number;
    readonly children?: Child;
}

export type ElementProps<C extends NodeType> = AuthoredProps<NonNullable<ConstructorParameters<C>[0]>> & ElementAttributes;

/**
 * A node of `type` as a row-to-be: `el(Rect, { width: 100, children: [el(Text, { text: 'hi' })] })`.
 * Calling the component itself would build a node, not a document row.
 */
export function el<C extends NodeType>(type: C, props?: ElementProps<C>): SpecElement {
    // `startAt`/`endAt` are the row's span, not props — a painted node's own
    // `start`/`end` are path trim, and these must never reach the class.
    const { children, ref, startAt, endAt, ...rest } = (props ?? {}) as Record<string, unknown>;
    if (typeof type !== 'function') throw new Error(`el(${String(type)}) is not a node type.`);
    const element: SpecElement = {
        ctor: type as SpecElement['ctor'],
        props: rest,
        ref: ref as DocRef<unknown> | undefined,
        ...(typeof startAt === 'number' && { startAt }),
        ...(typeof endAt === 'number' && { endAt }),
        children: flattenChildren(children as Child),
    };
    if (element.ref) element.ref._element = element;
    return element;
}

/** A ref's methods, each recording the command it names. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Recorder<T> = { readonly [K in keyof T]: (args?: any) => StepCommand };

export interface DocRef<T> {
    (): Recorder<T>;
    /** The element it was attached to, for a build-time `set`. */
    _element?: SpecElement;
    /** The row id that element was given, once the tree is flattened. */
    _id?: string;
}

export function createRef<T>(): DocRef<T> {
    const ref: DocRef<T> = () => recorder(ref) as Recorder<T>;
    return ref;
}

type EaseArgs = EaseSpec['args'];

export const linear = (): EaseSpec => ({ kind: 'linear' });
export const easeIn = (args?: EaseArgs): EaseSpec => ({ kind: 'in', args });
export const easeOut = (args?: EaseArgs): EaseSpec => ({ kind: 'out', args });
export const easeInOut = (args?: EaseArgs): EaseSpec => ({ kind: 'inOut', args });

/** A command by type, for a step a ref's own methods cannot express. */
export function cmd(ref: DocRef<unknown>, type: string, data: Record<string, unknown>, duration: number, easing?: EaseSpec): StepCommand {
    if (ref._id === undefined) throw new Error(`cmd("${type}") on a ref that is not attached to an element.`);
    return record(ref._id, type, { data, duration, easing });
}

/** A command on the stage itself — its camera moves (`panTo`, `orbitTo`, `dollyTo`, …). */
export function stageCommand(type: string, data: Record<string, unknown>, duration: number, easing?: EaseSpec): StepCommand {
    return { type, targetId: null, duration, easing, args: toJson(data, `stage.${type}`) as Record<string, unknown> };
}

/** Tween a variable declared with `stage.variable` — every prop bound to it follows. */
export function variableTo(id: string, value: unknown, duration: number, easing?: EaseSpec): StepCommand {
    return { type: 'variableTo', targetId: id, duration, easing, args: { value: toJson(value, `${id}.variableTo`) } };
}

/** The stage a scene's build writes to: the root's props, its variables, and the trees under it. */
export class DocStage {
    readonly root: Record<string, unknown> = {};
    readonly variables: Array<{ id: string; value: unknown }> = [];
    readonly trees: SpecElement[] = [];

    set(props: Record<string, unknown>): void {
        Object.assign(this.root, props);
    }

    /** Declare a value props follow through an expression, `"=[id]"`. */
    variable(id: string, value: unknown): void {
        this.variables.push({ id, value });
    }

    add(tree: Child): void {
        this.trees.push(...flattenChildren(tree));
    }
}

export function scene(build: (stage: DocStage) => void, steps: readonly Step[] = []): CompositionDocument {
    const stage = new DocStage();
    build(stage);
    const nodes = stageNodes(stage, true);

    const commands: CommandSpec[] = [];
    let at = 0;
    let n = 0;
    for (const step of steps) {
        if (typeof step === 'number') {
            at += step;
            continue;
        }
        let longest = 0;
        for (const make of Array.isArray(step) ? step : [step as () => StepCommand]) {
            const { type, targetId, duration, easing, args } = make();
            commands.push({ id: `step${n++}`, type, targetId, at, duration, ...(easing && { easing }), args });
            longest = Math.max(longest, duration);
        }
        at += longest;
    }
    // A node leaving after the last step still has to be seen leaving.
    const lastNodeTime = Math.max(0, ...nodes.flatMap((n) => [n.startAt ?? 0, n.endAt ?? 0]));
    return { kind: 'composition', duration: Math.max(at, lastNodeTime), variables: stageVariables(stage), nodes, commands };
}

/** The same build, as a still: its nodes and variables, and nothing about time. */
export function still(build: (stage: DocStage) => void): StillDocument {
    const stage = new DocStage();
    build(stage);
    return { kind: 'still', variables: stageVariables(stage), nodes: stageNodes(stage, false) };
}

// ─── Internals ──────────────────────────────────────────────────────────────

/** Paint commands take their data under one key — see `paintCommand` in core's builtins. */
const PAINT_ARG: Record<string, string> = { fillTo: 'fill', overlayTo: 'overlay', strokeTo: 'stroke', shadowTo: 'shadow' };

const registry = new Registry({ nodes: NODES as never });
const KEYS = new Map<unknown, string>(registry.nodeKeys().map(key => [registry.node(key)!.ctor, key]));

interface CallArgs {
    data?: unknown;
    duration?: number;
    easing?: EaseSpec;
}

function flattenChildren(child: Child, out: SpecElement[] = []): SpecElement[] {
    if (child === null || child === undefined || typeof child === 'boolean') return out;
    if (Array.isArray(child)) {
        for (const c of child) flattenChildren(c, out);
        return out;
    }
    if (typeof child === 'object' && 'ctor' in child) {
        out.push(child as SpecElement);
        return out;
    }
    throw new Error(`A ${typeof child} child is not a node — text goes in el(Text, { text: … }).`);
}

function recorder(ref: DocRef<unknown>): Recorder<unknown> {
    return new Proxy({}, {
        get: (_, method) => (arg: CallArgs = {}) => ref._id === undefined
            ? writeAtBuild(ref, String(method), arg)
            : record(ref._id, String(method), arg),
        // `node().op = 'union'` during the build is an authored prop too.
        set: (_, prop, value) => {
            if (ref._id !== undefined) throw new Error(`Assigning "${String(prop)}" through a ref after the build — use a step.`);
            writeAtBuild(ref, 'set', { [prop]: value });
            return true;
        },
    }) as Recorder<unknown>;
}

/** A `set` made while the tree is still being built is an authored prop, as it was under the chain. */
function writeAtBuild(ref: DocRef<unknown>, method: string, props: object): never {
    if (method !== 'set' || !ref._element) {
        throw new Error(`"${method}" called on a ref during the build — only set() is authored there; commands are steps.`);
    }
    Object.assign(ref._element.props, props);
    return undefined as never;
}

function record(targetId: string, type: string, arg: CallArgs): StepCommand {
    if (typeof arg.duration !== 'number') {
        throw new Error(`${type} on "${targetId}" has no duration — a document has no per-method default to fall back on.`);
    }
    const data = arg.data ?? {};
    const argKey = PAINT_ARG[type];
    return {
        type,
        targetId,
        duration: arg.duration,
        easing: arg.easing,
        args: toJson(argKey ? { [argKey]: data } : data, `${targetId}.${type}`) as Record<string, unknown>,
    };
}

function stageVariables(stage: DocStage): VariableSpec[] {
    return stage.variables.map(({ id, value }) => ({ id, value: toJson(value, id) }));
}

/** The stage's root row, if the build set anything on it, then every tree under it. */
function stageNodes(stage: DocStage, timed: boolean): TimedNodeSpec[] {
    const nodes: TimedNodeSpec[] = [];
    if (Object.keys(stage.root).length > 0) {
        nodes.push({ id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: jsonProps(stage.root, 'stage') });
    }
    const counts = new Map<string, number>();
    stage.trees.forEach((tree, i) => flatten(tree, null, i, counts, nodes, timed));
    return nodes;
}

function flatten(
    el: SpecElement,
    parentId: string | null,
    layerOrder: number,
    counts: Map<string, number>,
    out: TimedNodeSpec[],
    timed: boolean,
): void {
    // A component names the node class it generated.
    const type = KEYS.get((el.ctor as { node?: unknown }).node ?? el.ctor);
    if (!type) throw new Error(`${el.ctor.name} is not a registered node type — add it to src/nodes.ts.`);
    const n = counts.get(type) ?? 0;
    counts.set(type, n + 1);
    const id = `${type}${n}`;
    if (el.ref) {
        if (el.ref._id !== undefined) throw new Error(`One ref is attached to two elements ("${el.ref._id}" and "${id}").`);
        el.ref._id = id;
    }
    if (!timed && (el.startAt !== undefined || el.endAt !== undefined)) {
        throw new Error(`el(${el.ctor.name}) carries startAt/endAt in a still — a still has no timeline.`);
    }
    out.push({
        id, type, parentId, layerOrder,
        ...(el.startAt !== undefined && { startAt: el.startAt }),
        ...(el.endAt !== undefined && { endAt: el.endAt }),
        props: jsonProps(el.props, id),
    });
    el.children.forEach((child, i) => flatten(child, id, i, counts, out, timed));
}

function jsonProps(props: Record<string, unknown>, path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        if (value !== undefined) out[key] = toJson(value, `${path}.${key}`);
    }
    return out;
}

/** A value as plain data, or an error naming where it is not — the page bridge serializes documents. */
function toJson(value: unknown, path: string): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    // What `JSON.stringify` writes for a non-finite number, so a scene sees what a stored document holds.
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((v, i) => toJson(v, `${path}[${i}]`));
    if (typeof value === 'object') {
        const serializable = value as { toJSON?: () => unknown };
        if (typeof serializable.toJSON === 'function') return toJson(serializable.toJSON(), path);
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            throw new Error(`${path} is a ${proto.constructor?.name ?? 'class'} instance — a document holds plain data.`);
        }
        return jsonProps(value as Record<string, unknown>, path);
    }
    throw new Error(`${path} is a ${typeof value} — a document holds plain data; a binding belongs in a registered node.`);
}
