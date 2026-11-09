/** The types of the component factories. */
import type { Alignment } from "@/attributes/layout/alignment";
import type { InsetsProps, InsetsResolved } from "@/attributes/layout/insets";
import type { Size2D, SizeInput } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { Effect } from "@/attributes/shape/effects/chain";
import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { NodeBlendMode } from "@/attributes/shape/fill/blend";
import type { BoxBounds } from "@/layout/bounds";
import type { PropInputs } from "@/attributes/properties/inputs";
import type { CameraScope, ChildPlane, Node2D, Node2DProps } from "@/components/trees/2d/node2d";
import type { Node } from "@/components/trees/node/node";
import type { SpaceCamera } from "@/attributes/layout/space3d";
import type { TextStyle } from "@/attributes/text/types";
import type { AudioEffectsInput } from "@/attributes/audio/effects/chain";
import type { Param } from "@/attributes/audio/ramp";
import type { AudioTransition } from "@/attributes/audio/transition";
import type { AudioEffect } from "@/attributes/audio/effects/union";
import type { Context } from "@/util/context";
import type { RefTarget } from "@/util/reference";
import type { Command } from "@/tween/command";
import type { Graphics2D } from "@/render/graphics2d";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import type { MaskOptions } from "@/attributes/mask/mask";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { ShadowResolved } from "@/attributes/shape/shadow/shadow";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import type { EasingFunction } from "@/tween/ease/type";
import type { TypeDef } from "@/components/factory/type-def";
import type { Color } from "@/attributes/shape/fill/color/parser";
import type { ChildSpace3D, Node3D } from "@/components/trees/three/node3d";
import type { CameraData3D } from "@/render3d/camera";
import type { Graphics3D } from "@/render3d/graphics3d";
import type { Scene3D } from "@/render3d/scene3d";
import type { LightData3D } from "@/render3d/light";
import type { EnvironmentData3D, FogData3D } from "@/render3d/scene-settings";
import type { Shadow3D, Transform3D } from "@/render3d/transform";
import type { Euler3, EulerOrder, Quaternion, Vector3, Vector3Input } from "@/render3d/vector3";

// =============================================================
// State entries
// =============================================================

declare const typeBrand: unique symbol;

/** A state entry's whole definition: what it accepts, what it resolves to, whether it is private. */
export interface Type<In, Out = In, Private extends boolean = false> {
    readonly [typeBrand]?: { readonly in: In; readonly out: Out; readonly private: Private };
    /** @internal The runtime half: default, mapper, tween, meaning. */
    readonly _def: TypeDef;
}

export type AnyType = Type<any, any, boolean>;
/** What a `state` field may hold: a Type, or a plain number, string or boolean default. */
export type Entry = AnyType | number | string | boolean;
export type StateSpec = { readonly [key: string]: Entry };

type TypeOf<E> =
    E extends AnyType ? E
    : E extends number ? Type<number>
    : E extends string ? Type<string>
    : E extends boolean ? Type<boolean>
    : never;
export type InOf<E> = TypeOf<E> extends Type<infer I, any, any> ? I : never;
export type OutOf<E> = TypeOf<E> extends Type<any, infer O, any> ? O : never;
type IsPrivate<E> = TypeOf<E> extends Type<any, any, infer P> ? P : false;
type IsReadOnly<E> = [InOf<E>] extends [never] ? true : false;

/** The resolved, typed values a field reads. */
export type Values<S> = { readonly [K in keyof S]: OutOf<S[K]> };
/** What a call or document may set: public entries, loose form, or a binding. */
export type Inputs<S> = {
    [K in keyof S as IsPrivate<S[K]> extends true ? never : IsReadOnly<S[K]> extends true ? never : K]?:
        InOf<S[K]> | (() => InOf<S[K]>);
};
/** What a command may write: any entry, public or private, loose form. */
export type Writes<S> = {
    [K in keyof S as IsReadOnly<S[K]> extends true ? never : K]?: InOf<S[K]>;
};

// =============================================================
// Built-in 2D placement
// =============================================================

export interface Box2DState {
    readonly x: Type<number>;
    readonly y: Type<number>;
    readonly width: Type<SizeInput>;
    readonly height: Type<SizeInput>;
    readonly rotation: Type<number>;
    readonly scale: Type<number>;
    readonly opacity: Type<number>;
    readonly pivot: Type<Alignment, Vector2>;
    readonly padding: Type<InsetsProps, InsetsResolved>;
    readonly effects: Type<Effect, NodeEffect[]>;
    readonly blend: Type<NodeBlendMode>;
    readonly clip: Type<boolean>;
    readonly flex: Type<number>;
    readonly rotationX: Type<number>;
    readonly rotationY: Type<number>;
    readonly depth: Type<number>;
    readonly perspective: Type<number>;
}

/** What every audio component has: its level, its place in the stereo field, and its own effects. */
export interface BoxAudioState {
    readonly volume: Type<Param>;
    readonly pan: Type<Param>;
    readonly mute: Type<boolean>;
    readonly effects: Type<AudioEffectsInput, AudioEffect[]>;
    readonly transitionIn: Type<AudioTransition | undefined>;
    readonly transitionOut: Type<AudioTransition | undefined>;
}

type BuiltIn2DCommand = "moveTo" | "fadeTo" | "rotateTo" | "scaleTo" | "layoutTo" | "effectTo" | "pulse" | "wiggle" | "to" | "set";

type Merge<P, S> = Omit<P, keyof S> & S;

// =============================================================
// Elements, components and child views
// =============================================================

declare const elementBrand: unique symbol;

/** What calling a component returns. In this slice, the built node itself. */
export interface Element<out K extends string = string, out S = unknown, out C = unknown> {
    readonly [elementBrand]?: { readonly key: K; readonly state: S; readonly commands: C };
}

type AnyComponent = Component<string, any, any, any, any, any>;
/** A whole tree, in `allowedChildren`: any component of it. */
type TreeName = "2d" | "3d" | "audio";
type Allowed = readonly (AnyComponent | TreeName)[] | null;

type ElementOf<A> =
    A extends null | undefined ? Element<string, Box2DState, {}>
    : A extends readonly [] ? never
    : A extends readonly (infer M)[] ? (M extends Component<infer K, infer S, infer C, any, any, any> ? Element<K, S, C> : M extends TreeName ? Element : never)
    : never;

/** Any node, in the nested and falsy forms a class's `children` took: what a component allowing whole trees accepts. */
type ChildrenOfTrees = Element | Node | false | null | undefined | readonly ChildrenOfTrees[];

/** Any 2D node, in the nested and falsy forms a class's `children` took: what a component allowing anything accepts. */
export type Children2D = Element | Node2D | false | null | undefined | readonly Children2D[];

type ChildrenProp<A> = [ElementOf<A>] extends [never]
    ? { readonly children?: never }
    : A extends null | undefined ? { readonly children?: Children2D }
    : A extends readonly TreeName[] ? { readonly children?: ChildrenOfTrees }
    : { readonly children?: readonly ElementOf<A>[] };

/** Built-in placement a 2D node takes beyond its entries: alignment keys (`center`, `topLeft`…), `transform3D`, `flex`. */
type Placement2DProps<S> = PropInputs<Omit<Node2DProps, keyof S | "children">>;

/**
 * What every call takes beside its entries: an id, a document key, and a
 * `ref` the node `R` is handed to while it is built, before its props apply.
 * A ref of a supertype of `R` is taken too (see {@link RefTarget}).
 */
interface CallMetadata<R> {
    readonly id?: string;
    readonly key?: string;
    readonly ref?: RefTarget<R>;
}

export type CallProps<S, A, R = Node2D> = Inputs<S> & Placement2DProps<S> & ChildrenProp<A> & CallMetadata<R>;

/** The node class generated from a spec: what a registry or an engine is handed. */
export type NodeClass<S, A, N extends Node = Node2D, P = CallProps<S, A>> = new (props?: P) => N;

/** What a component of a non-2D tree is called with: its entries, children of its tree, an id. */
export type TreeCallProps<S, R = Node> = Inputs<S> & CallMetadata<R> & {
    readonly children?: readonly (Element | Node)[];
};

/** The node a component of state `S` and commands `C` builds on `N`: what `new` returns and a `ref` is handed. */
export type BuiltNode<S, C, N extends Node = Node2D> = NodeValues<S, N> & CommandMethods<C, N>;

export interface Component<K extends string, S, C, A, N extends Node = Node2D, P = CallProps<S, A, BuiltNode<S, C, N>>> {
    (props?: P): Element<K, S, C>;
    /** Builds the same node as a call, typed as the node: for engine code written against a class. */
    new (props?: P): BuiltNode<S, C, N>;
    readonly key: K;
    /** The generated node class: hand it to an engine (`nodes: [Gauge.node]`) or a registry. */
    readonly node: NodeClass<S, A, N, P>;
    /** Narrows a child view: `children.filter(BarSeries.is)`. */
    is(child: ChildView<any>): child is ChildView<Element<K, S, C>>;
}

/**
 * The node a component builds, as engine code and tests holding one see it: the
 * node, and each entry's resolved value. Authoring code works with `Element`.
 */
export type NodeOf<C> = C extends Component<any, infer S, infer M, any, infer N, any> ? BuiltNode<S, M, N> : never;
/** A command, called on the node as a class's `command` method is. */
export type CommandMethods<C, N extends Node = Node2D> = {
    [K in Exclude<keyof C, keyof N>]: (args?: { readonly data?: unknown; readonly duration?: number; readonly easing?: EasingFunction }) => Command<Record<string, unknown>>;
};
export type NodeValues<S, N extends Node = Node2D> =
    (N extends Node2D ? Node2D<Node2DProps & EntryProps<S>> : N) & { -readonly [E in Exclude<keyof S, keyof N>]: OutOf<S[E]> };
/** Each entry's loose form, as `set` and `to` take it. */
type EntryProps<S> = { [E in Exclude<keyof S, keyof Node2DProps>]: InOf<S[E]> };

type StateOfElement<E> = E extends Element<any, infer S, any> ? S : never;
type CommandsOfElement<E> = E extends Element<any, any, infer C>
    ? unknown extends C ? string : (keyof C & string) | BuiltIn2DCommand
    : never;

/** A child, as a parent's fields see it. */
export interface ChildView<out E extends Element = Element> {
    readonly id: string;
    readonly key: E extends Element<infer K> ? K : string;
    readonly state: Values<StateOfElement<E>>;
    /** Its size, measured against the room this pass gives it; outside a pass (in a command), the size it was last laid out at. */
    readonly size: Size2D;
    /** Its own children, as it hands them to its fields: how a command reaches parts nested inside a child. */
    readonly children: readonly ChildView[];
    measure(max: Max): Size2D;
    to(targets: Writes<StateOfElement<E>>): Piece;
    run(name: CommandsOfElement<E>, args?: object): Piece;
}

// =============================================================
// What the engine hands each field
// =============================================================

export interface Max {
    readonly width?: number;
    readonly height?: number;
}

export interface FontSpec {
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly fontWeight?: number;
    readonly letterSpacing?: number;
}

export interface Measurer {
    readonly max: Max;
    /** The node's clock: a size that changes with time (a spin, a flow) reads it here. */
    readonly time: Clock;
    text(text: string, font: FontSpec): Size2D;
}

export interface Clock {
    readonly total: number;
    readonly elapsed: number;
}

/** What `load` declares: everything that must be in before the node is measured or drawn. */
export interface Loader {
    font(family: string, weight?: number | string): void;
    image(src: string): void;
    video(src: string, trim?: { readonly start?: number; readonly end?: number }): void;
    /**
     * Async setup. `before: "layout"` holds measuring too (a font engine, MathJax); the default holds only the frame.
     * A function `load` resolves to frees what it loaded when the asset's window is evicted.
     */
    task(key: string, load: () => Promise<unknown>, options?: { readonly before?: "layout" | "render" }): void;
    /** A paint the component works out itself (a run's fill); paint entries load themselves. */
    fill(fills: FillResolved | readonly FillResolved[]): void;
}

/** A value a component hands its subtree under a context, which `Types.*({ inherit })` entries read. */
export interface Provided<T = unknown> {
    readonly context: Context<T>;
    readonly value: T;
}

export function provides<T>(context: Context<T>, value: T): Provided<T> {
    return { context, value };
}

export interface RenderContext2D {
    readonly size: Size2D;
    readonly time: Clock;
    draw(graphics: Graphics2D | readonly Graphics2D[] | null | undefined): void;
    /** Draws your children here. */
    children(): void;
    /** Your first child is the stencil; the rest draw through it. */
    mask(options: MaskOptions): void;
    /** Your children become one shape by `op`, painted with `paint`. */
    merge(op: BooleanOperation, paint: MergePaint): void;
    /** Your children through a camera viewing your box. */
    camera(scope: CameraScope): void;
    /** Your children standing in one 2.5D space seen by `camera`, drawn far to near. */
    space(camera: SpaceCamera): void;
    /**
     * Your 3D children rendered into a new scene, for a fill (`Fills.canvas3D`) or
     * more drawing. Picking projects through the same scene.
     */
    scene3D(): Scene3D;
    /** Run `body` with `style` the default for text drawn in it; `null` refuses the inherited style. */
    textStyle(style: TextStyle | null, body: () => void): void;
    /** Run `body` with what it draws confined to `shape`'s outline. */
    clip(shape: Graphics2D, body: () => void): void;
    /**
     * Run `body` as your own paint: standing in a 2.5D space, only what lies in
     * front of the lens shows, as a class's own paint does. `Paint.draw` does this
     * for the paint it draws; a component drawing with `draw` wraps it here.
     */
    inFront(body: () => void): void;
    /** Whether an ancestor already stands you in a 2.5D space, so a space of your own would nest in it. */
    readonly inSpace: boolean;
    /** Your nearest ancestor that `component` built, read-only, or `null` when none is above you. */
    ancestor<K extends string, S, C>(component: Component<K, S, C, any, any, any>): NodeView<Element<K, S, C>> | null;
}

/** Another node as a component reads it: its id, its resolved state and the size it was laid out at. */
export interface NodeView<out E extends Element = Element> {
    readonly id: string;
    readonly key: E extends Element<infer K> ? K : string;
    /** As its own fields read it: a reference entry of its own is a view of that node from where it stands. */
    readonly state: Values<StateOfElement<E>>;
    readonly size: Size2D;
    /** Where it stands in the reader's own frame (y up from the reader's centre): offset, turn and scale. */
    readonly frame: NodeFrame;
}

export interface NodeFrame {
    readonly x: number;
    readonly y: number;
    readonly rotation: number;
    readonly scale: number;
}

/** What a merged shape is painted with: a shape's resolved paint entries. */
export interface MergePaint {
    readonly fill: FillResolved[];
    readonly stroke: StrokeResolved[];
    readonly shadow: ShadowResolved[];
    readonly overlay?: FillResolved[];
}

/** Where a 2D child goes: a box centred on (x, y) from your centre, y up, plus an optional slot transform. */
export interface Placement2D {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation?: number;
    readonly scale?: number;
    readonly opacity?: number;
    readonly depth?: number;
    readonly rotationX?: number;
    readonly rotationY?: number;
    /** What the child's own `x`/`y` mean in your units (a graph's): read wherever its position is, by paint, picking and a host's drag. */
    readonly plane?: ChildPlane;
}

/** Your content box, as `layout` is handed it, and the node's clock for a layout that moves with time. */
export interface LayoutBox extends BoxBounds {
    readonly time: Clock;
}

/** A point an editor can drag to set an entry: where it sits in your frame (y up from your centre), and the value dropping it there gives. */
export interface Handle<V> {
    at(state: V, size: Size2D): Vector2 | null;
    /** Where it was dropped, as the entry's value; by default the point itself. */
    value?(at: Vector2, state: V, size: Size2D): Vector2;
}

// =============================================================
// Commands
// =============================================================

declare const pieceBrand: unique symbol;
/** A timed piece of a command. */
export interface Piece {
    readonly [pieceBrand]?: true;
    /** @internal */
    readonly _piece: PieceData;
}

/** @internal */
export type PieceData =
    | { readonly kind: "tween"; readonly targets: Record<string, unknown> }
    | { readonly kind: "animate"; readonly frame: (t: number) => Record<string, unknown>; readonly eased: boolean }
    | { readonly kind: "wait"; readonly seconds: number }
    | { readonly kind: "sound"; readonly src: string; readonly options: SoundOptions }
    | { readonly kind: "together" | "sequence"; readonly pieces: readonly Piece[] }
    | { readonly kind: "stagger"; readonly pieces: readonly Piece[]; readonly overlap: number }
    | { readonly kind: "child"; readonly node: object; readonly targets: Record<string, unknown> }
    | { readonly kind: "run"; readonly node: object; readonly name: string; readonly args: object | undefined };

/** How a sound plays: today's `AudioClip` fields, and the bus it feeds when its node isn't one. */
export interface SoundOptions {
    readonly trimStart?: number;
    readonly trimEnd?: number;
    readonly loop?: boolean;
    readonly volume?: Param;
    readonly speed?: Param;
    readonly effects?: AudioEffectsInput;
    readonly transitionIn?: AudioTransition;
    readonly transitionOut?: AudioTransition;
    /** Missing from the catalog, it is skipped rather than an error. */
    readonly optional?: boolean;
    /** The id of the bus it feeds. A sound node feeds the buses it sits in. */
    readonly bus?: string;
    /** Ends with its source rather than staying open: a picture's sound, which stops when the picture does. */
    readonly closed?: boolean;
}

export interface Timeline<A = {}, S = {}> {
    readonly args: A;
    readonly duration: number;
    readonly easing: EasingFunction | undefined;
    /** The node this command acts on, read-only: its id (a seed), its size. */
    readonly node: NodeView;
    tween(targets: Writes<S>): Piece;
    /** `frame` at each point of the command; `eased: false` hands it linear progress, to ease per part with `ease`. */
    animate(frame: (t: number) => Writes<S>, options?: { readonly eased?: boolean }): Piece;
    /** The command's easing at `t`. */
    ease(t: number): number;
    /** `src` plays from here: cut when the command ends, or to its own end when the command has no length. */
    sound(src: string, options?: SoundOptions): Piece;
    wait(seconds: number): Piece;
    together(pieces: readonly Piece[]): Piece;
    sequence(pieces: readonly Piece[]): Piece;
    stagger(pieces: readonly Piece[], options?: { readonly overlap?: number }): Piece;
}

type Kids = readonly ChildView<any>[];

export type CommandEntry<A, S, V, K> =
    // The names as written, so a module's command fits any state holding those entries.
    | (A extends readonly unknown[] ? { readonly args: A & readonly (keyof Writes<S> & string)[]; readonly run?: undefined; readonly easing?: EasingFunction; readonly entrance?: boolean } : never)
    | ((timeline: Timeline<{}, S>, state: V, children: K) => Piece)
    // `easing`: what the command eases by when its row gives none. `entrance`:
    // the timeline holds its first frame ahead of it (`CommandMeta.entrance`).
    | (A extends readonly unknown[] ? never : { readonly args: A; run(timeline: Timeline<Values<A>, S>, state: V, children: K): Piece; readonly easing?: EasingFunction; readonly entrance?: boolean });

export type CommandsSpec<C, S, V, K> = { [N in keyof C]: CommandEntry<C[N], S, V, K> };

// =============================================================
// The 2D factory's fields
// =============================================================

export type FieldState<All, A> = Values<All> & { readonly children: readonly ChildView<ElementOf<A>>[] };
export type BuilderState<All, A> = Values<All> & { readonly children: readonly ElementOf<A>[] };
type OwnKids<A, B> = readonly ChildView<[B] extends [never] ? ElementOf<A> : Extract<B, Element>>[];

/**
 * New defaults for entries, own or built in. A function is a binding: handed the
 * live state, and `given`, what the call or document row set when the node was
 * built (which never changes), for a default derived from those.
 */
export type Defaults<All, A> = {
    readonly [E in keyof All]?: InOf<All[E]> | ((state: FieldState<All, A>, given: Readonly<Record<string, unknown>>) => InOf<All[E]>);
};

export interface Spec2D<K extends string, All, S, C, A, B> {
    readonly key: K;
    readonly state?: S;
    readonly defaults?: Defaults<All, A>;
    /** Old prop keys a stored row may still carry → the entry each became. */
    readonly renamed?: Readonly<Record<string, string>>;
    /** Entries that still work but should no longer be set: why, and what to use instead. */
    readonly deprecated?: Readonly<Record<string, string>>;
    /** Value hooks by entry, or by an old key in `renamed` to convert only what was stored under it (`migrateNodeProps`). */
    readonly migrate?: Readonly<Record<string, (value: unknown) => unknown>>;
    readonly allowedChildren?: A;
    /** The components it goes only inside; unsaid, wherever its tree allows. A row elsewhere fails its build. */
    readonly allowedParents?: readonly AnyComponent[];
    readonly children?: (state: BuilderState<All, A>) => readonly B[];
    readonly commands?: CommandsSpec<C, All, FieldState<All, A>, OwnKids<A, B>>;
    readonly load?: (loader: Loader, state: FieldState<All, A>) => void;
    /** What the subtree inherits: the nearest provider's value for each context, `inherited` reading what's above. */
    readonly provide?: (state: FieldState<All, A>, inherited: <T>(context: Context<T>) => T) => readonly Provided[];
    readonly measure?: (measurer: Measurer, state: FieldState<All, A>, children: OwnKids<A, B>) => Size2D;
    readonly layout?: (box: LayoutBox, state: FieldState<All, A>, children: OwnKids<A, B>) => readonly Placement2D[];
    /** What a child not added yet would take its `x`/`y` in: where a host drops or pastes one. Layout's `plane` answers for the rest. */
    readonly plane?: (box: LayoutBox, state: FieldState<All, A>) => ChildPlane | null;
    /** Points an editor can drag, by the entry each sets. */
    readonly handles?: { readonly [entry: string]: Handle<FieldState<All, A>> };
    /** Your bounds when they are not your box (a mark's ink): what selection and picking take. */
    readonly bounds?: (size: Size2D, state: FieldState<All, A>) => BoxBounds;
    readonly render?: (ctx: RenderContext2D, state: FieldState<All, A>) => void;
    /** The coordinates your 3D children's `x`, `y`, `z` are in (a graph's units), for a viewport over them. */
    readonly space?: (state: FieldState<All, A>) => ChildSpace3D | null;
}

/** A sound, or a bus mixing what is in it. It has no box and draws nothing: sound comes from its commands. */
export interface SpecAudio<K extends string, All, S, C, A, B> {
    readonly key: K;
    readonly state?: S;
    readonly defaults?: Defaults<All, A>;
    /** Old prop keys a stored row may still carry → the entry each became. */
    readonly renamed?: Readonly<Record<string, string>>;
    /** Entries that still work but should no longer be set: why, and what to use instead. */
    readonly deprecated?: Readonly<Record<string, string>>;
    /** Value hooks by entry, or by an old key in `renamed` to convert only what was stored under it (`migrateNodeProps`). */
    readonly migrate?: Readonly<Record<string, (value: unknown) => unknown>>;
    readonly allowedChildren?: A;
    /** The components it goes only inside; unsaid, wherever its tree allows. A row elsewhere fails its build. */
    readonly allowedParents?: readonly AnyComponent[];
    readonly children?: (state: BuilderState<All, A>) => readonly B[];
    readonly commands?: CommandsSpec<C, All, FieldState<All, A>, Kids>;
    readonly load?: (loader: Loader, state: FieldState<All, A>) => void;
    readonly provide?: (state: FieldState<All, A>, inherited: <T>(context: Context<T>) => T) => readonly Provided[];
}

// =============================================================
// The 3D tree
// =============================================================

/** What every 3D component has: its place, turn and scale, and how the scene shows it. */
export interface Transform3DState {
    readonly x: Type<number>;
    readonly y: Type<number>;
    readonly z: Type<number>;
    readonly rotationX: Type<number>;
    readonly rotationY: Type<number>;
    readonly rotationZ: Type<number>;
    readonly rotationOrder: Type<EulerOrder>;
    readonly quaternion: Type<Quaternion>;
    readonly scaleX: Type<number>;
    readonly scaleY: Type<number>;
    readonly scaleZ: Type<number>;
    readonly lookAt: Type<Vector3Input | undefined, Vector3 | undefined>;
    readonly visible: Type<boolean>;
    readonly shadow: Type<Shadow3D>;
    readonly renderOrder: Type<number>;
}

/** A 3D call's vector forms of the axes: `position: [x, y, z]`, `rotation`, `scale` (one number scales all three). */
export interface Placement3DProps {
    readonly position?: Vector3Input | (() => Vector3Input);
    readonly rotation?: Vector3Input | Euler3 | (() => Vector3Input | Euler3);
    readonly scale?: Vector3Input | (() => Vector3Input);
}

export type CallProps3D<S, R = Node3D> = TreeCallProps<S, R> & Placement3DProps;

/** What a 3D `render` draws into: today's scene calls, with a camera standing where its node stands. */
export interface RenderContext3D {
    readonly time: Clock;
    /**
     * `render` runs only so what it draws loads, and nothing is shown: only the
     * materials, models and environment count, so geometry built from data may be skipped.
     */
    readonly declaring: boolean;
    draw(graphics: Graphics3D | null | undefined): void;
    light(light: LightData3D, transform?: Transform3D): void;
    /** The scene's camera, placed by this node's transform. A node that stands one is no group: its children stay in its parent's space. */
    camera(camera: CameraData3D): void;
    fog(fog: FogData3D | Color | null): void;
    environment(environment: EnvironmentData3D | null): void;
}

export interface Spec3D<K extends string, All, S, C, A, B> {
    readonly key: K;
    readonly state?: S;
    readonly defaults?: Defaults<All, A>;
    /** Old prop keys a stored row may still carry → the entry each became. */
    readonly renamed?: Readonly<Record<string, string>>;
    /** Entries that still work but should no longer be set: why, and what to use instead. */
    readonly deprecated?: Readonly<Record<string, string>>;
    /** Value hooks by entry, or by an old key in `renamed` to convert only what was stored under it (`migrateNodeProps`). */
    readonly migrate?: Readonly<Record<string, (value: unknown) => unknown>>;
    readonly allowedChildren?: A;
    /** The components it goes only inside; unsaid, wherever its tree allows. A row elsewhere fails its build. */
    readonly allowedParents?: readonly AnyComponent[];
    readonly children?: (state: BuilderState<All, A>) => readonly B[];
    readonly commands?: CommandsSpec<C, All, FieldState<All, A>, Kids>;
    readonly load?: (loader: Loader, state: FieldState<All, A>) => void;
    readonly provide?: (state: FieldState<All, A>, inherited: <T>(context: Context<T>) => T) => readonly Provided[];
    readonly render?: (ctx: RenderContext3D, state: FieldState<All, A>) => void;
    /** The coordinates your 3D children's `x`, `y`, `z` are in (a graph's units): where each lands in yours. */
    readonly space?: (state: FieldState<All, A>) => ChildSpace3D | null;
}

export type { Merge, Kids, Allowed, AnyComponent };
