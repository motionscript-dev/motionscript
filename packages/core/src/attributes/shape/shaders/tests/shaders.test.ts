import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Effects } from "@/attributes/shape/effects/chain";
import { Fills } from "@/attributes/shape/fill/chain";
import { resolveFill } from "@/attributes/shape/fill/registry";

import {
    normalizeShaderPack, isKnownShaderProperty, MAX_SHADER_PROPERTIES, MAX_SHADER_SOURCE, type Shader,
} from "../pack";
import { resolveShaderProperties } from "../resolve";
import { isWgslShader, shaderContractOf, WGSL_CONTRACT } from "../language";
import { Registry } from "@/document/registry";

const SWIRL = {
    $kind: "motionscript/shader@1",
    id: "user/swirl",
    scope: "fill",
    name: "Swirl",
    source: "struct Params { u_twist: f32, u_ink: vec4f }\nfn fill(in: FillIn) -> vec4f { return u.u_ink; }",
    properties: {
        twist: { kind: "number", inputs: { value: "u_twist" }, default: 2.5, min: -12, max: 12 },
        ink: { kind: "color", inputs: { value: "u_ink" }, default: [0.15, 0.55, 1, 1] },
    },
};

const SMEAR = {
    scope: "effect",
    name: "Smear",
    backdrop: true,
    source: "struct Params { u_samples: f32 }\nfn effect(in: EffectIn) -> vec4f { return sample_src(in.uv); }",
    properties: { samples: { kind: "number", inputs: { value: "u_samples" }, default: 6 } },
};

// A fresh registry per test, which is the whole point of it not being a module:
// nothing to clear, and nothing another file can have left behind.
let registry: Registry;
beforeEach(() => { registry = new Registry({ builtins: false }); });
afterEach(() => vi.restoreAllMocks());

describe("normalizeShaderPack", () => {
    it("keeps a well-formed pack, defaulting what is absent", () => {
        const pack = normalizeShaderPack(SWIRL) as Extract<Shader, { scope: "fill" }>;
        expect(pack.scope).toBe("fill");
        expect(Object.keys(pack.properties)).toEqual(["twist", "ink"]);
    });

    it("refuses a pack with no scope, naming both", () => {
        expect(() => normalizeShaderPack({ ...SWIRL, scope: "paint" }))
            .toThrow(/scope "fill" or "effect"/);
    });

    it("refuses a pack with no source", () => {
        expect(() => normalizeShaderPack({ ...SWIRL, source: "   " })).toThrow(/has no source/);
    });

    it("drops a property naming no uniform, keeping the rest", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = normalizeShaderPack({
            ...SWIRL,
            properties: { ...SWIRL.properties, broken: { kind: "number", default: 1 } },
        });
        expect(Object.keys(pack.properties)).toEqual(["twist", "ink"]);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/names no uniform/));
    });

    it("drops the second of two properties writing one uniform", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = normalizeShaderPack({
            ...SWIRL,
            properties: {
                twist: SWIRL.properties.twist,
                spin: { kind: "number", inputs: { value: "u_twist" }, default: 1 },
            },
        });
        expect(Object.keys(pack.properties)).toEqual(["twist"]);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/both write uniform "u_twist"/));
    });

    it("keeps a property whose kind it does not know", () => {
        const pack = normalizeShaderPack({
            ...SWIRL,
            properties: { curve: { kind: "bezier", inputs: { value: "u_twist" }, default: [0, 1] } },
        });
        expect(isKnownShaderProperty(pack.properties.curve)).toBe(false);
        expect(resolveShaderProperties(pack)).toEqual({ u_twist: [0, 1] });
    });
});

describe("resolveShaderProperties", () => {
    const pack = () => normalizeShaderPack(SWIRL);

    it("writes every property's default to its uniform", () => {
        expect(resolveShaderProperties(pack())).toEqual({
            u_twist: 2.5,
            u_ink: [0.15, 0.55, 1, 1],
        });
    });

    it("takes an override in place of a default", () => {
        expect(resolveShaderProperties(pack(), { twist: -4 }).u_twist).toBe(-4);
    });

    it("parses a CSS colour, so theme tokens and opacity suffixes work", () => {
        const uniforms = resolveShaderProperties(pack(), { ink: "#ff0000" });
        expect(uniforms.u_ink).toEqual([1, 0, 0, 1]);
    });

    it("spreads one property across several uniforms", () => {
        const composite = normalizeShaderPack({
            ...SWIRL,
            properties: { at: { kind: "point", inputs: { x: "u_cx", y: "u_cy" }, default: [3, 4] } },
        });
        expect(resolveShaderProperties(composite)).toEqual({ u_cx: 3, u_cy: 4 });
    });

    it("writes a boolean as 1 or 0", () => {
        const flagged = normalizeShaderPack({
            ...SWIRL,
            properties: { on: { kind: "boolean", inputs: { value: "u_on" }, default: true } },
        });
        expect(resolveShaderProperties(flagged)).toEqual({ u_on: 1 });
        expect(resolveShaderProperties(flagged, { on: false })).toEqual({ u_on: 0 });
    });

    it("warns about an override naming no property", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        resolveShaderProperties(pack(), { nope: 1 });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/has no property "nope"/));
    });
});

describe("a registry's shaders", () => {
    it("registers under the key it is given, not the pack's own id", () => {
        registry.addShader("swirl", SWIRL);
        expect(registry.shader("swirl")?.name).toBe("Swirl");
        expect(registry.shader("user/swirl")).toBeUndefined();
        expect(registry.shaderKeys()).toEqual(["swirl"]);
    });

    it("is a no-op for the same pack and throws for a different one", () => {
        registry.addShader("swirl", SWIRL);
        expect(() => registry.addShader("swirl", { ...SWIRL })).not.toThrow();
        expect(() => registry.addShader("swirl", SMEAR)).toThrow(/already registered to a different pack/);
    });

    it("narrows by scope, which is what makes the wrong builder a compile error", () => {
        registry.addShader("swirl", SWIRL);
        registry.addShader("smear", SMEAR);
        expect(registry.fillShader("swirl")?.name).toBe("Swirl");
        expect(registry.fillShader("smear")).toBeUndefined();
        expect(registry.effectShader("smear")?.name).toBe("Smear");
    });
});

describe("the builders", () => {
    it("Fills.shader resolves a pack and stamps its id", () => {
        const pack = registry.addShader("swirl", SWIRL) as Extract<Shader, { scope: "fill" }>;
        const [fill] = [...Fills.shader(pack, { values: { twist: 9 } })];
        const resolved = resolveFill(fill);
        expect(resolved).toMatchObject({
            type: "shader",
            shaderId: "user/swirl",
            uniforms: { u_twist: 9, u_ink: [0.15, 0.55, 1, 1] },
        });
    });

    it("Effects.shader takes backdrop mode from the pack", () => {
        const pack = registry.addShader("smear", SMEAR) as Extract<Shader, { scope: "effect" }>;
        const [effect] = [...Effects.shader({ source: pack, values: { samples: 12 } })];
        expect(effect).toMatchObject({ type: "shader", mode: "backdrop", uniforms: { u_samples: 12 } });
    });

    it("refuses a fill pack given to Effects.shader, and the reverse", () => {
        const fill = registry.addShader("swirl", SWIRL) as never;
        const effect = registry.addShader("smear", SMEAR) as never;
        expect(() => Effects.shader({ source: effect })).not.toThrow();
        expect(() => Effects.shader({ source: fill })).toThrow(/use Effects\.shader|use Fills\.shader/);
        expect(() => Fills.shader(effect)).toThrow(/use Effects\.shader/);
    });

    it("a raw uniform still wins over a property that names it", () => {
        const pack = registry.addShader("swirl", SWIRL) as Extract<Shader, { scope: "fill" }>;
        const [fill] = [...Fills.shader(pack, { values: { twist: 9 }, uniforms: { u_twist: 1 } })];
        expect(resolveFill(fill)).toMatchObject({ uniforms: { u_twist: 1 } });
    });
});

// ── Property kinds ─────────────────────────────────────────────────────────

const MAIN = "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }";
let packs = 0;
/** A fill pack with the one property `p`, under a name no other test uses (warnings are remembered per message). */
const withProperty = (property: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    normalizeShaderPack({ scope: "fill", name: `Kinds ${++packs}`, source: MAIN, properties: { p: property }, ...extra });
const one = (kind: string, value: unknown, overrides?: unknown) =>
    resolveShaderProperties(
        withProperty({ kind, inputs: { value: "u_p" }, default: value }),
        overrides === undefined ? undefined : { p: overrides },
    );

describe("property kinds", () => {
    it.each(["number", "slider", "angle", "hue"])("%s writes a finite number as it is", (kind) => {
        expect(one(kind, 0.75)).toEqual({ u_p: 0.75 });
        expect(one(kind, -3)).toEqual({ u_p: -3 });
        expect(one(kind, 0)).toEqual({ u_p: 0 });
    });

    it.each(["number", "slider", "angle", "hue"])("%s warns and writes nothing for a value that is not a finite number", (kind) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = withProperty({ kind, inputs: { value: "u_p" }, default: 1 });
        for (const bad of ["fast", NaN, Infinity, null, [1]]) {
            expect(resolveShaderProperties(pack, { p: bad })).toEqual({});
        }
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/property "p" expects a number, got "fast"/));
    });

    it("slider keeps its default when no override names it", () => {
        const pack = withProperty({ kind: "slider", inputs: { value: "u_p" }, default: 0.25, min: 0, max: 1 });
        expect(resolveShaderProperties(pack)).toEqual({ u_p: 0.25 });
        expect(resolveShaderProperties(pack, { p: 0.9 })).toEqual({ u_p: 0.9 });
    });

    it("slider does not clamp to its own range", () => {
        const pack = withProperty({ kind: "slider", inputs: { value: "u_p" }, default: 0.25, min: 0, max: 1 });
        expect(resolveShaderProperties(pack, { p: 7 })).toEqual({ u_p: 7 });
    });

    it("hue and angle write degrees untouched, with no wrapping", () => {
        expect(one("hue", 400)).toEqual({ u_p: 400 });
        expect(one("angle", -90)).toEqual({ u_p: -90 });
    });

    it("boolean writes anything truthy as 1 and anything falsy as 0", () => {
        expect(one("boolean", true)).toEqual({ u_p: 1 });
        expect(one("boolean", true, 0)).toEqual({ u_p: 0 });
        expect(one("boolean", false, "yes")).toEqual({ u_p: 1 });
        expect(one("boolean", false, null)).toEqual({ u_p: 0 });
    });

    it("color writes four floats, from a tuple or from a CSS string", () => {
        expect(one("color", [0.1, 0.2, 0.3, 0.4])).toEqual({ u_p: [0.1, 0.2, 0.3, 0.4] });
        expect(one("color", "red")).toEqual({ u_p: [1, 0, 0, 1] });
        expect(one("color", "white/50")).toEqual({ u_p: [1, 1, 1, 0.5] });
    });

    it("vector writes its floats as they are, whatever their number", () => {
        expect(one("vector", [1, 2, 3])).toEqual({ u_p: [1, 2, 3] });
        expect(one("vector", [1, 2, 3, 4, 5])).toEqual({ u_p: [1, 2, 3, 4, 5] });
    });

    it("vector warns and writes nothing for a non-numeric entry", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = withProperty({ kind: "vector", inputs: { value: "u_p" }, default: [1, 2] });
        expect(resolveShaderProperties(pack, { p: [1, "a"] })).toEqual({});
        expect(resolveShaderProperties(pack, { p: [1, NaN] })).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/property "p" expects numbers/));
    });

    it("point takes a pair of floats or an { x, y } object", () => {
        expect(one("point", [3, 4])).toEqual({ u_p: [3, 4] });
        expect(one("point", { x: 3, y: 4 })).toEqual({ u_p: [3, 4] });
        expect(one("point", [0, 0], { x: -1, y: 2 })).toEqual({ u_p: [-1, 2] });
    });

    it("point warns and writes nothing for an object missing a coordinate", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = withProperty({ kind: "point", inputs: { value: "u_p" }, default: [0, 0] });
        expect(resolveShaderProperties(pack, { p: { x: 1 } })).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/expects numbers/));
    });

    it("point spreads over x and y uniforms from an object just as from an array", () => {
        const pack = withProperty({ kind: "point", inputs: { x: "u_cx", y: "u_cy" }, default: { x: 5, y: 6 } });
        expect(resolveShaderProperties(pack)).toEqual({ u_cx: 5, u_cy: 6 });
        expect(resolveShaderProperties(pack, { p: [7, 8] })).toEqual({ u_cx: 7, u_cy: 8 });
    });

    it("vector spreads over x, y, z and w uniforms by position", () => {
        const pack = withProperty({ kind: "vector", inputs: { x: "u_a", w: "u_d", z: "u_c" }, default: [1, 2, 3, 4] });
        expect(resolveShaderProperties(pack)).toEqual({ u_a: 1, u_c: 3, u_d: 4 });
    });

    it("color spreads over r, g, b and a uniforms by position", () => {
        const pack = withProperty({ kind: "color", inputs: { r: "u_r", a: "u_a" }, default: "rgb(255 0 0 / 0.5)" });
        expect(resolveShaderProperties(pack)).toEqual({ u_r: 1, u_a: 0.5 });
    });

    it("a property that names value and a component writes each from the same value", () => {
        const pack = withProperty({ kind: "point", inputs: { value: "u_p", x: "u_x" }, default: [3, 4] });
        expect(resolveShaderProperties(pack)).toEqual({ u_p: [3, 4], u_x: 3 });
    });

    it("warns, once, that a component has nothing to write", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = withProperty({ kind: "point", inputs: { x: "u_x", z: "u_z" }, default: [3, 4] });
        expect(resolveShaderProperties(pack)).toEqual({ u_x: 3 });
        resolveShaderProperties(pack);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/has no "z" to write to "u_z"/));
    });

    it("passes the value of a kind it does not know through, a number or an array", () => {
        expect(one("gradient", 0.5)).toEqual({ u_p: 0.5 });
        expect(one("gradient", [1, 2, 3])).toEqual({ u_p: [1, 2, 3] });
    });

    it("writes nothing, quietly, for an unknown kind whose value is neither", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        expect(one("gradient", "violet")).toEqual({});
        expect(one("gradient", undefined)).toEqual({});
        expect(warn).not.toHaveBeenCalled();
    });

    it("lets a property win over the pack's own uniform of the same name", () => {
        const pack = withProperty({ kind: "number", inputs: { value: "u_p" }, default: 2 }, { uniforms: { u_p: 99, u_other: 7 } });
        expect(resolveShaderProperties(pack)).toEqual({ u_p: 2, u_other: 7 });
    });

    it("tells a known kind from one it does not know", () => {
        for (const kind of ["number", "slider", "angle", "hue", "boolean", "color", "vector", "point"]) {
            expect(isKnownShaderProperty({ kind, inputs: { value: "u" }, default: 0 } as never)).toBe(true);
        }
        expect(isKnownShaderProperty({ kind: "gradient", inputs: { value: "u" } })).toBe(false);
    });
});

// ── Ceilings ───────────────────────────────────────────────────────────────

describe("the pack ceilings", () => {
    const properties = (count: number) =>
        Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { kind: "number", inputs: { value: `u_${i}` }, default: i }]));
    const named = (name: string, count: number) =>
        normalizeShaderPack({ scope: "effect", name, source: MAIN, properties: properties(count) });

    it("holds 64 properties and drops the rest, with one warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = named("Ceiling properties", 70);
        expect(Object.keys(pack.properties)).toHaveLength(64);
        expect(Object.keys(pack.properties)[63]).toBe("p63");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe('[shader] shader "Ceiling properties" declares more than 64 properties; the rest are ignored.');
    });

    it("holds exactly 64 without a word", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        expect(Object.keys(named("Exactly 64", 64).properties)).toHaveLength(64);
        expect(warn).not.toHaveBeenCalled();
    });

    it("counts only the properties it kept against the ceiling", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const mixed = {
            ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`bad${i}`, { kind: "number" }])),
            ...properties(64),
        };
        const pack = normalizeShaderPack({ scope: "effect", name: "Ceiling mixed", source: MAIN, properties: mixed });
        expect(Object.keys(pack.properties)).toHaveLength(64);
        expect(warn).toHaveBeenCalledTimes(10);
    });

    it("accepts a source of exactly 64,000 characters and refuses one more", () => {
        expect(() => normalizeShaderPack({ scope: "fill", name: "Long", source: "a".repeat(64_000), properties: {} })).not.toThrow();
        expect(() => normalizeShaderPack({ scope: "fill", name: "Long", source: "a".repeat(64_001), properties: {} }))
            .toThrow('Shader pack "Long" source is 64001 characters, over the 64000 ceiling.');
    });

    it("measures the source after trimming it", () => {
        const padded = `  ${"a".repeat(64_000)}\n\n`;
        const pack = normalizeShaderPack({ scope: "fill", name: "Padded", source: padded, properties: {} });
        expect(pack.source).toHaveLength(64_000);
    });

    it("exports the ceilings", () => {
        expect(MAX_SHADER_PROPERTIES).toBe(64);
        expect(MAX_SHADER_SOURCE).toBe(64_000);
    });
});

// ── Warn once ──────────────────────────────────────────────────────────────

describe("the pack warnings", () => {
    it("warn once per message, however often the pack is normalised", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const bad = { scope: "fill", name: "Warn once", source: MAIN, properties: { oops: { kind: "number" } } };
        for (let i = 0; i < 5; i++) normalizeShaderPack(bad);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('[shader] shader "Warn once" property "oops" names no uniform in "inputs"; ignored.');
    });

    it("warn separately for messages that differ", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        normalizeShaderPack({ scope: "fill", name: "Warn two", source: MAIN, properties: { a: { kind: "number" }, b: { kind: "number" } } });
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it("name the three ways a property can be malformed", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        normalizeShaderPack({
            scope: "fill", name: "Warn kinds", source: MAIN,
            properties: {
                nokind: { inputs: { value: "u_a" }, default: 1 },
                noinputs: { kind: "number", inputs: {} },
                notstring: { kind: "number", inputs: { value: 3 } },
            },
        });
        const messages = warn.mock.calls.map((call) => call[0]);
        expect(messages).toEqual([
            '[shader] shader "Warn kinds" property "nokind" has no kind; ignored.',
            '[shader] shader "Warn kinds" property "noinputs" names no uniform in "inputs"; ignored.',
            '[shader] shader "Warn kinds" property "notstring" has a non-string uniform name; ignored.',
        ]);
    });

    it("warn once for a bad value however often it is resolved", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const pack = withProperty({ kind: "number", inputs: { value: "u_p" }, default: 1 });
        for (let i = 0; i < 4; i++) resolveShaderProperties(pack, { p: "x" });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("forget old messages once a few hundred are remembered, so the memory is bounded", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const probe = () => normalizeShaderPack({ scope: "fill", name: "Bounded memory", source: MAIN, properties: { x: { kind: "number" } } });
        probe();
        probe();
        expect(warn).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 300; i++) {
            normalizeShaderPack({ scope: "fill", name: `Flood ${i}`, source: MAIN, properties: { x: { kind: "number" } } });
        }
        warn.mockClear();
        probe();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

// ── Normalising a pack ─────────────────────────────────────────────────────

describe("normalizeShaderPack – the shape of what it keeps", () => {
    const base = { scope: "fill", name: "Shape", source: MAIN, properties: {} };

    it("refuses what is not an object", () => {
        for (const input of [null, undefined, "pack", 3, true]) {
            expect(() => normalizeShaderPack(input)).toThrow("A shader pack must be an object.");
        }
    });

    it("trims the source and names the pack Shader when it has no name", () => {
        const pack = normalizeShaderPack({ scope: "effect", source: `\n  ${MAIN}  \n`, properties: {} });
        expect(pack.source).toBe(MAIN);
        expect(pack.name).toBe("Shader");
        expect(normalizeShaderPack({ ...base, name: "" }).name).toBe("Shader");
    });

    it("keeps $kind, id and description only when they are strings", () => {
        const kept = normalizeShaderPack({ ...base, $kind: "k", id: "i", description: "d" });
        expect([kept.$kind, kept.id, kept.description]).toEqual(["k", "i", "d"]);
        const dropped = normalizeShaderPack({ ...base, $kind: 1, id: 2, description: 3 });
        expect("$kind" in dropped).toBe(false);
        expect("id" in dropped).toBe(false);
        expect("description" in dropped).toBe(false);
    });

    it("drops a stray coords", () => {
        expect("coords" in normalizeShaderPack({ ...base, coords: "centered" })).toBe(false);
    });

    it("keeps backdrop only when it is true, and only on an effect", () => {
        const effect = { ...base, scope: "effect" };
        expect((normalizeShaderPack({ ...effect, backdrop: true }) as { backdrop?: boolean }).backdrop).toBe(true);
        expect("backdrop" in normalizeShaderPack({ ...effect, backdrop: "yes" })).toBe(false);
        expect("backdrop" in normalizeShaderPack({ ...effect, backdrop: false })).toBe(false);
        expect("backdrop" in normalizeShaderPack({ ...base, backdrop: true })).toBe(false);
    });

    it("keeps the pack's own uniforms only when they are a record", () => {
        expect(normalizeShaderPack({ ...base, uniforms: { u_a: 1 } }).uniforms).toEqual({ u_a: 1 });
        expect("uniforms" in normalizeShaderPack({ ...base, uniforms: [1, 2] })).toBe(false);
        expect("uniforms" in normalizeShaderPack({ ...base, uniforms: "x" })).toBe(false);
    });

    it("takes missing or non-record properties as none", () => {
        expect(normalizeShaderPack({ scope: "fill", name: "n", source: MAIN }).properties).toEqual({});
        expect(normalizeShaderPack({ ...base, properties: [] }).properties).toEqual({});
        expect(normalizeShaderPack({ ...base, properties: "x" }).properties).toEqual({});
    });
});

describe("shader language", () => {
    const WGSL_FILL = "struct Params { amount: f32 }\nfn fill(in: FillIn) -> vec4f { return vec4f(u.amount); }";

    it("is WGSL when a shader says so or says nothing", () => {
        expect(isWgslShader({})).toBe(true);
        expect(isWgslShader({ language: "wgsl" })).toBe(true);
        expect(isWgslShader({ language: "sksl" })).toBe(false);
        expect(shaderContractOf({})).toBe(WGSL_CONTRACT);
        expect(shaderContractOf({ contract: 3 })).toBe(3);
        expect(shaderContractOf({ language: "sksl" })).toBeUndefined();
    });

    it("normalising a pack stamps WGSL, and refuses any other language", () => {
        expect(normalizeShaderPack(SWIRL).language).toBe("wgsl");
        expect(() => normalizeShaderPack({ ...SWIRL, language: "sksl" })).toThrow(/only WGSL is supported/);
        const wgsl = normalizeShaderPack({ scope: "fill", name: "W", source: WGSL_FILL, properties: {}, textures: [{ name: "image" }, 3] });
        expect(wgsl.language).toBe("wgsl");
        expect((wgsl as { textures?: unknown }).textures).toEqual([{ name: "image" }]);
    });

    it("the builders stamp the language, and no blend mode by default", () => {
        const fill = resolveFill(Fills.shader(WGSL_FILL, { uniforms: { amount: 1 } }).list[0]) as { language: string };
        expect(fill.language).toBe("wgsl");
        const wgsl = Effects.shader({ source: "fn effect(in: EffectIn) -> vec4f { return sample_src(in.uv); }" }).list[0] as { language: string; blendMode?: string };
        expect(wgsl.language).toBe("wgsl");
        expect(wgsl.blendMode).toBeUndefined();
    });
});
