import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import type { ProjectDocument } from "@/document/project";
import { Registry } from "@/document/registry";
import type { CompositionDocument } from "@/document/types";
import { component3d } from "@/components/factory/component3d";
import { Types } from "@/components/factory/types";
import { Geo, Mat } from "@/render3d/builders";
import { Graphics3D } from "@/render3d/graphics3d";
import { ClipStore } from "@/runtime/clip-store";
import { comp, node, project, runtimeScope, track } from "@/runtime/document.fixtures";
import type { TrackAssets } from "@/runtime/asset-timeline";

/**
 * A sweep after an edit takes back what an owner declared on a frame of an earlier sweep when everything that
 * declaration read holds what it held: a 3D component declares by running its whole `render`, and a component
 * whose own command animates what that render reads was declared again on every frame of the command after
 * any edit to it, a move included.
 */

/** One entry per declaration the mesh ran. */
const declared: number[] = [];

/** Draws its picture only once half built, so its window starts part-way through `build`. */
const Tiles = component3d({
    key: "memoTiles",
    state: {
        built: Types.number(0),
        src: Types.text("a.png", { animatable: false }),
    },
    commands: {
        build: { args: {}, run: (timeline) => timeline.animate((t) => ({ built: t }), { eased: false }) },
    },
    render: (ctx, s) => {
        if (ctx.declaring) declared.push(s.built);
        if (s.built < 0.5) return;
        const g = new Graphics3D();
        g.mesh(Geo.box(), Mat.basic({ map: s.src }));
        ctx.draw(g);
    },
});

const catalog = () => new ManifestAssetCatalog({
    image: Object.fromEntries(["a.png", "b.png"].map((src) => [src, { src, width: 8, height: 8, sizeBytes: 0 }])),
    video: {},
    audio: {},
    font: {},
});

const scope = () => runtimeScope({ registry: new Registry({ nodes: [Tiles as never] }), assets: catalog() });

/** A viewport holding the mesh, built over the first two seconds (20 frames at the fixtures' 10 fps). */
function scene(props: Record<string, unknown> = {}, buildFor = 2): CompositionDocument {
    return comp(
        [node("view", "canvas3d", { width: 100, height: 50 }), node("tiles", "memoTiles", props, "view")],
        [{ target: "tiles", type: "build", args: {}, duration: buildFor }],
        3,
    );
}

function windowsOf(found: TrackAssets): Record<string, [number, number]> {
    return Object.fromEntries([...found.assetRecords].map(([key, r]) => [key, [r.startFrame, r.endFrame]]));
}

/** Take `next` into `store` and require exactly what a fresh build of it finds; returns the declarations run. */
function edit(store: ClipStore, next: ProjectDocument): number {
    declared.length = 0;
    store.setProject(next);
    for (const t of next.tracks) store.discover(t.id);
    const ran = declared.length;
    const fresh = new ClipStore(next, scope());
    for (const t of next.tracks) {
        fresh.discover(t.id);
        expect(windowsOf(store.trackAssets(t.id)!)).toEqual(windowsOf(fresh.trackAssets(t.id)!));
    }
    fresh.dispose();
    return ran;
}

function discovered(doc: ProjectDocument): ClipStore {
    const store = new ClipStore(doc, scope());
    for (const t of doc.tracks) store.discover(t.id);
    return store;
}

describe("DeclarationMemo", () => {
    it("declares the mesh on every frame of its build the first time", () => {
        declared.length = 0;
        const store = discovered(project([track("a", scene())]));
        expect(declared.length).toBeGreaterThan(20);
        expect(windowsOf(store.trackAssets("a")!)["a.png"]).toEqual([10, 29]);
        store.dispose();
    });

    it("runs no declaration again when the mesh only moves, or its viewport does", () => {
        const store = discovered(project([track("a", scene())]));
        for (const x of [1, 2, 3]) expect(edit(store, project([track("a", scene({ x }))]))).toBe(0);
        const moved = scene({ x: 3 });
        const viewport = { ...moved, nodes: moved.nodes.map((n) => (n.id === "view" ? { ...n, props: { ...n.props, x: 40 } } : n)) };
        expect(edit(store, project([track("a", viewport)]))).toBe(0);
        store.dispose();
    });

    it("runs it again where what it reads changed", () => {
        const store = discovered(project([track("a", scene())]));
        // A new picture: every frame's declaration read `src`.
        expect(edit(store, project([track("a", scene({ src: "b.png" }))]))).toBeGreaterThan(20);
        // A slower build: `built` holds other values on the frames the command covers.
        expect(edit(store, project([track("a", scene({ src: "b.png" }, 2.5))]))).toBeGreaterThan(0);
        store.dispose();
    });

    it("starts again when the catalog does", () => {
        const store = discovered(project([track("a", scene())]));
        declared.length = 0;
        store.reset();
        store.discover("a");
        expect(declared.length).toBeGreaterThan(20);
        store.dispose();
    });
});
