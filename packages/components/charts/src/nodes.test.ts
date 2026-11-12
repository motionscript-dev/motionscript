import { describe, expect, it } from "vitest";
import { Registry } from "@motionscript/sdk";

import { NODES } from "./nodes";
import { LineChart } from "./line-chart";
import { BarChart } from "./bar-chart";
import { PieChart } from "./pie-chart";
import { RadarChart } from "./radar-chart";
import { RadialChart } from "./radial-chart";
import { CHART_STYLE_PRESETS } from "./kit/style";
import { draw } from "./tests/harness";

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
        expect(registry.node("radarChart")?.ctor).toBe(RadarChart.node);
        expect(registry.node("radialChart")?.ctor).toBe(RadialChart.node);
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
        expect(props.orientation).toMatchObject({ kind: "enum", default: "vertical" });
        expect(props.stack).toMatchObject({ kind: "enum", default: "none" });
        expect(props.valueAxis).toMatchObject({ kind: "object", default: {} });
        expect(props.categoryAxis).toMatchObject({ kind: "object", default: {} });
        expect(props.style).toMatchObject({ kind: "style", family: "chart" });
        // The two signals the commands move.
        expect(props.growth).toMatchObject({ kind: "number", default: 1 });
        expect(props.spotlightReveal).toMatchObject({ kind: "number", default: 0 });
        expect(props.spotlight).toMatchObject({ default: null });
        // The weights the commands move are the chart's own, not an entry.
        expect(props).not.toHaveProperty("weights");
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
        expect(props.style).toMatchObject({ kind: "style", family: "chart" });
        expect(props.centerLabel).toMatchObject({ kind: "text", default: "" });
        expect(props.centerCaption).toMatchObject({ kind: "text", default: "" });
        // The selection the commands move.
        expect(props).toHaveProperty("pops");
        expect(props.opacity).toMatchObject({ kind: "number" });
        expect(props.effects).toMatchObject({ kind: "effects" });
    });

    it("describes the bar and pie charts under their keys", () => {
        expect(registry.describe("barChart")).toMatchObject({ key: "barChart", dimension: "2d" });
        expect(registry.describe("pieChart")).toMatchObject({ key: "pieChart", dimension: "2d" });
    });

    it("declares the bar and pie charts' data and series like the line chart's", () => {
        const bar = registry.describe("barChart")!.properties!;
        const pie = registry.describe("pieChart")!.properties!;
        expect(bar.data).toMatchObject({ kind: "dataset" });
        expect(bar.series).toMatchObject({ kind: "series" });
        expect(pie.data).toMatchObject({ kind: "dataset" });
        for (const key of ["radarChart", "radialChart"]) expect(registry.describe(key)!.properties!.data, key).toMatchObject({ kind: "dataset" });
    });

    it("declares the pie chart's centre flag as a property a host can read back", () => {
        const pie = registry.describe("pieChart")!.properties!;
        expect(pie.showCenter).toMatchObject({ animatable: false, kind: "boolean", default: true });
        expect(registry.describe("radialChart")!.properties!.showCenter).toMatchObject({ animatable: false, kind: "boolean", default: true });
    });
});

const CHART_KEYS = ["lineChart", "barChart", "pieChart", "radarChart", "radialChart"] as const;

const SAMPLE = {
    data: [
        { month: "Jan", revenue: 10, cost: 4 },
        { month: "Feb", revenue: 14, cost: 6 },
        { month: "Mar", revenue: 12, cost: 9 },
    ],
    xField: "month",
    categoryField: "month",
    valueField: "revenue",
    series: [
        { field: "revenue", label: "Revenue" },
        { field: "cost", label: "Cost" },
    ],
};

/** A chart built the way a host builds a new one: every default `describe` reports, written as a prop. */
function described(key: string): Record<string, unknown> {
    const properties = registry.describe(key)!.properties!;
    return Object.fromEntries(
        Object.entries(properties).filter(([, p]) => p.default !== undefined).map(([name, p]) => [name, p.default]),
    );
}

function build(key: string, props: Record<string, unknown>) {
    return registry.instantiate({ id: "chart", type: key, parentId: null, layerOrder: 0, props: { width: 760, height: 460, ...props } }) as never;
}

describe("every chart, as a host offers it", () => {
    it("lists exactly the five charts", () => {
        expect(NODES.length).toBe(CHART_KEYS.length);
        for (const key of CHART_KEYS) expect(registry.describe(key)).toMatchObject({ key, dimension: "2d" });
    });

    it.each(CHART_KEYS)("%s describes one style entry of the chart family, with presets and grouped fields", (key) => {
        const style = registry.describe(key)!.properties!.style as unknown as {
            kind: string; family: string; presets: Record<string, unknown>;
            properties: Record<string, { kind: string; group: string; default: unknown }>;
        };
        expect(style).toMatchObject({ kind: "style", family: "chart" });
        expect(Object.keys(style.presets)).toEqual(Object.keys(CHART_STYLE_PRESETS));
        const fields = Object.entries(style.properties);
        expect(fields.length).toBeGreaterThan(8);
        for (const [name, field] of fields) {
            expect(field.group, name).toEqual(expect.any(String));
            expect(field.default, name).not.toBeUndefined();
        }
        for (const field of ["seriesFills", "background", "legendText", "legend"]) expect(style.properties[field], field).toBeDefined();
        expect(style.properties.seriesFills).toMatchObject({ kind: "palette", group: "series" });
        expect(style.properties.legendText).toMatchObject({ kind: "typography", group: "text", default: { fontSize: 28 } });
        expect(style.properties.background).toMatchObject({ kind: "fills", group: "background" });
        expect(new Set(fields.map(([, field]) => field.group)).size).toBeGreaterThanOrEqual(4);
        // The look is the style's alone: nothing beside it is a theme or a legend flag.
        const props = registry.describe(key)!.properties!;
        for (const gone of ["theme", "showLegend", "showValues", "stacked"]) expect(props, gone).not.toHaveProperty(gone);
    });

    it.each(CHART_KEYS)("%s builds from nothing and from every default it describes", (key) => {
        const box = { width: 760, height: 460 };
        expect(() => draw(build(key, {}), box)).not.toThrow();
        expect(() => draw(build(key, described(key)), box)).not.toThrow();
    });

    it.each(CHART_KEYS)("%s draws the same bare as from its described defaults, given the same data", (key) => {
        const box = { width: 760, height: 460 };
        const bare = draw(build(key, SAMPLE), box);
        const hosted = draw(build(key, { ...described(key), ...SAMPLE }), box);
        expect(JSON.stringify(hosted.ops())).toBe(JSON.stringify(bare.ops()));
    });
});
