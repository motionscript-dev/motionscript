/** @internal */ export type { AssetCatalog } from "./catalog";
/** @internal */ export { ManifestAssetCatalog } from "./catalog";
/** @internal */ export type { ImageMeta, VideoMeta, AudioMeta, FontMeta, AssetMeta, AssetManifest } from "./manifest";
export type { AssetScope, AssetDecl, AssetGate } from "./scope";
/** @internal */ export { AssetDeclaration } from "./scope";
// `AssetRecord` is exported because `StorageAdapter.loadAsset` takes one: a subclass outside this package must be able to name the parameter type.
/** @internal */ export type { LoaderFn, Disposer, AssetRecord } from "./record";
/** @internal */ export { AssetNotLoadedError } from "./errors";
/** @internal */ export { AssetManager } from "./manager";