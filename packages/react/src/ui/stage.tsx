import { useEffect, useRef, type CSSProperties } from "react";

import type { EngineRenderContext, Size2D } from "@motionscript/core";

import { isSessionDisposed, type Player } from "./use-motion-player";

/** Core compiles without the DOM lib, so `RenderSurface.mount` takes `unknown`; narrowed here, where `HTMLCanvasElement` exists. */
type StageRenderContext = Omit<EngineRenderContext, "mount"> & {
    mount(canvas: HTMLCanvasElement): void;
};

const IDENTITY_VIEW = Object.freeze({ zoom: 1, x: 0, y: 0 });

export interface MotionStageProps {
    player: Player;
    /**
     * Device pixels rasterized per viewport unit. Defaults to `1`. Not a zoom or
     * a crop: the scene's coordinate space is unchanged and CSS scales the canvas
     * back to its box. `<1` suits a preview shown far smaller than the output size.
     *
     * Every change re-creates the GPU surface, dropping texture-backed images
     * (decoded video frames, 3D composites; they re-upload on demand), so quantize
     * to a few steps and never drive it from a resize observer. Prefer scales that
     * keep both dimensions whole: `pixelRatio` is one number, so uneven rounding
     * shifts the frame's centre by up to half a device pixel.
     *
     * `player.screenshot()` returns the surface's size, so it is scaled too.
     */
    renderScale?: number;
    /**
     * The canvas's own size in CSS pixels, when it is not the frame. Omitted, the
     * canvas is the frame: `viewport × renderScale`, stretched over its box.
     *
     * Supplied together with {@link view}, the canvas becomes a window onto the
     * frame: it takes the size of the area shown, `renderScale` means device
     * pixels per CSS pixel, and only what is on screen is rasterized, so zooming
     * in stays sharp. It re-creates the surface like `renderScale`: quantize it.
     */
    surfaceSize?: Size2D;
    /**
     * Pan and zoom applied to the render itself; requires {@link surfaceSize}.
     * `zoom` multiplies scene units; `x`/`y` offset the frame's centre in CSS
     * pixels, positive `y` downwards (a CSS translate).
     *
     * A change costs a repaint and nothing else. A CSS transform could not add
     * resolution it was not rasterized with.
     */
    view?: { zoom: number; x: number; y: number };
    /**
     * Whether the frame's edge bounds what draws. Requires {@link surfaceSize} and
     * {@link view}. Defaults to `true`; off lets a node parked past the edge
     * rasterize into the rest of the surface.
     */
    clipToFrame?: boolean;
    /**
     * Defaults to `"black"`. `"transparent"` leaves undrawn frame pixels
     * unpainted so the host's backdrop (a checkerboard) shows through. Requires
     * {@link surfaceSize} and {@link view}.
     */
    frameBackground?: "black" | "transparent";
    className?: string;
    style?: CSSProperties;
}

/**
 * A canvas bound to a {@link Player}'s session. One stage per player: a session
 * drives one surface, and a second stage would take it from the first.
 */
export function MotionStage({
    player,
    renderScale = 1,
    surfaceSize,
    view,
    clipToFrame,
    frameBackground,
    className,
    style,
}: MotionStageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { session } = player;
    // The session's own size, not the player's: the player's moves a commit
    // ahead, in the commit whose cleanup disposes the old session, and a buffer
    // resized there would re-bind that disposed session.
    const viewport = session?.viewport ?? player.viewport;

    // Floored at 1: a zero-sized surface fails creation outright.
    const bufferWidth = Math.max(1, Math.round((surfaceSize?.width ?? viewport.width) * renderScale));
    const bufferHeight = Math.max(1, Math.round((surfaceSize?.height ?? viewport.height) * renderScale));

    // Without both `surfaceSize` and `view` the canvas is the frame, so all four revert to defaults.
    const activeView = surfaceSize && view ? view : IDENTITY_VIEW;
    const activeFrame = surfaceSize && view ? viewport : null;
    const activeClipToFrame = surfaceSize && view ? (clipToFrame ?? true) : true;
    const activeFrameBackground = surfaceSize && view ? (frameBackground ?? "black") : "black";

    const viewRef = useRef(activeView);
    const frameRectRef = useRef(activeFrame);
    const clipToFrameRef = useRef(activeClipToFrame);
    const frameBackgroundRef = useRef(activeFrameBackground);
    // A ref because the context is mutable external state whose knobs are
    // written; writing through the `player` prop trips the immutability lint.
    const ctxRef = useRef<StageRenderContext | null>(null);
    useEffect(() => {
        viewRef.current = activeView;
        frameRectRef.current = activeFrame;
        clipToFrameRef.current = activeClipToFrame;
        frameBackgroundRef.current = activeFrameBackground;
        ctxRef.current = session ? (session.surface as StageRenderContext) : null;
    });

    // Bind the surface and rebuild it when the backing store changes. An effect,
    // not a callback, because React has written the canvas's new `width`/`height`
    // by the time effects run and the renderer reads them when it builds the
    // surface: mounting before the resize would build the previous size.
    // `repaint()` because a new surface starts blank and a paused clock would not
    // fill it.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        // A replayed effect can hold a session its player has since disposed.
        if (!session || !canvas || !ctx || isSessionDisposed(session)) return;
        ctx.pixelRatio = renderScale;
        ctx.view = viewRef.current;
        ctx.frame = frameRectRef.current;
        ctx.clipToFrame = clipToFrameRef.current;
        ctx.frameBackground = frameBackgroundRef.current;
        // Detaches the old surface first, which drops the texture-backed images
        // that belong to it.
        ctx.mount(canvas);
        session.controller.repaint();
    }, [session, renderScale, bufferWidth, bufferHeight]);

    // Keyed on the view's fields, not the object: callers pass a fresh
    // `{zoom, x, y}` every render, which would repaint every render.
    useEffect(() => {
        const ctx = ctxRef.current;
        if (!session || !ctx || isSessionDisposed(session)) return;
        ctx.view = { zoom: activeView.zoom, x: activeView.x, y: activeView.y };
        ctx.frame = activeFrame;
        ctx.clipToFrame = activeClipToFrame;
        ctx.frameBackground = activeFrameBackground;
        session.controller.repaint();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        session,
        activeView.zoom,
        activeView.x,
        activeView.y,
        activeFrame?.width,
        activeFrame?.height,
        activeClipToFrame,
        activeFrameBackground,
    ]);

    return (
        <div className={className} style={{ position: "relative", width: "100%", height: "100%", ...style }}>
            <canvas
                ref={canvasRef}
                width={bufferWidth}
                height={bufferHeight}
                style={{
                    display: session ? "block" : "none",
                    ...(surfaceSize
                        ? {
                              // `surfaceSize` is honoured literally, not stretched
                              // to the box: it is quantized, so it is usually a
                              // little larger than the box and a different shape,
                              // and stretching would squash one axis.
                              //
                              // Centred because `executePass` puts the scene origin
                              // at the surface's centre, so this lands the frame
                              // where the layout says; the spare pixels hang off
                              // all four edges and the parent clips them.
                              position: "absolute",
                              left: "50%",
                              top: "50%",
                              width: `${surfaceSize.width}px`,
                              height: `${surfaceSize.height}px`,
                              transform: "translate(-50%, -50%)",
                          }
                        : { width: "100%", height: "100%" }),
                }}
            />
        </div>
    );
}
