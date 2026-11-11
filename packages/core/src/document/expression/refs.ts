import { expressionOps } from "./ops";

/**
 * `undefined` when the ref has no dot and so names a variable. The dot is the discriminator in the parser
 * (which hands the bracket's contents over as one opaque name), the validator and `ClipTimeline`.
 */
export function splitNodeRef(ref: string): { key: string; prop: string } | undefined {
    const dot = ref.indexOf(".");
    return dot < 0 ? undefined : { key: ref.slice(0, dot), prop: ref.slice(dot + 1) };
}

export interface ExpressionRefs {
    vars: string[];
    keys: Array<[key: string, prop: string]>;
    /** Expressions that failed to parse; their references are not in the lists above. */
    unparsable: number;
}

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
