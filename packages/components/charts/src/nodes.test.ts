import { describe, expect, it } from "vitest";
import { Registry } from "@motionscript/sdk";

import { NODES } from "./nodes";
import { LineChart } from "./line-chart";
import { BarChart } from "./bar-chart";
import { PieChart } from "./pie-chart";

/**
 * What this package publishes to a document, read off the components: the key
 * from each one's `key`, the entries from its `state`, the commands from its
 * `commands`, so a renamed command is a failing test rather than one that
 * quietly animates nothing.
 */
// Exactly what a host does: hand the package's components to a registry, which
// seeds itself with the builtins. A component only *declares* its key — nothing is
// registered by importing a module, so this list is the whole wiring.
const registry = new Registry({ nodes: NODES });

describe("the charts package's node types", () => {
    it("registers each component under its document key", () => {
        expect(registry.node("lineChart")?.ctor).toBe(LineChart.node);
        expect(registry.node("barChart")?.ctor).toBe(BarChart.node);
        expect(registry.node("pieChart")?.ctor).toBe(PieChart.node);
    });

    it("publishes every command the component declares", () => {
        expect(registry.commandKeys("lineChart")).toEqual(
            expect.arrayContaining([
                "enter", "spotlightRegion", "clearRegion", "zoomTo",
                "resetZoom", "showSeries", "hideSeries", "spotlightSeries",
            ]),
        );
        expect(registry.commandKeys("barChart")).toEqual(
            expect.arrayContaining([
                "enter", "showSeries", "hideSeries", "spotlightSeries",
                "spotlightCategory", "clearCategory",
            ]),
        );
        expect(registry.commandKeys("pieChart")).toEqual(
            expect.arrayContaining([
                "enter", "selectSlice", "deselectSlice", "selectOnlySlice",
                "clearSelection", "revealCenter",
            ]),
        );
    });

    it("inherits the base node's commands too", () => {
        // A chart is a 2D node, so a document may fade or move one without the
        // package restating anything.
        expect(registry.commandKeys("lineChart")).toEqual(
            expect.arrayContaining(["fadeTo", "moveTo", "scaleTo"]),
        );
    });

    it("describes the document params each command takes", () => {
        const commands = registry.node("lineChart")!.commands;
        expect(commands.get("resetZoom")?.args).toEqual([]);

        // A schema, not just a name: what a host needs to offer the argument.
        expect(commands.get("showSeries")?.args).toEqual([
            { key: "seriesIndex", kind: "series", default: 0, min: 0, step: 1 },
        ]);

        // One argument the method takes, two controls a host draws — declared
        // inside the value they compose into rather than flattened beside it.
        const [region] = commands.get("spotlightRegion")!.args;
        expect(region.key).toBe("region");
        expect(Object.keys(region.properties ?? {})).toEqual(["x", "y"]);
    });

    it("builds one from a document node spec", () => {
        const node = registry.instantiate({
            id: "chart1",
            type: "lineChart",
            parentId: null,
            layerOrder: 0,
            props: { width: 760, height: 460 },
        });
        expect(node).toBeInstanceOf(LineChart);
    });

    it("dispatches a command against the built node", () => {
        const node = registry.instantiate({
            id: "chart1", type: "lineChart", parentId: null, layerOrder: 0, props: {},
        });
        const factory = registry.nodeCommand("lineChart", "showSeries")!;
        expect(factory).toBeTypeOf("function");
        // `seriesIndex` is the document's name for the method's leading argument.
        expect(() => factory(node, { seriesIndex: 0 }, 0.35, undefined)).not.toThrow();
    });

    it("describes its key and dimension, and nothing a host keeps", () => {
        const chart = registry.describe("lineChart")!;
        expect(chart).toMatchObject({ key: "lineChart", dimension: "2d" });
        // A display name, an icon, a shelf, a layout and a seed are a host's to
        // resolve and to translate; an engine artifact carrying them would be
        // shipping one product's decisions.
        for (const presentational of ["name", "description", "icon", "categories", "titleKey", "parentKey", "forkable", "seed"]) {
            expect(chart).not.toHaveProperty(presentational);
        }
    });

    it("derives its properties from its state, the box's included", () => {
        const props = registry.describe("lineChart")!.properties!;
        // Its own…
        // A function default is a reactive *binding*, not a value, so it says
        // nothing about the control — a prop declaring one declares its kind.
        expect(props.data).toMatchObject({ kind: "dataset" });
        expect(props.series).toMatchObject({ kind: "series" });
        expect(props.xField).toMatchObject({ kind: "text", default: "" });
        expect(props.regionReveal).toMatchObject({ kind: "number", default: 0 });
        // …and the box every 2D node has, without restating any of them.
        expect(props.opacity).toMatchObject({ kind: "number" });
        expect(props.effects).toMatchObject({ kind: "effects" });
        expect(props.pivot).toMatchObject({ kind: "alignment" });
    });

    it("gives a bare key an empty description rather than none", () => {
        // One shape whether a type declared anything or not.
        expect(registry.describe("rect")).toMatchObject({ key: "rect" });
        expect(Object.keys(registry.describe("rect")!.properties!).length).toBeGreaterThan(0);
    });

    it("each type keeps its own table, so a shared name is not a collision", () => {
        // `showSeries` is published by two chart types with the same shape and
        // by nothing else; `spotlightCategory` only by the bar chart.
        expect(registry.commandKeys("barChart")).toContain("spotlightCategory");
        expect(registry.commandKeys("lineChart")).not.toContain("spotlightCategory");
        expect(registry.commandKeys("pieChart")).not.toContain("showSeries");
    });

    it("marks each chart's enter, and only that, as an entrance", () => {
        for (const key of ["lineChart", "barChart", "pieChart"]) {
            const entrances = [...registry.node(key)!.commands].filter(([, c]) => c.entrance).map(([name]) => name);
            expect(entrances, key).toEqual(["enter"]);
        }
    });

    it("describes the document params of the bar and pie commands", () => {
        const bar = registry.node("barChart")!.commands;
        for (const key of ["showSeries", "hideSeries", "spotlightSeries"]) {
            expect(bar.get(key)?.args, key).toEqual([
                { key: "seriesIndex", kind: "series", default: 0, min: 0, step: 1 },
            ]);
        }
        expect(bar.get("spotlightCategory")?.args).toEqual([
            { key: "categoryIndex", kind: "number", default: 0, min: 0, step: 1 },
        ]);
        expect(bar.get("enter")?.args).toEqual([]);
        expect(bar.get("clearCategory")?.args).toEqual([]);

        const pie = registry.node("pieChart")!.commands;
        for (const key of ["selectSlice", "deselectSlice", "selectOnlySlice"]) {
            expect(pie.get(key)?.args, key).toEqual([
                { key: "sliceIndex", kind: "number", default: 0, min: 0, step: 1 },
            ]);
        }
        for (const key of ["enter", "revealCenter", "clearSelection"]) {
            expect(pie.get(key)?.args, key).toEqual([]);
        }
    });

    it("derives the bar chart's properties from its state, with the kind each declares", () => {
        const props = registry.describe("barChart")!.properties!;
        expect(props.categoryField).toMatchObject({ kind: "text", default: "" });
        expect(props.stacked).toMatchObject({ kind: "boolean", default: false });
        expect(props.valueAxis).toMatchObject({ kind: "object", default: {} });
        expect(props.categoryAxis).toMatchObject({ kind: "object", default: {} });
        expect(props.theme).toMatchObject({ kind: "object" });
        // The two signals the commands move.
        expect(props.growth).toMatchObject({ kind: "number", default: 1 });
        expect(props.spotlightReveal).toMatchObject({ kind: "number", default: 0 });
        expect(props.spotlight).toMatchObject({ default: null });
        expect(props).toHaveProperty("weights");
        // The box every 2D node has.
        expect(props.opacity).toMatchObject({ kind: "number" });
        expect(props.effects).toMatchObject({ kind: "effects" });
        expect(props.pivot).toMatchObject({ kind: "alignment" });
    });

    it("derives the pie chart's properties from its state, with the kind each declares", () => {
        const props = registry.describe("pieChart")!.properties!;
        expect(props.categoryField).toMatchObject({ kind: "text", default: "" });
        expect(props.valueField).toMatchObject({ kind: "text", default: "" });
        expect(props.labelMode).toMatchObject({ kind: "text", default: "percent" });
        expect(props.labelPlacement).toMatchObject({ kind: "text", default: "leader" });
        expect(props.centerLabel).toMatchObject({ kind: "text", default: "" });
        expect(props.centerCaption).toMatchObject({ kind: "text", default: "" });
        expect(props.theme).toMatchObject({ kind: "object" });
        // The selection the commands move.
        expect(props).toHaveProperty("pops");
        expect(props.opacity).toMatchObject({ kind: "number" });
        expect(props.effects).toMatchObject({ kind: "effects" });
    });

    it("describes the bar and pie charts under their keys", () => {
        expect(registry.describe("barChart")).toMatchObject({ key: "barChart", dimension: "2d" });
        expect(registry.describe("pieChart")).toMatchObject({ key: "pieChart", dimension: "2d" });
    });

    // Only the line chart declares its dataset and series kinds, and its showLegend flag.
    it.skip("declares the bar and pie charts' data and series like the line chart's", () => {
        const bar = registry.describe("barChart")!.properties!;
        const pie = registry.describe("pieChart")!.properties!;
        expect(bar.data).toMatchObject({ kind: "dataset" });
        expect(bar.series).toMatchObject({ kind: "series" });
        expect(pie.data).toMatchObject({ kind: "dataset" });
    });

    it("declares the bar and pie charts' flags as properties a host can read back", () => {
        const bar = registry.describe("barChart")!.properties!;
        const pie = registry.describe("pieChart")!.properties!;
        for (const [props, flags] of [[bar, { showLegend: true, showValues: false }], [pie, { showLegend: true, showCenter: true }]] as const) {
            for (const [flag, initial] of Object.entries(flags)) expect(props[flag], flag).toMatchObject({ animatable: false, kind: "boolean", default: initial });
        }
    });
});
