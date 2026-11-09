import { describe, expect, it } from "vitest";
import type { Node2D } from "@/components/trees/2d/node2d";
import { component2d } from "@/components/factory/component2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Box3D } from "@/components/builtins/three/three";

type Ctor = new (props?: Record<string, unknown>) => Node2D;
const build = (component: unknown, props: Record<string, unknown> = {}) => new (component as Ctor)(props);

const Playlist = component2d({ key: "rulesPlaylist" });
const Episode = component2d({ key: "rulesEpisode", allowedChildren: [], allowedParents: [Playlist] });
const Shelf = component2d({ key: "rulesShelf", allowedChildren: [Episode, Rect] });
const Stage = component2d({ key: "rulesStage", allowedChildren: ["2d"] });
const Gauge = component2d({ key: "rulesGauge", allowedChildren: [], children: () => [new Rect({}), new Rect({})] as never });

describe("allowedChildren", () => {
    it("takes the components it lists, and says which when it refuses another", () => {
        expect(() => build(Shelf, { children: [build(Rect)] })).not.toThrow();
        expect(() => build(Shelf, { children: [build(Stage)] })).toThrow("RulesShelf (2d) cannot hold RulesStage (2d). It takes only RulesEpisode or Rect.");
    });

    it("takes none for an empty list", () => {
        expect(() => build(Episode).add(build(Rect))).toThrow("It takes no children.");
    });

    it("lets a component build its own parts while taking none from anyone else", () => {
        expect(build(Gauge).children).toHaveLength(2);
        expect(() => build(Gauge).add(build(Rect))).toThrow("It takes no children.");
        expect(() => build(Gauge, { children: [build(Rect)] })).toThrow("It takes no children.");
    });

    it("tells a node of another tree where it goes instead", () => {
        expect(() => build(Stage).add(build(Box3D) as never)).toThrow(/cannot hold Box3d \(3d\)\. Put 3D nodes inside a Canvas3D/);
    });
});

describe("allowedParents", () => {
    it("lets a node go inside the components it names", () => {
        expect(() => build(Playlist, { children: [build(Episode)] })).not.toThrow();
    });

    it("refuses any other parent, naming where it goes", () => {
        expect(() => build(Rect, { children: [build(Episode)] })).toThrow("RulesEpisode goes only inside RulesPlaylist, not Rect.");
    });
});
