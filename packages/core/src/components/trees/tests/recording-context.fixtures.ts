import { NullRenderContext } from "@/render/null-render-context";
import type { Graphics2D } from "@/render/graphics2d";
import type { Clip } from "@/render/clip";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import type { MaskOptions } from "@/attributes/mask/mask";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { TransformState } from "@/render/descriptors/transform";
import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { NodeRenderState, RenderContext2D } from "@/render/render-context2d";
import type { BoxBounds } from "@/layout/bounds";
import type { Node2D } from "@/components/trees/2d/node2d";
import { attachScope } from "@/components/trees/node/node.fixtures";

/** One camera scope as the node opened it. */
export interface RecordedCamera {
    viewport: { x: number; y: number; width: number; height: number };
    lookAt: Vector2;
    zoom: number;
    heading: number;
}

/**
 * A render context that writes down the pass: every scope a node opens or closes,
 * every transform and every drawing handed to it, in the order they happened.
 *
 * It paints nothing (it is a {@link NullRenderContext}), but it walks exactly as a
 * painting backend would, so what it records is the sequence a renderer is asked to
 * replay. `events` is the readable form — one short token per call — and the typed
 * lists beside it hold the arguments a token cannot carry.
 *
 * - `begin:<id>` / `end` — a node's draw scope.
 * - `transform` — the node's transform was pushed.
 * - `draw:<kinds>` — a `Graphics2D`, as its op kinds joined by `+` (`rect+shadow+fill`).
 * - `beginBoolean:<op>` / `endBoolean`, `beginMask:<mode>:<inverted>` / `applyMask` / `endMask`,
 *   `beginClip` / `endClip`, `beginCamera` / `endCamera`, `beginEffects:<target>` / `endEffects`.
 */
export class RecordingContext extends NullRenderContext {
    readonly events: string[] = [];
    readonly graphics: Graphics2D[] = [];
    readonly cameras: RecordedCamera[] = [];
    readonly masks: (MaskOptions | undefined)[] = [];
    readonly clips: Clip[] = [];
    readonly transforms: Partial<TransformState>[] = [];
    readonly states: NodeRenderState[] = [];
    readonly effects: Array<{ effects: NodeEffect[]; target: string }> = [];

    /** Open scopes of any kind, by name. Each must be back to 0 when a pass is over. */
    private readonly open = new Map<string, number>();

    override begin(state: NodeRenderState): void {
        super.begin(state);
        // The state object is reused from frame to frame, so keep a copy.
        this.states.push({ ...state, velocity: { ...state.velocity } });
        this.events.push(`begin:${state.id}`);
        this.enter("node");
    }

    override end(): void {
        super.end();
        this.events.push("end");
        this.leave("node");
    }

    override transform(state: Partial<TransformState>): RenderContext2D {
        this.events.push("transform");
        this.transforms.push({ ...state });
        return super.transform(state);
    }

    protected override drawGraphics(graphics: Graphics2D): void {
        this.graphics.push(graphics);
        this.events.push(`draw:${graphics.ops().map((op) => op.kind).join("+")}`);
    }

    override beginBoolean(op: BooleanOperation): void {
        this.events.push(`beginBoolean:${op}`);
        this.enter("boolean");
    }
    override endBoolean(): void {
        this.events.push("endBoolean");
        this.leave("boolean");
    }

    override beginMask(options?: MaskOptions): void {
        this.events.push(`beginMask:${options?.mode ?? "-"}:${options?.inverted ?? "-"}`);
        this.masks.push(options);
        this.enter("mask");
    }
    override applyMask(): void {
        this.events.push("applyMask");
    }
    override endMask(): void {
        this.events.push("endMask");
        this.leave("mask");
    }

    override beginClip(clip: Clip): void {
        this.events.push("beginClip");
        this.clips.push(clip);
        this.enter("clip");
    }
    override endClip(): void {
        this.events.push("endClip");
        this.leave("clip");
    }

    override beginCamera(
        viewport: { x: number; y: number; width: number; height: number },
        lookAt: Vector2,
        zoom: number,
        heading: number,
    ): void {
        this.events.push("beginCamera");
        this.cameras.push({ viewport: { ...viewport }, lookAt: { ...lookAt }, zoom, heading });
        this.enter("camera");
    }
    override endCamera(): void {
        this.events.push("endCamera");
        this.leave("camera");
    }

    override beginEffects(effects: NodeEffect[], target: "foreground" | "backdrop", _width: number, _height: number): void {
        this.events.push(`beginEffects:${target}`);
        this.effects.push({ effects, target });
        this.enter("effects");
    }
    override endEffects(): void {
        this.events.push("endEffects");
        this.leave("effects");
    }

    /** Every scope still open, by kind — empty when the pass balanced. */
    get unbalanced(): Record<string, number> {
        return Object.fromEntries([...this.open].filter(([, depth]) => depth !== 0));
    }

    /** The tokens between the first `from` and the next `to`, exclusive. */
    between(from: string, to: string): string[] {
        const start = this.events.indexOf(from);
        const end = this.events.indexOf(to, start + 1);
        return this.events.slice(start + 1, end);
    }

    private enter(scope: string): void {
        this.open.set(scope, (this.open.get(scope) ?? 0) + 1);
    }

    private leave(scope: string): void {
        this.open.set(scope, (this.open.get(scope) ?? 0) - 1);
    }
}

/** Attach `node` as a live root and lay it out in `rect`, with a text measurer that measures nothing. */
export function laidOut<T extends Node2D>(
    node: T,
    rect: BoxBounds = { x: 0, y: 0, width: 200, height: 100 },
): T {
    node.attach(attachScope());
    node.layout(rect, { measureText: () => ({ width: 0, height: 0 }) } as never);
    return node;
}

/** Render `node` into a fresh {@link RecordingContext} and hand it back. */
export function recorded(node: Node2D): RecordingContext {
    const ctx = new RecordingContext();
    node.render(ctx);
    return ctx;
}

/** Everything a frame draws: every scope event, and every op of every drawing and clip. */
export function frameOf(node: Node2D) {
    const ctx = recorded(node);
    return { events: ctx.events, ops: ctx.graphics.map((g) => g.ops()), clips: ctx.clips.map((c) => c.ops()) };
}
