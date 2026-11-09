/** @internal */ export type { AssetCatalog } from "./catalog";
/** @internal */ export { ManifestAssetCatalog } from "./catalog";
/** @internal */ export type { ImageMeta, VideoMeta, AudioMeta, FontMeta, AssetMeta, AssetManifest } from "./manifest";
export type { AssetScope, AssetDecl, AssetGate } from "./scope";
/** @internal */ export { AssetDeclaration } from "./scope";
// `AssetRecord` joins these because `StorageAdapter.loadAsset` takes one on an
// exported abstract class — a subclass outside this package could not otherwise
// name the parameter type it is obliged to accept.
/** @internal */ export type { LoaderFn, Disposer, AssetRecord } from "./record";
/** @internal */ export { AssetNotLoadedError } from "./errors";
/** @internal */ export { AssetManager } from "./manager";