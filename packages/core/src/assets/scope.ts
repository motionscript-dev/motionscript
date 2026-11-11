import type { AssetCatalog } from "./catalog";
import type { LoaderFn } from "./record";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { Node } from "@/components/trees/node/node";
import { declareFill } from "@/attributes/shape/fill/registry";
import { declareEffect } from "@/attributes/shape/effects/registry";
import { declareTree } from "@/components/trees/node/node-walk";

/** Whether an asset has to be resident before layout measures, or only before a frame draws. */
export type AssetGate = "layout" | "render";

export type AssetDecl =
    | { type: "image"; src: string }
    | { type: "video"; src: string; trimStart: number; trimEnd: number }
    | { type: "font"; family: string; weight: number }
    | { type: "loader"; key: string; load: LoaderFn; gate: AssetGate };

/** What a node's `declareAssets` states its needs into. A declaration must be a pure function of the props and context it reads (never `layoutBounds`, `time` or writes) because the runtime re-runs it only when something it read changes. Deduped by {@link assetKey}. */
export interface AssetScope {
    readonly catalog: AssetCatalog;
    image(src: string): void;
    video(src: string, trim?: { start?: number; end?: number }): void;
    /** Gates layout: text is measured against the face. */
    font(family: string, weight?: number | string): void;
    /** `gate` defaults to `"render"`; pass `"layout"` for a load measurement depends on. */
    loader(key: string, load: LoaderFn, options?: { gate?: AssetGate }): void;
    fill(fills: FillResolved | readonly FillResolved[]): void;
    effects(effects: readonly NodeEffect[]): void;
    /** A detached subtree this node draws (a `Tex.surface` node source), declared as part of this node. */
    subtree(node: Node): void;
}

/** Fonts key by family alone: `loadFont` registers every weight at once and a variable weight renders through `fontVariations`, so a weight in the key would mint an entry per frame of a weight tween. */
export function assetKey(decl: AssetDecl): string {
    switch (decl.type) {
        case "image":
        case "video":
            return decl.src;
        case "font":
            return decl.family;
        case "loader":
            return decl.key;
    }
}

/** Anything unparseable lands on 400, which is what an unspecified weight means anyway. */
export function normalizeWeight(weight: number | string | undefined): number {
    if (typeof weight === "number") return Number.isFinite(weight) ? weight : 400;
    if (typeof weight === "string") return parseInt(weight, 10) || 400;
    return 400;
}

export interface AssetDeclarationOptions {
    /** Binds a detached subtree (catalog, context, clock) before it declares. */
    bindSubtree?: (node: Node) => void;
    /** Replaces the default {@link declareTree} walk over a subtree. */
    onSubtree?: (node: Node, scope: AssetScope) => void;
}

/** The {@link AssetScope} that collects: one declaration pass, keyed and validated. Unknown images and videos throw here, against the node that declared them. */
export class AssetDeclaration implements AssetScope {
    readonly catalog: AssetCatalog;

    constructor(catalog: AssetCatalog, options: AssetDeclarationOptions = {}) {
        this.catalog = catalog;
        this._options = options;
    }

    get declarations(): ReadonlyMap<string, AssetDecl> {
        return this._decls;
    }

    // An empty `src` is an unset media slot — it paints the checkerboard, not a
    // missing asset — so it declares nothing.
    image(src: string): void {
        if (!src || this._decls.has(src)) return;
        this.catalog.getImageMeta(src);
        this._decls.set(src, { type: "image", src });
    }

    video(src: string, trim?: { start?: number; end?: number }): void {
        if (!src || this._decls.has(src)) return;
        this.catalog.getVideoMeta(src);
        this._decls.set(src, {
            type: "video",
            src,
            trimStart: trim?.start ?? 0,
            trimEnd: trim?.end ?? this.catalog.getVideoDuration(src),
        });
    }

    font(family: string, weight?: number | string): void {
        if (!family || this._decls.has(family)) return;
        this._decls.set(family, { type: "font", family, weight: normalizeWeight(weight) });
    }

    loader(key: string, load: LoaderFn, options?: { gate?: AssetGate }): void {
        const gate = options?.gate ?? "render";
        const existing = this._decls.get(key);
        if (existing === undefined) {
            this._decls.set(key, { type: "loader", key, load, gate });
            return;
        }
        if (existing.type !== "loader") return;
        if (existing.load !== load && process.env.NODE_ENV !== "production") {
            console.warn(
                `[assets] Loader "${key}" was declared with a different load function; the first is kept. ` +
                `Hoist the function so every declaration of the key hands over the same one.`,
            );
        }
        // Layout is the stricter gate, so it wins whichever declaration asked first.
        if (gate === "layout" && existing.gate !== "layout") {
            this._decls.set(key, { ...existing, gate });
        }
    }

    fill(fills: FillResolved | readonly FillResolved[]): void {
        if (!fills) return;
        if (!Array.isArray(fills)) {
            declareFill(fills as FillResolved, this);
            return;
        }
        for (const fill of fills as readonly FillResolved[]) declareFill(fill, this);
    }

    effects(effects: readonly NodeEffect[]): void {
        if (!effects) return;
        for (const effect of effects) declareEffect(effect, this);
    }

    subtree(node: Node): void {
        this._subtrees ??= new Set();
        if (this._subtrees.has(node)) return;
        this._subtrees.add(node);
        this._options.bindSubtree?.(node);
        if (this._options.onSubtree) this._options.onSubtree(node, this);
        else declareTree(node, this);
    }

    private readonly _options: AssetDeclarationOptions;
    private readonly _decls = new Map<string, AssetDecl>();
    private _subtrees: Set<Node> | undefined;
}
