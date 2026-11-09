import type { Fill } from "@/attributes/shape/fill/chain";
import type { Shadow } from "@/attributes/shape/shadow/shadow";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import type { Vector2 } from "@/attributes/layout/vector2";
import { driveCommand, type Command, type CommandArgs } from "@/tween/command";
import type { EasingFunction } from "@/tween/ease/type";
import type { Node } from "@/components/trees/node/node";
import type { Node2D } from "@/components/trees/2d/node2d";

import { BooleanGroup, MaskGroup } from "@/components/builtins/geometry/composite";
import { Ellipse, PathShape, Polygon, Polygram, Rect } from "@/components/builtins/geometry/geometry";
import { Camera, OrbitCamera, RotatedBox } from "@/components/builtins/layout/layout";
import { Video } from "@/components/builtins/media/media";
import { AudioBus, SoundNode } from "@/components/builtins/audio/audio";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { Provider, ThemeProvider } from "@/components/builtins/providers/providers";
import { DefaultTextStyle, NumberNode, RichText, Text } from "@/components/builtins/text/text";
import { Canvas3D } from "@/components/builtins/three/canvas3d";
import {
    AmbientLight3D, AreaLight3D, Box3D, Camera3D, Capsule3D, Circle3D, Cone3D, Cylinder3D, DirectionalLight3D,
    Environment3D, Extrude3D, Fog3D, Group3D, HemisphereLight3D, Instances3D, Lathe3D, Line3D, Mesh3D, Model3D,
    Plane3D, PointLight3D, Points3D, Polyhedron3D, Ring3D, Sphere3D, SpotLight3D, Sprite3D, Torus3D, TorusKnot3D, Tube3D,
} from "@/components/builtins/three/three";

import { lerpVector2 } from "@/attributes/layout/vector2";
import { lerpColor } from "@/attributes/shape/fill/lerp";
import { parseColor } from "@/attributes/shape/fill/color/parser";
import { lerpVector3 } from "@/render3d/vector3";
import { lerpNumber } from "@/tween/lerp";

import type { NodeConstructor, Registry, VariableLerp } from "./registry";

/**
 * Registration of everything `@motionscript/core` itself ships.
 *
 * The keys here are **document API**. A stored scene names its nodes and its
 * animations with these strings, so renaming one silently breaks every document
 * that used it — they are as much a public contract as an exported symbol, and
 * are deliberately spelled out rather than derived from `constructor.name`
 * (which a minifier is free to mangle).
 */

/** Every built-in node type, keyed as a document names it. */
const NODE_TYPES: Record<string, NodeConstructor> = {
    // Clip root and structural
    canvas2d: Canvas2D as unknown as NodeConstructor,
    provider: Provider as unknown as NodeConstructor,
    "theme-provider": ThemeProvider as unknown as NodeConstructor,
    "default-text-style": DefaultTextStyle as unknown as NodeConstructor,

    // Geometry
    rect: Rect as unknown as NodeConstructor,
    ellipse: Ellipse as unknown as NodeConstructor,
    // The **unit-box** path, not `path-node.ts`'s face-value `Path`. A stored
    // document's `data` is a fraction of the node's own box, so a resize is an
    // ordinary `width`/`height` write and every editor gizmo works on it
    // unchanged (`box-path-node.ts` has the whole argument). `Path` draws its
    // `d` at face value and hugs it, which is right for geometry somebody wrote
    // in code — it stays exported for that, and is reached by importing the
    // class rather than by naming a type in a document.
    path: PathShape as unknown as NodeConstructor,
    polygon: Polygon as unknown as NodeConstructor,
    polygram: Polygram as unknown as NodeConstructor,
    boolean: BooleanGroup as unknown as NodeConstructor,
    mask: MaskGroup as unknown as NodeConstructor,

    // Layout
    camera: Camera as unknown as NodeConstructor,
    orbitCamera: OrbitCamera as unknown as NodeConstructor,
    "rotated-box": RotatedBox as unknown as NodeConstructor,

    // Text
    text: Text as unknown as NodeConstructor,
    richtext: RichText as unknown as NodeConstructor,
    number: NumberNode as unknown as NodeConstructor,

    // Media
    video: Video as unknown as NodeConstructor,

    // Audio — a bus groups, a sound plays. `audioBus` is also the root of an
    // AudioDocument, the way `canvas2d` is the root of a scene.
    audioBus: AudioBus as unknown as NodeConstructor,
    sound: SoundNode as unknown as NodeConstructor,

    // 3D — the viewport, then the tree that lives inside it
    canvas3d: Canvas3D as unknown as NodeConstructor,
    group3d: Group3D as unknown as NodeConstructor,
    mesh3d: Mesh3D as unknown as NodeConstructor,
    box3d: Box3D as unknown as NodeConstructor,
    sphere3d: Sphere3D as unknown as NodeConstructor,
    plane3d: Plane3D as unknown as NodeConstructor,
    circle3d: Circle3D as unknown as NodeConstructor,
    cylinder3d: Cylinder3D as unknown as NodeConstructor,
    cone3d: Cone3D as unknown as NodeConstructor,
    capsule3d: Capsule3D as unknown as NodeConstructor,
    torus3d: Torus3D as unknown as NodeConstructor,
    "torus-knot3d": TorusKnot3D as unknown as NodeConstructor,
    tube3d: Tube3D as unknown as NodeConstructor,
    lathe3d: Lathe3D as unknown as NodeConstructor,
    extrude3d: Extrude3D as unknown as NodeConstructor,
    ring3d: Ring3D as unknown as NodeConstructor,
    polyhedron3d: Polyhedron3D as unknown as NodeConstructor,
    points3d: Points3D as unknown as NodeConstructor,
    line3d: Line3D as unknown as NodeConstructor,
    sprite3d: Sprite3D as unknown as NodeConstructor,
    instances3d: Instances3D as unknown as NodeConstructor,
    model3d: Model3D as unknown as NodeConstructor,
    camera3d: Camera3D as unknown as NodeConstructor,
    "ambient-light3d": AmbientLight3D as unknown as NodeConstructor,
    "directional-light3d": DirectionalLight3D as unknown as NodeConstructor,
    "point-light3d": PointLight3D as unknown as NodeConstructor,
    "spot-light3d": SpotLight3D as unknown as NodeConstructor,
    "hemisphere-light3d": HemisphereLight3D as unknown as NodeConstructor,
    "area-light3d": AreaLight3D as unknown as NodeConstructor,
    fog3d: Fog3D as unknown as NodeConstructor,
    environment3d: Environment3D as unknown as NodeConstructor,
};

/** A node method taking one {@link CommandArgs}. */
type EasedMethod = (args: CommandArgs) => Command<Record<string, unknown>>;

/** Call a paint command (`fillTo`/`overlayTo`/`strokeTo`/`shadowTo`). */
function paintCommand(method: string, argKey: string) {
    return (
        target: Node,
        args: Record<string, unknown>,
        duration: number,
        easing?: EasingFunction,
    ): Command<Record<string, unknown>> => {
        const fn = (target as unknown as Record<string, unknown>)[method];
        if (typeof fn !== "function") {
            throw new Error(
                `Command "${method}" is not available on ${target.constructor.name}.`,
            );
        }
        return (fn as EasedMethod).call(target, { data: args[argKey] as Record<string, unknown>, duration, easing });
    };
}

/**
 * The interpolations a document can name in `VariableSpec.lerp`.
 *
 * Deliberately the small set a variable actually holds — a number, a point, a
 * colour — rather than one entry per attribute in the library. A variable drives
 * props *through* an expression, so it only has to carry the quantity that
 * varies: a gradient that shifts is one `stop` number bound into a fill, not a
 * whole fill being interpolated a second time. Anything else is a
 * `registry.addLerp` away.
 */
const VARIABLE_LERPS: Record<string, VariableLerp> = {
    number: lerpNumber as VariableLerp,
    vector2: lerpVector2 as VariableLerp,
    vector3: lerpVector3 as VariableLerp,
    /**
     * Parse both ends, blend per channel, hand back a CSS string.
     *
     * A string rather than the parsed tuple because that is what the prop on the
     * far side of the expression takes — every fill, stroke and shadow resolves
     * a colour from CSS text, and `parseColor` reads theme tokens and the
     * `"white/10"` opacity suffix too, so a variable can hold either.
     */
    color: ((from, to, t) => {
        const [r, g, b, a] = lerpColor(parseColor(String(from)), parseColor(String(to)), t);
        const channel = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
        return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Number(a.toFixed(4))})`;
    }) as VariableLerp,
    /**
     * No interpolation: hold `from` until the tween lands, then take `to`.
     *
     * The default for a non-numeric variable: a discrete value (a string of
     * text, an enum, a boolean) has no midpoint, and inventing one produces a
     * frame that is neither state.
     */
    step: ((from, to, t) => (t >= 1 ? to : from)) as VariableLerp,
};

/**
 * Seed a {@link Registry} with everything `@motionscript/core` itself ships.
 *
 * **Internal, and called from `Registry`'s own constructor.** It used to be
 * public and every host had to call it at module scope before compiling
 * anything — which `sideEffects: false` is entitled to delete, with a failure
 * mode ("unknown node type rect") that points nowhere near the cause. A registry
 * that seeds itself makes the vocabulary a value dependency of the engine
 * instead, so there is nothing left to tree-shake and nothing to remember.
 *
 * @internal
 */
export function installBuiltins(registry: Registry): void {
    for (const [key, ctor] of Object.entries(NODE_TYPES)) {
        registry.addNode(key, ctor);
    }
    for (const [key, lerp] of Object.entries(VARIABLE_LERPS)) {
        registry.addLerp(key, lerp);
    }

    // ── Props ────────────────────────────────────────────────────────────────
    // `args` *is* the props diff — no wrapper key, since `to`/`set` each carry
    // exactly one argument and a node's own props are already a fixed,
    // known-shape bag (not something a second command parameter could collide
    // with the way `to`/`set` never gained one).
    registry.addCommand("to", (target, args, duration, easing) =>
        (target as Node2D).to({
            // Copied: `_prepareStep` expands sugar into its target in place, which
            // would rewrite the document row a diff compares by identity.
            data: { ...args } as Record<string, never>,
            duration,
            easing,
        }) as unknown as Command<Record<string, unknown>>);

    // A stamp: write props with no tween. `duration` is ignored, which is what
    // makes it usable as the "set this here" a keyframe editor needs.
    //
    // `binds` because its args reach `set()` verbatim, so an expression among
    // them is a binding — this is how a prop starts following a variable partway
    // through a scene rather than from the moment its node is authored.
    registry.addCommand("set", (target, args) => {
        const props = args as Record<string, never>;
        return driveCommand(0, () => {
            (target as Node2D).set(props);
        }) as unknown as Command<Record<string, unknown>>;
    }, { binds: true });

    // ── Paint (shapes, text, Canvas2D) ─────────────────────────────────────
    // Node-less rather than per-type, like `to` and `set` above: these are
    // generic over every painted node, and they take a `TweenOptions` bag where
    // an ordinary command takes a bare easing function — so they need a factory
    // that knows that convention rather than the uniform one a node type's own
    // table dispatches through.
    // Each declares the one key it reads, in the kind its property uses, so a
    // host draws the same paint stack for the command as for the prop.
    registry.addCommand("fillTo", paintCommand("fillTo", "fill"), { args: [{ key: "fill", kind: "fills" }], method: "fillTo" });
    registry.addCommand("overlayTo", paintCommand("overlayTo", "overlay"), { args: [{ key: "overlay", kind: "fills" }], method: "overlayTo" });
    registry.addCommand("strokeTo", paintCommand("strokeTo", "stroke"), { args: [{ key: "stroke", kind: "strokes" }], method: "strokeTo" });
    registry.addCommand("shadowTo", paintCommand("shadowTo", "shadow"), { args: [{ key: "shadow", kind: "shadows" }], method: "shadowTo" });

    // Transform, camera, text and `restore` commands are not registered here:
    // they are `command()` methods, and `Registry.addNode` publishes them off
    // the classes above. See `document/registry.ts`.

    // ── Variables ────────────────────────────────────────────────────────────
    // Tween a variable. The one command that drives many nodes at once: every
    // prop bound to `"=[id]"` follows what this writes, with no command of its
    // own and nothing to keep in sync.
    registry.addVariableCommand("variableTo", (target, args, duration, easing) => {
        const to = (args as { value?: unknown }).value;
        const lerpKey = (args as { lerp?: unknown }).lerp;
        const override = typeof lerpKey === "string" ? registry.lerp(lerpKey) : undefined;
        if (lerpKey !== undefined && !override) {
            throw new Error(
                `A "lerp" param must name a registered lerp (variable "${target.id}"), ` +
                `got ${JSON.stringify(lerpKey)}. Registered: ${registry.lerpKeys().join(", ")}.`,
            );
        }
        const lerp = override ?? target.lerp;

        // `from` is captured on the command's first evaluation rather than here,
        // exactly as a node's `to()` does: the timeline builds commands in order
        // and runs each to `at(1)`, so the capture sees the state its
        // predecessors left. Captured once, it is then a pure function of `t`.
        let from: unknown;
        let captured = false;
        return driveCommand(duration, (t) => {
            if (!captured) {
                from = target.get();
                captured = true;
            }
            target.set(lerp(from, to, t));
        }, easing) as unknown as Command<Record<string, unknown>>;
    });

    // A stamp, matching `set`: write the value with no tween, ignoring duration.
    registry.addVariableCommand("variableSet", (target, args) =>
        driveCommand(0, () => {
            target.set((args as { value?: unknown }).value);
        }) as unknown as Command<Record<string, unknown>>);

    // ── State ────────────────────────────────────────────────────────────────
    // `restore` pops the layer a `save` pushed, and is published off `Node`'s own
    // `command()`. `save` is not one, so it is registered here — both are
    // commands so the pair is placed on the timeline like anything else, and a
    // seek past the save still produces the same frame: the value is computed
    // from the chain rather than accumulated as the playhead moves.
    registry.addCommand("save", (target) =>
        driveCommand(0, () => {
            (target as Node2D).save();
        }) as unknown as Command<Record<string, unknown>>);
}

/** Type-only re-exports, so a caller writing args gets the same shapes. */
export type { Fill, Shadow, Stroke, Vector2 };
