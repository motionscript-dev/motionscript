import { Size2D } from "@/attributes/layout/size";

/**
 * The host-facing half of a render context: where pixels land, and how the
 * preview frames them.
 *
 * Split out from `CanvasRenderContext2D` because a *node* never touches any of
 * it — a node draws, and the host decides what it is drawing into. A `Session`
 * owns one of these; a node is handed a `RenderContext2D`.
 *
 * **`mount` takes `unknown`, not `HTMLCanvasElement`.** `packages/core` compiles
 * with `lib: ["ES2022"]` and no DOM, deliberately, so this layer cannot name a
 * canvas — and it does not need to: a browser backend takes a canvas, a headless
 * one takes a size. Each narrows the argument at its own `mount`, where the
 * relevant types exist. A backend's context satisfies this structurally, so it
 * never imports it.
 */
export interface RenderSurface {
    mount(target: unknown): void;
    unmount(): void;
    /** Device pixels per viewport unit. Rasterization, not zoom — see {@link view}. */
    pixelRatio: number;
    /** Preview pan/zoom over the frame. Costs a repaint, never a surface rebuild. */
    view: { zoom: number; x: number; y: number };
    /** The frame's own size when the surface is a window onto it, else `null`. */
    frame: Size2D | null;
    clipToFrame: boolean;
    /**
     * What the frame's backdrop is painted with. `"transparent"` lets whatever
     * is behind the canvas show through where nothing was drawn.
     */
    frameBackground: "black" | "transparent";
}
