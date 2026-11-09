import { expressionOps } from "./ops";

/**
 * A reference split into the node key and prop it names, or `undefined` when it
 * has no dot and so names a variable instead.
 *
 * The dot is the whole discriminator, in the parser (which hands the bracket's
 * contents over as one opaque name), the validator, and `ClipTimeline`.
 */
export function splitNodeRef(ref: string): { key: string; prop: string } | undefined {
    const dot = ref.indexOf(".");
    return dot < 0 ? undefined : { key: ref.slice(0, dot), prop: ref.slice(dot + 1) };
}

export interface ExpressionRefs {
    /** Variable ids read, de-duplicated, in first-seen order. */
    vars: string[];
    /** `[key, prop]` pairs read, de-duplicated, in first-seen order. */
    keys: Array<[key: string, prop: string]>;
    /** Expressions that failed to parse; their references are not in the lists above. */
    unparsable: number;
}

/** Every reference inside every expression in an authored value, at any depth. */
export function expressionRefs(value: unknown, path = ""): ExpressionRefs {
    const vars: string[] = [];
    const keys: Array<[string, string]> = [];
    let unparsable = 0;
    const seen = new Set<string>();
    for (const site of expressionOps.collect(value, path)) {
        const parsed = expressionOps.tryParse(site.source);
        if ("error" in parsed) {
            unparsable++;
            continue;
        }
        for (const ref of parsed.expression.refs) {
            if (seen.has(ref)) continue;
            seen.add(ref);
            const node = splitNodeRef(ref);
            if (node) keys.push([node.key, node.prop]);
            else vars.push(ref);
        }
    }
    return { vars, keys, unparsable };
}
