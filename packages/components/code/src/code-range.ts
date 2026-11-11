/** Lines and columns are 1-indexed; `endLine`/`endCol` may be `Infinity` for the end of the line or document. */
export interface CodeRange {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

/** `length` characters from (line, col); to the end of the line when omitted. */
export function word(line: number, col: number, length?: number): CodeRange {
    return {
        startLine: line,
        startCol: col,
        endLine: line,
        endCol: length === undefined ? Infinity : col + length,
    };
}

/** Whole lines `from` to `to` inclusive; just `from` when `to` is omitted. */
export function lines(from: number, to?: number): CodeRange {
    return {
        startLine: from,
        startCol: 1,
        endLine: to ?? from,
        endCol: Infinity,
    };
}

/** Immutable chain of ranges: each method returns a new chain, as in `CodeRanges.lines(2).word(5, 1, 3)`. */
export class CodeRangeChain {
    constructor(public readonly list: CodeRange[] = []) { }

    lines(from: number, to?: number): CodeRangeChain {
        return new CodeRangeChain([...this.list, lines(from, to)]);
    }

    word(line: number, col: number, length?: number): CodeRangeChain {
        return new CodeRangeChain([...this.list, word(line, col, length)]);
    }

    *[Symbol.iterator](): Iterator<CodeRange> {
        yield* this.list;
    }

    /**
     * A chain is stored as its ranges. Without this it serialises as
     * `{ "list": [...] }`, which has no iterator once read back and so selects
     * nothing; a plain array of ranges reads back as the selection it was.
     */
    toJSON(): CodeRange[] {
        return this.list;
    }
}

/** An empty {@link CodeRangeChain}, the start of a multi-range selection. */
export const CodeRanges = new CodeRangeChain();

/** Absolute [start, end) offsets in the joined source, clamped into the document. */
export function rangeToCharOffsets(
    r: CodeRange,
    lineLengths: number[],
): { start: number; end: number } {
    if (lineLengths.length === 0) return { start: 0, end: 0 };

    const lineStart: number[] = new Array(lineLengths.length);
    let acc = 0;
    for (let i = 0; i < lineLengths.length; i++) {
        lineStart[i] = acc;
        acc += lineLengths[i] + 1; // +1 for the joining newline
    }
    const docEnd = acc > 0 ? acc - 1 : 0;

    const clampLine = (n: number) =>
        Math.max(0, Math.min(lineLengths.length - 1, n - 1)); // to 0-indexed

    // A range read back from JSON holds `Infinity` as `null`; both mean "to the end".
    const endLine = r.endLine ?? Infinity;
    const endCol = r.endCol ?? Infinity;

    const sLine = clampLine(r.startLine);
    const eLine = clampLine(endLine);
    const sColMax = lineLengths[sLine];
    const eColMax = lineLengths[eLine];

    // endCol may sit one past the last character.
    const sCol = Math.max(0, Math.min(sColMax, r.startCol - 1));
    const eCol = endCol === Infinity
        ? eColMax
        : Math.max(0, Math.min(eColMax, endCol - 1));

    const start = Math.min(docEnd, lineStart[sLine] + sCol);
    const end = Math.min(docEnd, lineStart[eLine] + eCol);
    return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** The 1-indexed range for [start, end) offsets in the joined source. */
export function charOffsetsToRange(
    start: number,
    end: number,
    lineLengths: number[],
): CodeRange {
    let off = 0;
    let startLine = 1, startCol = 1, endLine = 1, endCol = 1;
    let foundStart = false;
    for (let li = 0; li < lineLengths.length; li++) {
        const lineStart = off;
        const lineEnd = off + lineLengths[li];
        if (!foundStart && start >= lineStart && start <= lineEnd) {
            startLine = li + 1;
            startCol = (start - lineStart) + 1;
            foundStart = true;
        }
        if (end >= lineStart && end <= lineEnd) {
            endLine = li + 1;
            endCol = (end - lineStart) + 1;
            break;
        }
        off = lineEnd + 1;
    }
    return { startLine, startCol, endLine, endCol };
}
