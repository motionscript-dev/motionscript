// A WGSL shader's uniforms are bound to its `struct Params` by name, so a
// value naming no member is dropped and a member with no value reads 0: a
// renamed member silently zeroes. Both are reported as `params` issues.

import { normalizeUniforms, shaderContractOf, WGSL_CONTRACT, type RenderIssue } from "@motionscript/core";
import { type ShaderScope, validateShader } from "../user-shaders";

/** Member names per scope and source (null: the source does not compile, reported elsewhere). */
const members = new Map<string, readonly string[] | null>();
const MAX_SOURCES = 64;

function membersOf(scope: ShaderScope, source: string): readonly string[] | null {
    const key = `${scope}\n${source}`;
    let known = members.get(key);
    if (known === undefined) {
        try {
            const report = validateShader(scope, source);
            known = report.ok ? report.fields.map((f) => f.name) : null;
        } catch {
            // The WASM is not loaded.
            return null;
        }
        if (members.size >= MAX_SOURCES) members.delete(members.keys().next().value!);
    } else {
        members.delete(key);
    }
    members.set(key, known);
    return known;
}

/** What a WGSL fill or effect's uniforms and its `Params` disagree on, and a contract newer than this renderer's. */
export function shaderParamIssues(scope: ShaderScope, shader: { source?: string; language?: string; contract?: number; uniforms?: unknown }): RenderIssue[] {
    const source = shader.source ?? "";
    const contract = shaderContractOf(shader);
    if (!source.trim() || contract === undefined) return [];
    const out: RenderIssue[] = [];
    if (contract > WGSL_CONTRACT) {
        out.push({
            kind: "shader", feature: `${scope}:contract-${contract}`,
            message: `A WGSL shader ${scope} is written for shader contract ${contract}; this renderer implements ${WGSL_CONTRACT}, so it may not draw as intended.`,
        });
    }
    const names = membersOf(scope, source);
    if (!names) return out;
    const values = normalizeUniforms((shader.uniforms ?? {}) as Parameters<typeof normalizeUniforms>[0]);
    for (const name of Object.keys(values)) {
        if (!names.includes(name)) {
            out.push({ kind: "params", feature: `params:${name}`, message: `A WGSL shader ${scope} is given "${name}", which names no member of its struct Params, so the value is ignored.` });
        }
    }
    for (const name of names) {
        if (!(name in values)) {
            out.push({ kind: "params", feature: `params:${name}`, message: `A WGSL shader ${scope}'s Params.${name} is given no value, so it reads 0.` });
        }
    }
    return out;
}
