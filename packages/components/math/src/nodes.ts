import { AngleMark } from "./annotate/angle-mark";
import { CurlyBrace } from "./annotate/curly-brace";
import { EmphasisMark } from "./annotate/emphasis-mark";
import { CurveArea } from "./marks/curve-area";
import { DropLines } from "./marks/drop-lines";
import { PlotPoint } from "./marks/plot-point";
import { RiemannSum } from "./marks/riemann-sum";
import { TangentLine } from "./marks/tangent-line";
import { VectorArrow } from "./marks/vector-arrow";
import { FunctionPlot } from "./plots/function-plot";
import { PointsPlot } from "./plots/points-plot";
import { StreamLines } from "./plots/stream-lines";
import { TracedPath } from "./plots/traced-path";
import { VectorField } from "./plots/vector-field";
import { Axes2d } from "./systems/axes2d";
import { NumberLine } from "./systems/number-line";
import { NumberPlane } from "./systems/number-plane";
import { PolarPlane } from "./systems/polar-plane";
import { NetworkGraph } from "./structures/network-graph";
import { SampleSpace } from "./structures/sample-space";
import { LatexMatrix } from "./tex/matrix";
import { Latex } from "./tex/node";
import { Axes3d } from "./three/axes3d";
import { CurvePlot3d } from "./three/curve-plot3d";
import { PlotPoint3d } from "./three/plot-point3d";
import { SurfacePlot3d } from "./three/surface-plot3d";
import { VectorArrow3d } from "./three/vector-arrow3d";

/**
 * Every node type this package publishes.
 *
 * A host registers these by handing the array to an engine —
 * `new Engine(platform, { nodes: NODES })` — which reads each component's key.
 * Defining a component only *declares* that key: nothing is registered by
 * importing a module, so a registry holds exactly what its owner asked for.
 *
 * Listing the component **values** is also what survives bundling: this package
 * declares `sideEffects: false`, and a document names a node type by string, so
 * an import kept only for its side effect is exactly what gets shaken out.
 */
// Typed by name, so the declaration names each component rather than spelling out its type through core.
type KitNode =
    | typeof Latex
    | typeof LatexMatrix
    | typeof NumberLine
    | typeof Axes2d
    | typeof NumberPlane
    | typeof FunctionPlot
    | typeof PointsPlot
    | typeof PlotPoint
    | typeof VectorArrow
    | typeof CurveArea
    | typeof RiemannSum
    | typeof TangentLine
    | typeof DropLines
    | typeof CurlyBrace
    | typeof AngleMark
    | typeof EmphasisMark
    | typeof Axes3d
    | typeof SurfacePlot3d
    | typeof CurvePlot3d
    | typeof PlotPoint3d
    | typeof VectorArrow3d
    | typeof PolarPlane
    | typeof VectorField
    | typeof StreamLines
    | typeof TracedPath
    | typeof NetworkGraph
    | typeof SampleSpace;

export const NODES: KitNode[] = [
    Latex,
    LatexMatrix,
    NumberLine,
    Axes2d,
    NumberPlane,
    FunctionPlot,
    PointsPlot,
    PlotPoint,
    VectorArrow,
    CurveArea,
    RiemannSum,
    TangentLine,
    DropLines,
    CurlyBrace,
    AngleMark,
    EmphasisMark,
    Axes3d,
    SurfacePlot3d,
    CurvePlot3d,
    PlotPoint3d,
    VectorArrow3d,
    PolarPlane,
    VectorField,
    StreamLines,
    TracedPath,
    NetworkGraph,
    SampleSpace,
];
