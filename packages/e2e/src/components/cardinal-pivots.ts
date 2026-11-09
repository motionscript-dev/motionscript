import { Flow, Graphics2D, Paint, Types, alignmentOps, component2d, type Alignment, type NodeOf, type Vector2 } from '@motionscript/sdk';

/**
 * Shapes drawn with a plain `pivot` + `x`/`y` descriptor (no cardinal-alignment
 * shorthand), each with a marker dot at the drawn origin, so the alignment's
 * effect reads at a glance: the named corner/edge of the shape's bounding box
 * stays pinned to the marker as the shape turns and grows about that same pivot.
 *
 * `shapeRotation`/`shapeScale` animate the descriptor's own transform rather than
 * the node's, which is the case the per-shape pivot fix had to cover.
 */

const marker = () => new Graphics2D().ellipse({ width: 10, height: 10, x: 0, y: 0 }).fill('accent');

interface Pivoted {
    readonly alignment: Vector2;
    readonly shapeRotation: number;
    readonly shapeScale: number;
}

/**
 * A shape node that draws `shape` about its alignment, and the marker over it.
 * Its paint entries are a shape's, unused. `font` is the family `shape` sets text in.
 */
function pivotShape<const K extends string>(key: K, shape: (g: Graphics2D, s: Pivoted) => Graphics2D, font?: string) {
    return component2d({
        key,
        state: {
            ...Paint.state, ...Flow.state,
            alignment: Types.custom<Alignment, Vector2>('center', { resolve: (v) => alignmentOps.resolve(v) }),
            shapeRotation: 0,
            shapeScale: 1,
        },
        commands: { ...Paint.commands },
        load: font ? (loader) => loader.font(font) : undefined,
        measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
        layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
        render: (ctx, state) => {
            ctx.inFront(() => {
                ctx.draw(shape(new Graphics2D(), state).fill('primary'));
                ctx.draw(marker());
            });
            ctx.children();
        },
    });
}

export const PivotRect = pivotShape('pivotRect', (g, s) => g.rect({
    width: 90, height: 60, cornerRadius: 10, pivot: s.alignment, x: 0, y: 0,
    rotation: s.shapeRotation, scale: s.shapeScale }));

/** A non-1:1 oval, so rotation is visible. */
export const PivotEllipse = pivotShape('pivotEllipse', (g, s) => g.ellipse({
    width: 90, height: 50, pivot: s.alignment, x: 0, y: 0,
    rotation: s.shapeRotation, scale: s.shapeScale }));

/** A triangle — an asymmetric silhouette, so rotation reads clearly. */
export const PivotPolygon = pivotShape('pivotPolygon', (g, s) => g.polygon({
    width: 70, height: 70, sides: 3, pivot: s.alignment, x: 0, y: 0,
    rotation: s.shapeRotation, scale: s.shapeScale }));

export const PivotPolygram = pivotShape('pivotPolygram', (g, s) => g.polygram({
    width: 80, height: 80, sides: 5, ratio: 0.5, pivot: s.alignment, x: 0, y: 0,
    rotation: s.shapeRotation, scale: s.shapeScale }));

/**
 * Text has no authored `width`/`height` — it sizes to its shaped content — so
 * this is the case the pivot fix had to cover separately from a box shape.
 */
export const PivotText = pivotShape('pivotText', (g, s) => g.text({
    text: 'Hello', fontFamily: 'Inter', fontSize: 22, pivot: s.alignment, x: 0, y: 0,
    rotation: s.shapeRotation, scale: s.shapeScale }), 'Inter');

export type PivotRect = NodeOf<typeof PivotRect>;
export type PivotEllipse = NodeOf<typeof PivotEllipse>;
export type PivotPolygon = NodeOf<typeof PivotPolygon>;
export type PivotPolygram = NodeOf<typeof PivotPolygram>;
export type PivotText = NodeOf<typeof PivotText>;
