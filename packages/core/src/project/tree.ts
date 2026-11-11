/** Structural key for a node within its scene: the child-index path from the scene root joined with "." (root is ""). Not every node has an authored id (children a composite builds get a UUID), so lifespan tracking keys on this; the build is deterministic, so a slot has the same path in precomp and playback. */
/** @internal */
export function nodePath(parentPath: string, childIndex: number): string {
    return parentPath === "" ? String(childIndex) : `${parentPath}.${childIndex}`;
}

/** @internal */
export interface NodeState {
    id: string;
    type: string;
    properties: Record<string, any>;


}

/** A single audio clip a node exposes for timeline display, in clip seconds; `src` is the fetchable source. */
/** @internal */
export interface WaveformInfo {
    src: string;
    /** Clip timestamp (seconds) when the clip starts. */
    startTime: number;
    /** Clip timestamp (seconds) when the clip ends, or null if open-ended. */
    endTime: number | null;
}

export interface TreeState {
    /** The node's `NodeSpec.id` for a document row, else a per-instance UUID (changes on rebuild for a composite-built node; {@link path} is stable for both). */
    id: string;
    /** Structural path from the scene root (`""` root, `"0.2"` third child of the first), stable across rebuilds for every node so a host can key selection and overrides on it; what `getNodeBox` / `setNodeOverride` accept. */
    path: string;
    type: string;
    meta?: Record<string, unknown>;
    /** Audio clips owned by this node, for waveform rendering in the timeline. */
    waveform?: WaveformInfo[];
    /** Absolute timeline frame at which this node first appears; undefined when unknown (no precomp data). */
    startFrame?: number;
    /** Absolute timeline frame at which this node was last present; with startFrame bounds the track bar to its true lifespan. */
    endFrame?: number;
    children: TreeState[];
}