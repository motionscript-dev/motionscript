import { Graphics2D } from "./graphics2d";
import type { Clip } from "./clip";
import type { RenderIssue } from "./render-issue";
import type { TransformState } from "./descriptors/transform";
import type { FontStyle, TextStyle } from "@/attributes/text/types";
import type { Size2D } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { MaskOptions } from "@/attributes/mask/mask";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import { TextState } from "./descriptors/text";
import { TextBlockLayout } from "./text-layout";
import { EMPTY_TEXT_STYLE, textOps } from "@/attributes/text/ops";
import { applyGraphicsTextDefaults } from "./text-defaults";
import type { NodeRenderState, RasterizedSurface, RenderContext2D, RenderPass2D, SpaceRects, EffectTarget } from "./render-context2d";
import type { NodeEffect } from "@/attributes/shape/effects/union";

/** The base every {@link RenderContext2D} backend extends. Owns what is the same whatever is rasterized (text-default stack, node scope stack, disposal) plus the host-facing half (`execute`, `screenshot`, `unmount`) the interface leaves out. **`draw` is final by convention**: it resolves ambient text defaults onto the op list and hands it to {@link drawGraphics}; owning that step here keeps the real renderer and the precomp asset walk agreeing on which font an under-specified `text` op uses. */
export abstract class CanvasRenderContext2D implements RenderPass2D {
    abstract measureText(text: string, fontSize: number, fontFamily: string, fontWeight?: number, letterSpacing?: number, fontStyle?: FontStyle): Size2D;

    // Inherited text-style defaults (see RenderContext2D.pushTextStyle).

    /** Defaults for the current draw scope, innermost last. Each entry is already merged onto the one below (see {@link pushTextStyle}), so the top is the effective style. */
    private readonly textStyleStack: TextStyle[] = [];

    pushTextStyle(style: TextStyle | null): void {
        this.textStyleStack.push(style === null ? EMPTY_TEXT_STYLE : textOps.mergeStyle(this.defaultTextStyle, style));
    }

    popTextStyle(): void {
        this.textStyleStack.pop();
    }

    /** The defaults in effect: innermost {@link pushTextStyle} scope, else the project's `theme.typography.default`. Carries all ten {@link TEXT_STYLE_KEYS}, but only shaping ones reach a `Graphics2D` op (see `TEXT_SHAPING_KEYS`). */
    get defaultTextStyle(): TextStyle {
        return this.textStyleStack[this.textStyleStack.length - 1] ?? textOps.preset("default");
    }

    /** See {@link RenderContext2D.draw}. Final by convention — override {@link drawGraphics}. */
    draw(graphics: Graphics2D): void {
        this.drawGraphics(applyGraphicsTextDefaults(graphics, this.defaultTextStyle));
    }

    /** Paint a `Graphics2D` whose text ops have already been resolved against the
     *  ambient defaults. Backends implement this instead of {@link draw}. */
    protected abstract drawGraphics(graphics: Graphics2D): void;

    /** `null` by default, so a backend that never reports glyph positions only gives up on-canvas text editing. See {@link RenderContext2D.layoutTextBlock}. */
    layoutTextBlock(state: Partial<TextState>): TextBlockLayout | null {
        return null;
    }

    protected currentNodeStack: string[] = [];

    protected currentNodeId(): string {
        if (this.currentNodeStack.length === 0) {
            throw new Error("No current node in context");
        }

        return this.currentNodeStack[this.currentNodeStack.length - 1];
    }

    /** Remove all renderer-side resources for the current node (called on unmount). */
    abstract unmount(): void;

    private _disposed = false;
    /** `true` after `dispose()` — the context must not be used after this point. */
    isDisposed(): boolean {
        return this._disposed;
    }
    dispose(): void {
        this._disposed = true;
    }

    /** Runs `callback`, which issues shape/paint calls, then flushes to the render target. A throwing callback still throws, and the next pass starts clean. */
    abstract execute(callback: () => void): void;
    /** What the frames since the last call drew without failing but not as the document says (a missing blend mode, a shader that doesn't compile, a lost GPU device), once per kind, feature and node; a bare string is a `shader` issue. Playback reports them as render errors, export hands them to `onIssue`. */
    takeRenderIssues(): Array<RenderIssue | string> {
        return [];
    }
    /** Capture the current frame as a base-64 PNG data URL, or `undefined` if unsupported. */
    abstract screenshot(): string | undefined;

    abstract transform(state: Partial<TransformState>): RenderContext2D;

    abstract beginBoolean(op: BooleanOperation): void;
    abstract endBoolean(): void;

    abstract beginMask(options?: MaskOptions): void;
    abstract applyMask(): void;
    abstract endMask(): void;

    abstract beginClip(clip: Clip): void;
    abstract endClip(): void;

    /** See {@link RenderContext2D.beginEffects}. No-op by default. */
    beginEffects(effects: NodeEffect[], target: EffectTarget, width: number, height: number): void { }
    endEffects(): void { }

    /** See {@link RenderContext2D.rasterize}. Returns `null` by default. */
    rasterize(
        width: number,
        height: number,
        draw: () => void,
        pixelRatio?: number,
    ): RasterizedSurface | null {
        return null;
    }

    abstract beginCamera(viewport: { x: number; y: number; width: number; height: number }, lookAt: Vector2, zoom: number, heading: number): void;
    abstract endCamera(): void;

    /** Render state per node on the draw stack, parallel to `currentNodeStack`, so `space: 'parent'` fills can resolve their reference rect and motion effects read the node's velocity. */
    protected renderStateStack: NodeRenderState[] = [];

    readonly readsSpaceRects: boolean = true;

    readonly drawsVisibleOnly: boolean = true;

    begin(state: NodeRenderState): void {
        this.currentNodeStack.push(state.id);
        this.renderStateStack.push(state);
    }

    end(): void {
        this.currentNodeStack.pop();
        this.renderStateStack.pop();
    }

    /** Reference rects for the node currently being drawn (parent / viewport). */
    protected currentSpaceRects(): SpaceRects {
        return this.renderStateStack[this.renderStateStack.length - 1]?.rects ?? {};
    }

    /** Full render state (incl. velocity) for the node currently being drawn, if any. */
    protected currentRenderState(): NodeRenderState | undefined {
        return this.renderStateStack[this.renderStateStack.length - 1];
    }

    /** Closes every node and text-style scope still open; a backend calls it when a pass ends so a pass that threw can't leave the next inside its scopes. */
    protected _resetScopes(): void {
        this.textStyleStack.length = 0;
        this.currentNodeStack.length = 0;
        this.renderStateStack.length = 0;
    }
}
