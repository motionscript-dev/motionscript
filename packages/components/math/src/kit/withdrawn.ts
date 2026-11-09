/**
 * The paint entries and commands a math node may have no use for: a node that
 * is only a line has no fill, an area no outline, and one that reveals itself
 * in its own way no outline trim.
 */
export const FILL_PAINT = ["fill", "fillTo"] as const;
export const STROKE_PAINT = ["stroke", "strokeTo"] as const;
export const OUTLINE_TRIM = ["start", "end", "progressTo", "flash"] as const;
