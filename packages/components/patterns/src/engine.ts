/**
 * The patterns **kit**: what the three patterns share, and what a copied one does
 * not copy.
 *
 * `ms add` writes a pattern's own files into your project and rewrites its reach
 * for these to `@motionscript/patterns/kit`. `ViewportPattern` is the module a
 * camera-filling pattern is built from; `grid-lines` is the tiling every pattern
 * shares, which is what keeps a dot grid on a line grid's intersections, and a
 * copy that kept its own would drift from it.
 */
export * from "./kit"
