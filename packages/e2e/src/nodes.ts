import { PivotEllipse, PivotPolygon, PivotPolygram, PivotRect, PivotText } from '@/components/cardinal-pivots';
import { PinnedEllipse, PinnedRect } from '@/components/pinned';
import { PanelPlane3D, SpinBoxEllipse, SpinBoxStrokeRect } from '@/components/view3d';
import { LutRect } from '@/components/lut-rect';
import { ThemedRect } from '@/components/themed-rect';
// The kits' own nodes, not local re-implementations: nothing here needs to
// differ from what the packages ship.
import { Code } from '@motionscript/code';
import { BarChart, LineChart, PieChart, RadarChart, RadialChart } from '@motionscript/charts';
import { DotGridPattern, GridPattern, LineGridPattern } from '@motionscript/patterns';
import {
    AngleMark, Axes2d, Axes3d, CurlyBrace, CurveArea, CurvePlot3d, DropLines, EmphasisMark, FunctionPlot, Latex, NumberLine,
    NumberPlane, PlotPoint, PlotPoint3d, PointsPlot, PolarPlane, RiemannSum, StreamLines, SurfacePlot3d, TangentLine, TracedPath, VectorArrow,
    VectorArrow3d, VectorField, NetworkGraph, SampleSpace,
} from '@motionscript/math';
import { Path } from '@motionscript/sdk';
import { GaugeV2, RadialMenuV2, RectV2 } from '@/components/component-syntax';

/**
 * Node types the scenes name beyond core's own, by document key. Handed to the
 * page's engine (`src/project.ts`) and to the builder that turns a scene's `el`
 * calls into rows (`src/doc`), so the two cannot disagree about a key.
 */
export const NODES: Record<string, unknown> = {
    code: Code,
    lineChart: LineChart,
    barChart: BarChart,
    pieChart: PieChart,
    radarChart: RadarChart,
    radialChart: RadialChart,
    latex: Latex,
    pivotRect: PivotRect,
    pivotEllipse: PivotEllipse,
    pivotPolygon: PivotPolygon,
    pivotPolygram: PivotPolygram,
    pivotText: PivotText,
    pinnedRect: PinnedRect,
    pinnedEllipse: PinnedEllipse,
    panelPlane3d: PanelPlane3D,
    spinBoxEllipse: SpinBoxEllipse,
    spinBoxStrokeRect: SpinBoxStrokeRect,
    lutRect: LutRect,
    themedRect: ThemedRect,
    'lineGridPattern': LineGridPattern,
    'dotGridPattern': DotGridPattern,
    'gridPattern': GridPattern,
    numberLine: NumberLine,
    axes2d: Axes2d,
    numberPlane: NumberPlane,
    functionPlot: FunctionPlot,
    pointsPlot: PointsPlot,
    plotPoint: PlotPoint,
    vectorArrow: VectorArrow,
    curveArea: CurveArea,
    riemannSum: RiemannSum,
    tangentLine: TangentLine,
    dropLines: DropLines,
    curlyBrace: CurlyBrace,
    angleMark: AngleMark,
    emphasisMark: EmphasisMark,
    axes3d: Axes3d,
    surfacePlot3d: SurfacePlot3d,
    curvePlot3d: CurvePlot3d,
    plotPoint3d: PlotPoint3d,
    vectorArrow3d: VectorArrow3d,
    polarPlane: PolarPlane,
    vectorField: VectorField,
    streamLines: StreamLines,
    tracedPath: TracedPath,
    networkGraph: NetworkGraph,
    sampleSpace: SampleSpace,
    // Core's `path` key builds the unit-box `PathShape`; the path and morph
    // scenes author pixel-space data for the face-value `Path`, which no core
    // key reaches. An e2e-only key keeps their geometry as written.
    facePath: Path,
    // The component syntax's first runtime slice: generated node classes, beside
    // the class-based ones they mirror.
    rectV2: RectV2,
    gaugeV2: GaugeV2,
    radialMenuV2: RadialMenuV2,
};
