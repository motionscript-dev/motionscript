/**
 * The item grid **kit**: what the four grids share, and what a copied one does
 * not copy.
 *
 * `ms add` writes a grid's own files into your project and rewrites its reach for
 * these to `@motionscript/grids`, so the shared parts stay a real
 * dependency. That is not a size decision. `ItemGrid` keeps the register of
 * grids a morph looks another grid's arrangement up in, so a second copy of it
 * would be a second register, and a morph from one grid to another would only
 * find the grids its own copy was told of.
 */
export * from "./kit"
