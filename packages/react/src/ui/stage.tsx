import { useEffect, useRef, type CSSProperties } from "react";

import type { EngineRenderContext, Size2D } from "@motionscript/core";

import { isSessionDisposed, type Player } from "./use-motion-player";

/**
 * The session's surface, with `mount` narrowed to a canvas.
 *
 * `core` compiles without the DOM lib, so `RenderSurface.mount` takes `unknown`
 * there. This is the narrowing that seam always assumed: it happens here, in
 * the one layer that genuinely has `HTMLCanvasElement`.
 */
type StageRenderContext = Omit<EngineRenderContext, "mount"> & {
    mount(canvas: HTMLCanvasElement): void;
};

/**
 * What every stage that doesn't ask for a view gets: the whole frame, 1:1.
 *
 * A shared frozen object rather than a literal, so the view effect's dependency
 * on its fields is stable across renders for the overwhelming majority of
 * stages, which never pass `view` at all.
 */
const IDENTITY_VIEW = Object.freeze({ zoom: 1, x: 0, y: 0 });

export interface MotionStageProps {
    /** The player whose session this stage draws. */
    player: Player;
    /**
     * Device pixels to rasterize per viewport unit. Defaults to `1`.
     *
     * **Not a zoom and not a crop.** The viewport stays the scene's logical
     * coordinate space; this only changes how many real pixels that space is
     * drawn into, and CSS scales the canvas back up to fill its box.
     *
     * The lever exists because a preview is usually displayed far smaller than
     * the project's output size: a 1920×1080 project in a 700px-wide panel
     * rasterizes roughly seven times the pixels anyone can see. `0.5` there is a
     * quarter of the fill, the shader work and the effect offscreens.
     *
     * Two things to know before animating it:
     *
     * - **Every change re-creates the GPU surface**, which drops the storage
     *   adapter's texture-backed images (decoded video frames, 3D composites;
     *   still images survive) and asks for a fresh GL context. Quantize to a few
     *   steps and let it settle — never drive it from a resize observer.
     * - **Prefer scales that keep both dimensions whole.** `pixelRatio` is one
     *   uniform number, so a scale that rounds differently on each axis shifts
     *   the frame's centre by up to half a device pixel.
     *
     * A snapshot from `player.screenshot()` comes back at the surface's size, so
     * it is scaled too — render at `1` if you need full resolution out of it.
     */
    renderScale?: number;
    /**
     * The canvas's own size in CSS pixels, when it is **not** the frame.
     *
     * Omitted — the default — the canvas is the frame: sized `viewport ×
     * renderScale` and stretched over its box by CSS, which is what every
     * export, thumbnail and plain player wants.
     *
     * Supplied, together with {@link view}, the canvas becomes a *window* onto
     * the frame: it takes the size of the area it is shown in, `renderScale`
     * stops meaning "fraction of the project's resolution" and starts meaning
     * device pixels per CSS pixel, and only what is on screen is rasterized.
     * That is what lets an editor zoom in without going soft or paying for the
     * whole frame at the zoomed resolution.
     *
     * It re-creates the surface exactly as `renderScale` does, and wants the
     * same treatment: quantize it and let it settle.
     */
    surfaceSize?: Size2D;
    /**
     * A pan and zoom applied to the render itself. Requires {@link surfaceSize}.
     *
     * `zoom` multiplies scene units; `x`/`y` offset the frame's centre in CSS
     * pixels, positive `y` downwards — the same sign convention as a CSS
     * translate, so a preview can hand over the pan it was already computing.
     *
     * Changing it costs a repaint and nothing else: no surface, no textures, no
     * precomp. That is the point of it living here rather than in a CSS
     * transform, which cannot add resolution it was not rasterized with.
     */
    view?: { zoom: number; x: number; y: number };
    /**
     * Whether the frame's edge bounds what draws, rather than only where its own
     * backdrop goes. Requires {@link surfaceSize} and {@link view}. Defaults to
     * `true`.
     *
     * Off lets a node parked past the frame's edge rasterize into the rest of
     * the surface instead of being discarded — for a host that wants to show,
     * faded, what a node placed there while animating in or out.
     */
    clipToFrame?: boolean;
    /**
     * What the frame's backdrop is painted with. Defaults to `"black"`.
     *
     * `"transparent"` leaves the frame unpainted where nothing was drawn, so
     * whatever the host renders behind the canvas shows through — a
     * checkerboard, for an editor that has to distinguish "no scene covers this"
     * from "a scene covers it in black". Requires {@link surfaceSize} and
     * {@link view}, the same way {@link clipToFrame} does.
     */
    frameBackground?: "black" | "transparent";
    className?: string;
    style?: CSSProperties;
}

/**
 * A canvas bound to a {@link Player}'s session.
 *
 * The stage owns how the frame is rasterized — resolution, view, clipping — and
 * nothing about what is in it or when. A session drives **one** surface, so one
 * stage per player: a second would take the surface from the first.
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

    /**
     * The canvas's backing store, in device pixels. `viewport × renderScale` in
     * the default case, where the canvas *is* the frame; with `surfaceSize` it
     * is the viewing area instead.
     *
     * Floored at 1 so a degenerate scale can't ask the renderer for a zero-sized
     * surface, which fails the surface creation outright.
     */
    const bufferWidth = Math.max(1, Math.round((surfaceSize?.width ?? viewport.width) * renderScale));
    const bufferHeight = Math.max(1, Math.round((surfaceSize?.height ?? viewport.height) * renderScale));

    /**
     * The view transform to draw with, and the frame to clip and anchor against.
     * Only meaningful together, so they resolve in one place: no `surfaceSize`
     * means the canvas is the frame, and both revert to identity.
     */
    const activeView = surfaceSize && view ? view : IDENTITY_VIEW;
    const activeFrame = surfaceSize && view ? viewport : null;
    const activeClipToFrame = surfaceSize && view ? (clipToFrame ?? true) : true;
    const activeFrameBackground = surfaceSize && view ? (frameBackground ?? "black") : "black";

    const viewRef = useRef(activeView);
    const frameRectRef = useRef(activeFrame);
    const clipToFrameRef = useRef(activeClipToFrame);
    const frameBackgroundRef = useRef(activeFrameBackground);
    /**
     * The live render context.
     *
     * Held here rather than reached through `player.session` at each use because
     * it is mutable external state — a GPU context whose knobs are written, not
     * a value derived from a prop — and writing through the prop is what the
     * immutability lint is there to catch everywhere it *isn't* one of these.
     */
    const ctxRef = useRef<StageRenderContext | null>(null);
    useEffect(() => {
        viewRef.current = activeView;
        frameRectRef.current = activeFrame;
        clipToFrameRef.current = activeClipToFrame;
        frameBackgroundRef.current = activeFrameBackground;
        ctxRef.current = session ? (session.surface as StageRenderContext) : null;
    });

    /**
     * Bind the surface, and rebuild it when the backing store changes.
     *
     * The order matters and is why this is an effect rather than a callback:
     * React has already written the canvas's new `width`/`height` by the time
     * effects run, and the renderer reads exactly those when it builds the surface
     * (`MakeOnScreenGLSurface(ctx, canvas.width, canvas.height)`). Mounting
     * before the resize would produce a surface of the previous size.
     *
     * `repaint()` afterwards because a new surface starts blank and the clock is
     * not necessarily running to fill it — a paused editor would otherwise show
     * black until something else moved.
     */
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
        // `mount` detaches the old surface first, which also drops the storage
        // adapter's texture-backed images — they belong to the surface that made
        // them. Video frames and 3D composites are re-uploaded on demand;
        // decoded still images are raster-backed and survive.
        ctx.mount(canvas);
        session.controller.repaint();
    }, [session, renderScale, bufferWidth, bufferHeight]);

    /**
     * Apply {@link MotionStageProps.view} — a repaint and nothing more.
     *
     * Depends on the fields rather than the object so a caller passing a fresh
     * `{zoom, x, y}` each render — which is every caller, since it comes from a
     * gesture — doesn't repaint on renders where the view didn't move.
     */
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
                // The backing store, in device pixels. CSS below stretches it
                // back over the whole box either way, so this is purely how much
                // gets rasterized.
                width={bufferWidth}
                height={bufferHeight}
                style={{
                    display: session ? "block" : "none",
                    ...(surfaceSize
                        ? {
                              // `surfaceSize` is the canvas's CSS size, so it is
                              // honoured literally rather than stretched to the
                              // box: it is quantized by its caller, which means
                              // it is usually a little larger than the box and
                              // rarely the same shape. Stretched, that
                              // difference would land as a non-uniform scale — a
                              // picture squashed on one axis, a far worse
                              // artefact than the softness this arrangement
                              // exists to remove.
                              //
                              // Centred, so the surface's midpoint is the box's
                              // midpoint: `executePass` puts the scene origin at
                              // the centre of the surface, so this is what makes
                              // the frame land where the caller's layout says it
                              // is. The spare pixels hang off all four edges and
                              // are clipped by whatever is holding this.
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
