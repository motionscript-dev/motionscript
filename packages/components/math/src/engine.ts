/**
 * The math **kit**: what the nodes share, and what a copied one does not copy.
 *
 * `ms add` writes a node's own files into a project and rewrites its reach for
 * these to `@motionscript/math`, so MathJax, the morph and every shared module
 * stay a real dependency with one identity.
 */
export {
    blankLatex, buildLatexPath, findLatexParts, latexPartNames, LatexError, LatexNotLoaded, loadMathJax, mathJaxLoaded, MATHJAX_LOADER,
} from './tex/geometry';
export type { LatexPart, LatexToken, LatexPathResult } from './tex/geometry';
export { defaultLatexMorph } from './tex/tween';
export type { AnimatedToken, LatexMorphStrategy } from './tex/tween';
export { Latex } from './tex/node';
export type { LatexProps, LatexStrategies } from './tex/node';
export {
    drawFormula, formula, formulaFrame, formulaOf, isFormula, latexPartBounds, layoutFormula, lerpMorph, loadFormula, measureFormula, Morph, morphOf,
    partBoundsIn, settled, TYPESET, TYPESET_COMMANDS,
} from './tex/typeset';
export type { FormulaFrame, Morphing, TypesetValues } from './tex/typeset';
export { lerpPartFills, partPaint, readPartFills, withPartFill } from './kit/part-fills';
export type { PartFill, PartFillResolved } from './kit/part-fills';
export { FILL_PAINT, OUTLINE_TRIM, STROKE_PAINT } from './kit/withdrawn';
export { createBoundedCache } from './kit/cache';
export { listed, omit, PAINT, PAINT_COMMANDS, painted } from './kit/component';
export type { BoundedCache } from './kit/cache';

export { drawSystem, plotArea, systemLayout, systemMap, systemOpenPlane, systemProvides, systemSize } from './kit/system';
export type { MapFor, SystemState } from './kit/system';
// A number plane is axes with a grid, so a copied one builds on these rather than a copy of them.
export { Axes2d, AXES, AXES_COMMANDS, axesFurniture, axesMap, axesOf, loadAxes } from './systems/axes2d';
export type { Axes2dProps, AxesValues, AxisLayout } from './systems/axes2d';
export type { Anchor } from './kit/place';
export { anchored, openPlane, placeOnMap } from './kit/place';
export {
    castsShadow, drawMark, graphPoint, inkCentre, inkSize, markRuns, markShape, ownPoint, reading, strokeShape, traced,
} from './kit/mark';
export type { MarkOptions, MarkPaint, MarkReading, MarkState, Tracer } from './kit/mark';
export { curveFor, PLANE_ENTRY, PLOT, PLOT_REF, plotPlane, refId, settle, SYSTEM, SYSTEM_ENTRY, systemPlane } from './kit/graph';
export type { GraphPlane } from './kit/graph';
export { axisScale, cartesianMap, resolveInterval, PIXEL_MAP } from './kit/coords';
export type { AxisScale, AxisScaling, CartesianOptions, CoordinateMap, Interval } from './kit/coords';
export { compileExpression, compileExpressionCached, expressionVocabulary, MATH_DIALECT } from './kit/expression';
export type { CompiledExpression, ExpressionScope, ExpressionVocabulary } from './kit/expression';
export { equationError, equationParams, parseEquation, EQUATION_VARIABLES } from './kit/equation';
export type { Equation } from './kit/equation';
export { lerpDomain, lerpParams, lerpSource, readSource, revisionOf, scopeFor, UNSET_PARAM } from './kit/source';
export type { PlotSource } from './kit/source';
export { sampleCurve } from './kit/sampler';
export type { CurveProjection, SampleOptions } from './kit/sampler';
export { formatTick, ticksFor } from './kit/ticks';
export type { Ticks } from './kit/ticks';
export { boundsOfRuns, clamp, inflate, runsToPath, stated } from './kit/geometry';
export { CURVE_KEYS, curveValue, isCurve } from './kit/curve';
export type { CurveValues } from './kit/curve';
export { along, AXIS_COLOR, declareFormulas, drawLabels, drawn, lerpInterval, loadFormulas, PLOT_COLOR, readInterval, withoutTips } from './kit/furniture';
export type { Label, LabelStyle } from './kit/furniture';
export {
    add, between, container, FOLLOW_COMMANDS, FOLLOW_STATE, followedQuad, grown, heading, outlineBounds, OWN_FRAME, resting,
} from './kit/follow';
export type { FollowProps, FollowValues, Parted, Quad, Retarget, Target } from './kit/follow';
export {
    parseSpaceCurve, parseSurface, spaceCurveError, spaceCurveParams, surfaceError, surfaceParams, EQUATION_KINDS, EQUATION_VARIABLES_3D,
} from './kit/equation3d';
export type { EquationLanguage, SpaceCurveEquation, SurfaceEquation } from './kit/equation3d';
export { aim, graphEntry, graphOf, graphSpace, spaceOf, GRAPH_3D } from './three/space';
export type { Graph3D, GraphSpace } from './three/space';
export { domainEntry, meshEntries } from './three/entries';
export { drawLabel3D } from './three/label3d';
export type { LabelStyle3D } from './three/label3d';
// A traced path is a plot whose span follows a value, so a copied one builds on these rather than a copy of them.
export { FunctionPlot, PLOT_COMMANDS, PLOT_STATE, PLOT_STROKE, tracePlot } from './plots/function-plot';
export type { FunctionPlotProps, PlotValues } from './plots/function-plot';
export { drawField, FIELD_COMMANDS, FIELD_STATE, traceField } from './kit/field-mark';
export type { FieldDrawing, FieldProps, FieldSampler, FieldStroke, FieldValues } from './kit/field-mark';
export { fieldError, fieldParams, parseField, FIELD_VARIABLES } from './kit/field';
export type { FieldEquation } from './kit/field';
export { traceContour } from './kit/contour';
export { colorAt, fillAt, lerpFillScale, lerpScale, readFillScale, readScale } from './kit/scale';
export {
    IDENTITY_MATRIX, isIdentityMatrix, lerpMatrix, lineThrough, readMatrix, transformedMap, warpedMap,
} from './kit/coords';
export type { Matrix2, Warp } from './kit/coords';
export { braceOutline } from './kit/brace';
export { GRAPH_LAYOUTS, layOut } from './structures/graph-layout';
export type { GraphEdge, GraphLayout } from './structures/graph-layout';
