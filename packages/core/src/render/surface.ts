import { Size2D } from "@/attributes/layout/size";

/** The host-facing half of a render context: where pixels land and how the preview frames them. Split from `CanvasRenderContext2D` because a *node* never touches it; a `Session` owns one of these, a node gets a `RenderContext2D`. `mount` takes `unknown`, not `HTMLCanvasElement`: core compiles with `lib: ["ES2022"]` and no DOM, so this layer can't name a canvas; a browser backend takes a canvas, a headless one a size, each narrowing at its own `mount`, and a backend's context satisfies this structurally. */
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
    /** What the frame's backdrop is painted with; `"transparent"` lets whatever is behind the canvas show where nothing was drawn. */
    frameBackground: "black" | "transparent";
}
