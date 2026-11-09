/** Frames `[start, end)` of the timeline, rendered as one complete segment file. */
export interface ExportChunk {
    index: number;
    start: number;
    end: number;
}

export interface ChunkPlanOptions {
    fps: number;
    /** Seconds between key frames; every chunk but the last is a whole number of them. */
    keyFrameInterval: number;
    /** The most lanes that may render at once. */
    lanes: number;
    /** Overrides the chunk length the plan would pick, in seconds. */
    chunkSeconds?: number;
}

const MIN_CHUNK_SECONDS = 2;
const MAX_CHUNK_SECONDS = 6;
/** Chunks per lane: enough that lanes finish close together, few enough that a chunk's setup stays small. */
const CHUNKS_PER_LANE = 4;

/**
 * Cut the timeline into chunks in timeline order.
 *
 * A chunk starts on a key-frame boundary of the whole timeline, so the joined
 * file keeps the key-frame rhythm a single export would have.
 */
export function planChunks(totalFrames: number, options: ChunkPlanOptions): ExportChunk[] {
    if (!Number.isInteger(totalFrames) || totalFrames <= 0) return [];
    const unit = Math.max(1, Math.round(options.fps * (options.keyFrameInterval > 0 ? options.keyFrameInterval : 1)));
    const seconds = options.chunkSeconds
        ?? Math.min(MAX_CHUNK_SECONDS, Math.max(MIN_CHUNK_SECONDS, totalFrames / options.fps / (Math.max(1, options.lanes) * CHUNKS_PER_LANE)));
    const size = Math.max(unit, Math.round((seconds * options.fps) / unit) * unit);

    const chunks: ExportChunk[] = [];
    for (let start = 0; start < totalFrames; start += size) {
        chunks.push({ index: chunks.length, start, end: Math.min(totalFrames, start + size) });
    }
    // A sliver of a last chunk costs a whole chunk's setup; fold it into the one before.
    const last = chunks[chunks.length - 1];
    if (chunks.length > 1 && last.end - last.start < unit) {
        chunks.pop();
        chunks[chunks.length - 1].end = last.end;
    }
    return chunks;
}
