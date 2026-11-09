/** The last frame a render context drew, read back through `snapshotCanvas()` as RGBA8. */
export function snapshotPixels(context: unknown): { pixels: Uint8ClampedArray; width: number; height: number } {
    const canvas = (context as { snapshotCanvas(): HTMLCanvasElement | undefined }).snapshotCanvas();
    if (!canvas) throw new Error("Nothing has been drawn on this surface.");
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    return { pixels, width, height };
}
