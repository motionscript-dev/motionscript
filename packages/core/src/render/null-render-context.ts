import type { RenderContext2D } from "./render-context2d";
import { CanvasRenderContext2D } from "./canvas-render-context2d";
import { Graphics2D } from "./graphics2d";
import { Clip } from "./clip";
import { TransformState } from "./descriptors/transform";
import { BooleanOperation } from "@/attributes/mask/boolean";
import { MaskOptions } from "@/attributes/mask/mask";
import { Vector2 } from "@/attributes/layout/vector2";
import type { Size2D } from "@/attributes/layout/size";

/** Shared, since nothing here measures anything and no caller mutates it. */
const ZERO_SIZE: Size2D = { width: 0, height: 0 };

/** A `RenderContext2D` that runs a render pass and rasterizes nothing: every hook is inert but the *walk* is real (`render()` recurses, `draw()` applies text defaults, a {@link rasterize} subtree is entered), so it exercises the traversal, ordering and skip rules a backend would see. For tests and hosts driving structure without pixels. Deliberately **not** an asset-discovery pass: nodes declare assets (see `Node.declareAssets`), and collecting them from what a walk paints is the coupling that made a font impossible to load before the layout that named it. */
export class NullRenderContext extends CanvasRenderContext2D {
    /** Parent-space rects cost a resolution pass per node and nothing here reads them; this walk is about which nodes are visited, not where they land. */
    override readonly readsSpaceRects = false;

    protected drawGraphics(graphics: Graphics2D): void { }

    measureText(): Size2D {
        return ZERO_SIZE;
    }

    unmount(): void { }

    execute(callback: () => void): void {
        callback();
    }

    screenshot(): string | undefined {
        return undefined;
    }

    /** Nothing is rasterized, but the subtree is still walked. */
    override rasterize(width: number, height: number, draw: () => void): null {
        draw();
        return null;
    }

    transform(state: Partial<TransformState>): RenderContext2D {
        return this;
    }

    beginBoolean(op: BooleanOperation): void { }
    endBoolean(): void { }

    beginMask(_options?: MaskOptions): void { }
    applyMask(): void { }
    endMask(): void { }

    beginClip(clip: Clip): void { }
    endClip(): void { }

    beginCamera(
        _viewport: { x: number; y: number; width: number; height: number },
        _centerOn: Vector2,
        _zoom: number,
        _heading: number,
    ): void { }
    endCamera(): void { }
}
