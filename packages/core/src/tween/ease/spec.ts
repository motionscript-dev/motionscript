import { easeIn, easeInOut, easeOut, linear, type EaseParams, type StandardEase } from "./constants";
import { curveEase, isEaseCurve, type CurvePoint } from "./curve";
import { easeDescription } from "./describe";
import type { EasingFunction } from "./type";

/** How something eases, as data: `kind` picks the direction and `args` the family and its knobs, mirroring the families in `tween/ease/constants.ts`. `kind: "custom"` takes a drawn curve in `args`, or the key of an ease the host passed to `Registry.addEase` / `RegistryOptions.eases`. */
export interface EaseSpec {
    kind: "linear" | "in" | "out" | "inOut" | "custom";
    /** Family and parameters (`"quad"`, or `{ type: "back", overshoot: 2 }`) for every `kind` but `"custom"`, whose `args` is the drawn curve itself (a {@link CurvePoint} chain from (0, 0) to (1, 1), so timing travels with the document) or a `Registry.addEase` key. */
    args?: EaseParams | CurvePoint[] | string;
}

export const EASE_KINDS: ReadonlySet<string> = new Set<EaseSpec["kind"]>(["linear", "in", "out", "inOut", "custom"]);

/** The function `spec` runs as. A registry key resolves through `lookup`, and throws without one. */
export function easeOfSpec(spec: EaseSpec, lookup?: (key: string) => EasingFunction | undefined, known?: () => readonly string[]): EasingFunction {
    switch (spec.kind) {
        case "linear": return linear();
        case "in": return easeIn(spec.args as EaseParams | undefined);
        case "out": return easeOut(spec.args as EaseParams | undefined);
        case "inOut": return easeInOut(spec.args as EaseParams | undefined);
        case "custom": {
            const key = spec.args;
            if (isEaseCurve(key)) return curveEase(key);
            if (typeof key !== "string") {
                throw new Error(`A "custom" ease needs a curve or its Registry.addEase key in \`args\` (got ${JSON.stringify(spec.args)}).`);
            }
            const fn = lookup?.(key);
            if (!fn) {
                const registered = known?.().join(", ") || "none";
                throw new Error(lookup
                    ? `No ease registered under "${key}". Registered: ${registered}.`
                    : `The ease "${key}" names a Registry entry, which nothing here can resolve; use a standard ease or a drawn curve.`);
            }
            return fn;
        }
    }
}

const STANDARD: ReadonlySet<string> = new Set<StandardEase>(["sine", "quad", "cubic", "quart", "quint", "expo", "circ", "back", "elastic", "bounce"]);

/** The spec an engine-built ease was made from, or `undefined` for a function the engine did not build. */
export function specOfEase(ease: EasingFunction): EaseSpec | undefined {
    const description = easeDescription(ease);
    if (description === undefined) return undefined;
    if (description === "lin") return { kind: "linear" };
    if (description.startsWith("curve:")) return { kind: "custom", args: JSON.parse(description.slice(6)) as CurvePoint[] };
    const [direction, type, overshoot, amplitude, period] = description.split(":");
    if ((direction !== "in" && direction !== "out" && direction !== "inOut") || !STANDARD.has(type)) return undefined;
    const tuning = { overshoot, amplitude, period };
    const config: Record<string, unknown> = { type };
    for (const [name, value] of Object.entries(tuning)) {
        if (value !== undefined && value !== "_") config[name] = Number(value);
    }
    return { kind: direction, args: Object.keys(config).length === 1 ? (type as StandardEase) : (config as EaseParams) };
}
