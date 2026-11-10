// Where a shape's outline is written: SVG's absolute M, L, A (unrotated) and Z,
// either as the path string or straight into PathData.

import { type PathData, PathBuilder } from "../../doc";
import { arcTo, parseSvgPath } from "../svg-path";

export interface PathSink {
    move(x: number, y: number): void;
    line(x: number, y: number): void;
    arc(rx: number, ry: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): void;
    close(): void;
}

export class SvgSink implements PathSink {
    private readonly parts: string[] = [];

    move(x: number, y: number): void {
        this.parts.push(`M ${x} ${y}`);
    }

    line(x: number, y: number): void {
        this.parts.push(`L ${x} ${y}`);
    }

    arc(rx: number, ry: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): void {
        this.parts.push(`A ${rx} ${ry} 0 ${large} ${sweep} ${x} ${y}`);
    }

    close(): void {
        this.parts.push("Z");
    }

    toString(): string {
        return this.parts.join(" ");
    }
}

/**
 * The outline as `parseSvgPath` reads it from {@link SvgSink}'s string, without
 * the string. A finite number prints and parses back to itself, and the parser
 * adds an absolute coordinate to 0 (so −0 lands as 0); a number that is not
 * finite does not survive the tokenizer, so `ok` turns false and the caller
 * takes the string route.
 */
class PathDataSink implements PathSink {
    ok = true;
    private readonly b = new PathBuilder();
    private empty = true;
    private x = 0;
    private y = 0;
    private sx = 0;
    private sy = 0;

    move(x: number, y: number): void {
        this.check(x, y);
        this.x = this.sx = 0 + x;
        this.y = this.sy = 0 + y;
        this.b.moveTo(this.x, this.y);
    }

    line(x: number, y: number): void {
        this.check(x, y);
        this.x = 0 + x;
        this.y = 0 + y;
        this.b.lineTo(this.x, this.y);
    }

    arc(rx: number, ry: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): void {
        this.check(rx, ry, x, y);
        const nx = 0 + x, ny = 0 + y;
        arcTo(this.b, this.x, this.y, rx + 0, ry + 0, 0, large !== 0, sweep !== 0, nx, ny);
        this.x = nx;
        this.y = ny;
    }

    close(): void {
        this.empty = false;
        this.b.close();
        this.x = this.sx;
        this.y = this.sy;
    }

    result(): PathData | null {
        return this.empty ? null : this.b.build();
    }

    private check(...values: number[]): void {
        this.empty = false;
        for (const v of values) if (!Number.isFinite(v)) this.ok = false;
    }
}

export function svgOf(emit: (sink: PathSink) => void): string {
    const sink = new SvgSink();
    emit(sink);
    return sink.toString();
}

/** What `parseSvgPath(svgOf(emit))` gives (null for an empty string), built directly. */
export function pathDataOf(emit: (sink: PathSink) => void): PathData | null {
    const sink = new PathDataSink();
    emit(sink);
    if (sink.ok) return sink.result();
    const svg = svgOf(emit);
    return svg ? parseSvgPath(svg) : null;
}
