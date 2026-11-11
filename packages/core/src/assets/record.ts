export type AssetType = 'image' | 'font' | 'video' | 'audio' | 'loader';

/** Frees whatever a {@link LoaderFn} loaded. Called when its window is evicted. */
export type Disposer = () => void;

/** An opaque async load owned by the declaring package (a code component's Shiki highlighter loads its own resources without core depending on it). Resolving nothing means "keep it resident": grammars and 3D runtimes are cheap to hold and expensive to refetch; resolving a {@link Disposer} opts into eviction when the frame window closes. */
export type LoaderFn = () => Promise<void | Disposer>;

/** The frame window one asset is needed over. */
interface BaseAssetRecord {
    type: AssetType;
    /** First frame at which this asset is needed. */
    startFrame: number;
    /** Last frame at which this asset is needed. */
    endFrame: number;
    src: string;
}

export interface ImageRecord extends BaseAssetRecord {
    type: 'image';
}

export interface FontRecord extends BaseAssetRecord {
    type: 'font';
    fontWeight: number;
    fontFamily: string;
}

export interface VideoRecord extends BaseAssetRecord {
    type: 'video';
    trimStart: number;  // seconds; default 0
    trimEnd: number;    // seconds; default is end of video (manifest duration)
}

export interface AudioRecord extends BaseAssetRecord {
    type: 'audio';
    trimStart: number;  // seconds; default 0
    trimEnd: number;    // seconds; default is end of audio (manifest duration)
}

/** An opaque async load tracked on the timeline like any asset but not dispatched by {@link StorageAdapter}: the {@link AssetManager} runs {@link load} when the frame window opens and calls the returned {@link Disposer} on eviction. `src` is the dedupe key (e.g. `lang:java|github-dark`). */
export interface LoaderRecord extends BaseAssetRecord {
    type: 'loader';
    load: LoaderFn;
}

export type AssetRecord = ImageRecord | FontRecord | VideoRecord | AudioRecord | LoaderRecord;