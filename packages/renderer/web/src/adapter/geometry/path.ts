import { type PathData, type PathState, toPathString, withPathDescriptor } from "@motionscript/core";
import { ShapeGeometry } from "./base";

/** An arbitrary SVG path; adapter/shapes.ts centres it and strokes the contour it fills, `Z` included. */
export class PathGeometry extends ShapeGeometry<PathState, { data: PathData }> {
    protected resolveState(state: Partial<PathState>): PathState {
        return withPathDescriptor(state);
    }

    protected computeGeometry(): { data: PathData } {
        return { data: this.fullState.data };
    }

    buildSVGPath(geo: { data: PathData }): string {
        return toPathString(geo.data);
    }
}
