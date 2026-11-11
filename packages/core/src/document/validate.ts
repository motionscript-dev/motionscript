import { isEaseCurve } from "@/tween/ease/curve";
import { EASE_KINDS } from "@/tween/ease/spec";
import { expressionOps } from "./expression/ops";
import { DOCUMENT_FORMAT_VERSION } from "./migrate";
import type { Registry } from "./registry";
import type {
    AudioDocument,
    ClipDocument,
    CommandSpec,
    CompositionDocument,
    EaseSpec,
    LoopSpec,
    NodeSpec,
    StillDocument,
    TimedNodeSpec,
    VariableSpec,
} from "./types";
import { effectiveSpanIn } from "./types";

/**
 * Hand-rolled because `@motionscript/core` has no runtime dependencies. Checks structure, not props (a node
 * class checks those where applied): what spans rows, i.e. that a parent exists, the tree has no cycle, and a
 * command's target is present when it runs. Audio rows are the exception: a ramp or transition is JSON their
 * nodes read unchecked, and one a device cannot schedule fails long after the document was accepted.
 */

export interface ValidationIssue {
    path: string;
    message: string;
}

export interface ValidateOptions {
    /**
     * Also report every node type and command this registry cannot build. A build stands an inert placeholder in
     * for an unknown type and skips an unknown command, so this is the strict check.
     */
    registry?: Registry;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

const LOOP_DIRECTIONS = new Set(["normal", "reverse", "alternate"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTime(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function checkEase(ease: unknown, path: string, issues: ValidationIssue[]): void {
    if (ease === undefined) return;
    if (!isPlainObject(ease)) {
        issues.push({ path, message: "easing must be an object with a `kind`." });
        return;
    }
    const { kind, args } = ease as Partial<EaseSpec>;
    if (typeof kind !== "string" || !EASE_KINDS.has(kind)) {
        issues.push({
            path: `${path}.kind`,
            message: `easing kind must be one of ${[...EASE_KINDS].join(", ")} (got ${JSON.stringify(kind)}).`,
        });
        return;
    }
    if (kind === "custom" && args !== undefined && typeof args !== "string" && !isEaseCurve(args)) {
        issues.push({
            path: `${path}.args`,
            message: "a custom easing's args must be its curve — two or more `{ x, y }` points — or a registered ease's key.",
        });
    }
}

/** An audio ease runs on a device with no `Registry`, so a custom one has to be its drawn curve. */
function checkAudioEase(ease: unknown, path: string, issues: ValidationIssue[]): void {
    checkEase(ease, path, issues);
    if (isPlainObject(ease) && ease.kind === "custom" && !isEaseCurve(ease.args)) {
        issues.push({ path: `${path}.args`, message: "an audio ease cannot name a registered ease; draw its curve (two or more `{ x, y }` points) instead." });
    }
}

function checkParam(value: unknown, path: string, issues: ValidationIssue[]): void {
    if (value === undefined || (typeof value === "number" && Number.isFinite(value)) || expressionOps.isSource(value)) return;
    if (!isPlainObject(value) || !Array.isArray(value.keys)) {
        issues.push({ path, message: "must be a finite number, an expression or a ramp, `{ keys: [{ at, value }, …] }`." });
        return;
    }
    value.keys.forEach((key: unknown, i: number) => {
        const at = `${path}.keys[${i}]`;
        if (!isPlainObject(key)) {
            issues.push({ path: at, message: "a ramp key must be an object." });
            return;
        }
        if ((key.at === undefined) === (key.before === undefined) || !isTime(key.at ?? key.before)) {
            issues.push({ path: at, message: "a ramp key needs exactly one of `at` (seconds after the start) or `before` (seconds before the end), >= 0." });
        }
        if (typeof key.value !== "number" || !Number.isFinite(key.value)) {
            issues.push({ path: `${at}.value`, message: "a ramp key's value must be a finite number." });
        }
        checkAudioEase(key.ease, `${at}.ease`, issues);
    });
}

const TRANSITION_KEYS = new Set(["duration", "curve"]);

function checkTransition(transition: unknown, path: string, issues: ValidationIssue[]): void {
    if (transition === undefined) return;
    if (!isPlainObject(transition)) {
        issues.push({ path, message: "a transition must be an object, `{ duration, curve? }`." });
        return;
    }
    if (!isTime(transition.duration)) {
        issues.push({ path: `${path}.duration`, message: "a transition's duration must be a finite number of seconds >= 0." });
    }
    if (transition.curve !== undefined && transition.curve !== "equalPower") checkAudioEase(transition.curve, `${path}.curve`, issues);
    for (const key of Object.keys(transition)) {
        if (!TRANSITION_KEYS.has(key)) issues.push({ path: `${path}.${key}`, message: `a transition has no "${key}" (yet): only duration and curve.` });
    }
}

function checkAudioProps(type: string, props: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
    if ("filters" in props) {
        issues.push({ path: `${path}.filters`, message: "audio `filters` was renamed to `effects`." });
    }
    for (const name of ["volume", "pan", ...(type === "sound" ? ["speed"] : [])]) checkParam(props[name], `${path}.${name}`, issues);
    if (type === "sound" && props.loop === true && isPlainObject(props.speed)) {
        issues.push({ path: `${path}.speed`, message: "a looping sound cannot ramp its speed: there is no one pass of the source for the ramp to run over." });
    }
    const effects = props.effects;
    if (effects !== undefined) {
        const list = Array.isArray(effects) ? effects : [effects];
        list.forEach((effect: unknown, i: number) => {
            const at = Array.isArray(effects) ? `${path}.effects[${i}]` : `${path}.effects`;
            if (!isPlainObject(effect) || typeof effect.type !== "string") {
                issues.push({ path: at, message: "an effect must be an object with a `type`." });
                return;
            }
            for (const [field, value] of Object.entries(effect)) {
                if (field !== "type") checkParam(value, `${at}.${field}`, issues);
            }
        });
    }
    checkTransition(props.transitionIn, `${path}.transitionIn`, issues);
    checkTransition(props.transitionOut, `${path}.transitionOut`, issues);
}

function checkLoop(loop: unknown, path: string, issues: ValidationIssue[]): void {
    if (loop === undefined) return;
    if (!isPlainObject(loop)) {
        issues.push({ path, message: "loop must be an object with a `count`." });
        return;
    }
    const { direction, count } = loop as Partial<LoopSpec>;
    if (count !== null && (typeof count !== "number" || !Number.isInteger(count) || count < 0)) {
        issues.push({
            path: `${path}.count`,
            message: "loop count must be a whole number of repeats >= 0, or null to repeat for the rest of the clip.",
        });
    }
    if (direction !== undefined && !LOOP_DIRECTIONS.has(direction)) {
        issues.push({
            path: `${path}.direction`,
            message: `loop direction must be one of ${[...LOOP_DIRECTIONS].join(", ")} (got ${JSON.stringify(direction)}).`,
        });
    }
}

function checkNodeSpec(node: unknown, path: string, issues: ValidationIssue[]): node is NodeSpec {
    if (!isPlainObject(node)) {
        issues.push({ path, message: "node must be an object." });
        return false;
    }
    let ok = true;
    const { id, type, parentId, layerOrder, props, key } = node as Partial<NodeSpec>;

    /**
     * `""` is reserved for the scene root (see `checkRootShape`); any other node needs a real id, since an empty
     * one could never be a command's target.
     */
    if (typeof id !== "string") {
        issues.push({ path: `${path}.id`, message: "id must be a string." });
        ok = false;
    }
    if (typeof type !== "string" || type.length === 0) {
        issues.push({ path: `${path}.type`, message: "type must be a non-empty string." });
        ok = false;
    }
    if (parentId !== null && typeof parentId !== "string") {
        issues.push({ path: `${path}.parentId`, message: "parentId must be a node id or null." });
        ok = false;
    }
    if (typeof layerOrder !== "number" || !Number.isFinite(layerOrder)) {
        issues.push({ path: `${path}.layerOrder`, message: "layerOrder must be a finite number." });
        ok = false;
    }
    if (!isPlainObject(props)) {
        issues.push({ path: `${path}.props`, message: "props must be an object (`{}` when nothing is set)." });
        ok = false;
    } else if (type === "sound" || type === "audioBus") {
        checkAudioProps(type, props, `${path}.props`, issues);
    }
    if (key !== undefined) {
        if (typeof key !== "string" || key.length === 0) {
            issues.push({ path: `${path}.key`, message: "key must be a non-empty string when present." });
            ok = false;
        } else if (key.includes("]") || key.includes(".")) {
            /**
             * `[key.prop]` is the reference syntax, so either character names something an expression could never spell.
             */
            issues.push({
                path: `${path}.key`,
                message: `node key "${key}" cannot contain "]" or "." — it is referenced as "[${key}.prop]".`,
            });
            ok = false;
        }
    }
    return ok;
}

interface NodeSite {
    spec: NodeSpec;
    path: string;
}

/**
 * Keys are their own namespace, separate from {@link checkIdSpace}: `[x]` is always a variable and `[x.p]`
 * always a node, and a key is never a `targetId`. Unique among keys all the same, or `[card.x]` would read
 * whichever row the build reached last.
 */
function checkNodeKeys(sites: readonly NodeSite[], issues: ValidationIssue[]): Map<string, NodeSite> {
    const byKey = new Map<string, NodeSite>();
    for (const site of sites) {
        const key = site.spec.key;
        if (typeof key !== "string" || key.length === 0) continue;
        const existing = byKey.get(key);
        if (existing) {
            issues.push({
                path: `${site.path}.key`,
                message: `duplicate node key "${key}" (also declared at ${existing.path}).`,
            });
            continue;
        }
        byKey.set(key, site);
    }
    return byKey;
}

/**
 * The row with `id: ""` is the root: unparented and of the document kind's root type (`canvas2d` for a scene,
 * `audioBus` for audio). `targetId: null` names it.
 */
function checkRootShape(
    spec: NodeSpec,
    path: string,
    rootType: string,
    issues: ValidationIssue[],
): void {
    if (spec.id !== "") return;
    if (spec.type !== rootType || spec.parentId !== null) {
        issues.push({
            path,
            message: `the node with id "" is this document's root and must be \`{ type: "${rootType}", parentId: null }\`.`,
        });
    }
}

function checkCommandSpec(cmd: unknown, path: string, issues: ValidationIssue[]): cmd is CommandSpec {
    if (!isPlainObject(cmd)) {
        issues.push({ path, message: "command must be an object." });
        return false;
    }
    let ok = true;
    const { id, type, targetId, at, duration, args } = cmd as Partial<CommandSpec>;

    if (typeof id !== "string" || id.length === 0) {
        issues.push({ path: `${path}.id`, message: "id must be a non-empty string." });
        ok = false;
    }
    if (typeof type !== "string" || type.length === 0) {
        issues.push({ path: `${path}.type`, message: "type must be a non-empty string." });
        ok = false;
    }
    if (targetId !== null && typeof targetId !== "string") {
        issues.push({ path: `${path}.targetId`, message: "targetId must be a node id, or null for the scene root." });
        ok = false;
    }
    if (!isTime(at)) {
        issues.push({ path: `${path}.at`, message: "at must be a finite number of seconds >= 0." });
        ok = false;
    }
    if (duration !== undefined && !isTime(duration)) {
        issues.push({ path: `${path}.duration`, message: "duration must be a finite number of seconds >= 0." });
        ok = false;
    }
    if (!isPlainObject(args)) {
        issues.push({ path: `${path}.args`, message: "args must be an object (`{}` when there are none)." });
        ok = false;
    }
    checkEase((cmd as Partial<CommandSpec>).easing, `${path}.easing`, issues);
    checkLoop((cmd as Partial<CommandSpec>).loop, `${path}.loop`, issues);
    return ok;
}

interface VariableSite {
    spec: VariableSpec;
    path: string;
}

function checkVariableSpec(v: unknown, path: string, issues: ValidationIssue[]): v is VariableSpec {
    if (!isPlainObject(v)) {
        issues.push({ path, message: "variable must be an object." });
        return false;
    }
    let ok = true;
    const { id, name, value, lerp } = v as Partial<VariableSpec>;

    if (typeof id !== "string" || id.length === 0) {
        issues.push({ path: `${path}.id`, message: "id must be a non-empty string." });
        ok = false;
    } else if (id.includes("]")) {
        /**
         * `[id]` is the reference syntax, so a `]` in an id names something an expression could never spell.
         */
        issues.push({ path: `${path}.id`, message: `variable id "${id}" cannot contain "]" — it is referenced as "[${id}]".` });
        ok = false;
    }
    if (name !== undefined && typeof name !== "string") {
        issues.push({ path: `${path}.name`, message: "name must be a string when present." });
        ok = false;
    }
    if (!("value" in (v as object))) {
        issues.push({ path: `${path}.value`, message: "value is required — a variable is what it holds before anything changes it." });
        ok = false;
    } else if (expressionOps.isSource(value)) {
        issues.push({
            path: `${path}.value`,
            message: "a variable holds a value, not an expression — only a node prop can be bound.",
        });
        ok = false;
    }
    if (lerp !== undefined && typeof lerp !== "string") {
        issues.push({ path: `${path}.lerp`, message: "lerp must be a registered lerp key when present." });
        ok = false;
    }
    return ok;
}

function variableRows(rows: unknown, issues: ValidationIssue[]): VariableSite[] {
    if (rows === undefined) return [];
    if (!Array.isArray(rows)) {
        issues.push({ path: "variables", message: "variables must be an array." });
        return [];
    }
    const sites: VariableSite[] = [];
    rows.forEach((v, i) => {
        const path = `variables[${i}]`;
        if (checkVariableSpec(v, path, issues)) sites.push({ spec: v, path });
    });
    return sites;
}

function checkVariables(sites: VariableSite[], issues: ValidationIssue[]): Map<string, VariableSite> {
    const byId = new Map<string, VariableSite>();
    for (const site of sites) {
        const existing = byId.get(site.spec.id);
        if (existing) {
            issues.push({
                path: `${site.path}.id`,
                message: `duplicate variable id "${site.spec.id}" (also declared at ${existing.path}).`,
            });
            continue;
        }
        byId.set(site.spec.id, site);
    }
    return byId;
}

/**
 * `undefined` when the ref has no dot and so names a variable. The dot is the discriminator in the parser,
 * here and in `ClipTimeline`.
 */
function splitNodeRef(ref: string): { key: string; prop: string } | undefined {
    const dot = ref.indexOf(".");
    return dot < 0 ? undefined : { key: ref.slice(0, dot), prop: ref.slice(dot + 1) };
}

/**
 * A formula that does not parse, one naming an undeclared variable, and one naming a node key nothing carries.
 * All are silent otherwise: the first would throw from deep inside a build, the others would bind a prop to
 * nothing.
 */
function checkExpressions(
    value: unknown,
    path: string,
    declared: ReadonlySet<string>,
    keyed: ReadonlySet<string>,
    issues: ValidationIssue[],
): void {
    for (const site of expressionOps.collect(value, path)) {
        const parsed = expressionOps.tryParse(site.source);
        if ("error" in parsed) {
            issues.push({ path: site.path, message: parsed.error });
            continue;
        }
        for (const ref of parsed.expression.refs) {
            const node = splitNodeRef(ref);
            if (!node) {
                if (declared.has(ref)) continue;
                issues.push({
                    path: site.path,
                    message: keyed.has(ref)
                        ? `expression references "[${ref}]", which is a node key — a node is not a value, ` +
                          `so name the prop too: "[${ref}.x]".`
                        : `expression references "[${ref}]", which this document does not declare. ` +
                          `Declared: ${[...declared].map((k) => `[${k}]`).join(", ") || "none"}.`,
                });
                continue;
            }
            if (node.key.length === 0 || node.prop.length === 0 || node.prop.includes(".")) {
                issues.push({
                    path: site.path,
                    message: `expression references "[${ref}]", which is not a node reference — one is "[key.prop]".`,
                });
                continue;
            }
            if (keyed.has(node.key)) continue;
            issues.push({
                path: site.path,
                message:
                    `expression references "[${ref}]", but no node in this document is keyed "${node.key}". ` +
                    `Keyed: ${[...keyed].join(", ") || "none"}.`,
            });
        }
    }
}

interface BoundProp {
    id: string;
    path: string;
    reads: string[];
}

/**
 * Per top-level prop, the granularity a binding is installed at (`bindProps` binds each key), so a formula
 * nested inside `padding` makes `padding` the prop that reads.
 */
function boundProps(key: string, props: unknown, path: string, out: BoundProp[]): void {
    if (!isPlainObject(props)) return;
    for (const prop of Object.keys(props)) {
        const reads: string[] = [];
        for (const site of expressionOps.collect(props[prop], `${path}.${prop}`)) {
            const parsed = expressionOps.tryParse(site.source);
            if ("error" in parsed) continue;
            for (const ref of parsed.expression.refs) {
                if (splitNodeRef(ref)) reads.push(ref);
            }
        }
        if (reads.length > 0) out.push({ id: `${key}.${prop}`, path: `${path}.${prop}`, reads });
    }
}

/**
 * Refuse a prop that reads a prop that reads it back. Variables cannot cycle (nothing reads a variable), but
 * `[key.prop]` can. At runtime `PropSlot.get` refuses to re-enter and returns the last settled value, so a
 * cycle would otherwise be a frame that quietly disagrees with the document.
 *
 * Edges are per prop, not per node: `a.x -> b.y -> a.z` terminates and must not be rejected.
 */
function checkExpressionCycles(bound: readonly BoundProp[], issues: ValidationIssue[]): void {
    const byId = new Map(bound.map((b) => [b.id, b]));
    const settled = new Set<string>();
    const stack: string[] = [];
    const reported = new Set<string>();

    const walk = (id: string): void => {
        const entry = byId.get(id);
        // A prop nothing binds cannot continue a chain: it holds a literal.
        if (!entry || settled.has(id)) return;
        const at = stack.indexOf(id);
        if (at >= 0) {
            if (!reported.has(id)) {
                const cycle = [...stack.slice(at), id];
                for (const member of cycle) reported.add(member);
                issues.push({
                    path: entry.path,
                    message: `expression cycle ${cycle.join(" → ")} — a prop cannot read a prop that reads it back.`,
                });
            }
            return;
        }
        stack.push(id);
        for (const next of entry.reads) walk(next);
        stack.pop();
        settled.add(id);
    };

    for (const entry of bound) walk(entry.id);
}

/**
 * Check ids are unique, every `parentId` resolves, and no node is its own ancestor. A parent loop makes the
 * layout walk recurse until the stack overflows, with a trace pointing at the layout engine rather than the
 * two rows.
 */
function checkTree(sites: readonly NodeSite[], issues: ValidationIssue[]): void {
    /**
     * `sites` holds only rows that passed their shape check, so a position in it is not a position in the
     * document: every issue path comes from the site.
     */
    const bySite = new Map<string, NodeSite>();
    for (const site of sites) {
        if (bySite.has(site.spec.id)) {
            issues.push({ path: `${site.path}.id`, message: `duplicate node id "${site.spec.id}".` });
            continue;
        }
        bySite.set(site.spec.id, site);
    }

    for (const site of sites) {
        const parent = site.spec.parentId;
        if (parent !== null && !bySite.has(parent)) {
            issues.push({
                path: `${site.path}.parentId`,
                message: `parentId "${parent}" is not a node in this document.`,
            });
        }
    }

    // Walk each node to the root; a revisit within one walk is a cycle.
    const settled = new Set<string>();
    for (const { spec: node } of sites) {
        if (settled.has(node.id)) continue;
        const seen = new Set<string>();
        let cursor: NodeSpec | undefined = node;
        while (cursor) {
            if (seen.has(cursor.id)) {
                issues.push({
                    path: `${bySite.get(cursor.id)?.path}.parentId`,
                    message: `node "${cursor.id}" is its own ancestor — parent chain forms a cycle.`,
                });
                break;
            }
            seen.add(cursor.id);
            if (settled.has(cursor.id)) break;
            const parentId: string | null = cursor.parentId;
            cursor = parentId === null ? undefined : bySite.get(parentId)?.spec;
        }
        for (const id of seen) settled.add(id);
    }
}

/**
 * Nodes and variables share one id space: a command names its target with one field, and a host groups
 * timeline rows by `targetId`, so a collision would draw two unrelated things on one track. A {@link
 * NodeSpec.key} is deliberately not in this space (see {@link checkNodeKeys}).
 */
function checkIdSpace(
    nodes: NodeSpec[],
    variables: Map<string, VariableSite>,
    issues: ValidationIssue[],
): void {
    for (const node of nodes) {
        const clash = variables.get(node.id);
        if (clash) {
            issues.push({
                path: `${clash.path}.id`,
                message: `"${node.id}" is already a node id — nodes and variables share one id space.`,
            });
        }
    }
}

/**
 * Refuse the fields the format folded away, by name: a document written before nodes carried spans would
 * otherwise fail as "nodes must be an array" or an unresolved `[id]`, neither of which names the fix.
 */
function checkRetiredFields(doc: object, issues: ValidationIssue[]): void {
    if ((doc as { constants?: unknown }).constants !== undefined) {
        issues.push({
            path: "constants",
            message: "constants were merged into `variables` — move each row there and drop its `kind`.",
        });
    }
}

function checkFormatVersion(doc: object, issues: ValidationIssue[]): void {
    const version = (doc as { formatVersion?: unknown }).formatVersion;
    if (version === undefined) return;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
        issues.push({ path: "formatVersion", message: "formatVersion must be a whole number >= 0 when present." });
    } else if (version > DOCUMENT_FORMAT_VERSION) {
        issues.push({
            path: "formatVersion",
            message: `format ${version} is newer than this engine reads (${DOCUMENT_FORMAT_VERSION}) — open it with a newer engine.`,
        });
    }
}

const RETIRED_PROJECT_FIELDS: Readonly<Record<string, string>> = {
    visualTracks: "visual and audio tracks were merged into `tracks` — move each row there.",
    audioTracks: "visual and audio tracks were merged into `tracks` — move each row there.",
    backgrounds: "a background is a track — put it first in `tracks`.",
    overlays: "an overlay is a track — put it last in `tracks`.",
    commands: "a project has no commands — each clip carries its own.",
    constants: "a project has no constants — declare `variables` in each clip.",
};

function checkVocabulary(
    sites: readonly NodeSite[],
    commands: readonly { spec: CommandSpec; path: string }[],
    rootType: string,
    variables: ReadonlyMap<string, VariableSite>,
    registry: Registry,
    issues: ValidationIssue[],
): void {
    const typeOf = new Map<string, string>([["", rootType]]);
    for (const site of sites) {
        typeOf.set(site.spec.id, site.spec.type);
        if (!registry.hasNode(site.spec.type)) {
            issues.push({ path: `${site.path}.type`, message: `node type "${site.spec.type}" is not registered.` });
        }
    }
    for (const { spec, path } of commands) {
        if (registry.command(spec.type)) continue;
        if (spec.targetId !== null && variables.has(spec.targetId)) {
            issues.push({ path: `${path}.type`, message: `"${spec.type}" is not a variable command.` });
            continue;
        }
        const type = typeOf.get(spec.targetId ?? "");
        if (type === undefined || !registry.hasNode(type)) continue;
        if (!registry.takesCommand(type, spec.type)) {
            issues.push({ path: `${path}.type`, message: `node type "${type}" has no command "${spec.type}".` });
        }
    }
}

/**
 * Checked the same way whichever clip kind holds them: a cycle or missing parent is the same bug in a still
 * and a composition.
 */
function checkNodes(nodes: unknown, rootType: string, issues: ValidationIssue[]): NodeSite[] {
    if (!Array.isArray(nodes)) {
        issues.push({ path: "nodes", message: "nodes must be an array." });
        return [];
    }
    const sites: NodeSite[] = [];
    nodes.forEach((n, i) => {
        const path = `nodes[${i}]`;
        if (checkNodeSpec(n, path, issues)) {
            sites.push({ spec: n, path });
            checkRootShape(n, path, rootType, issues);
        }
    });
    checkTree(sites, issues);
    return sites;
}

function checkSpan(spec: TimedNodeSpec, path: string, issues: ValidationIssue[]): void {
    const { startAt, endAt } = spec;
    if (startAt !== undefined && !isTime(startAt)) {
        issues.push({ path: `${path}.startAt`, message: "startAt must be a finite number of seconds >= 0." });
    }
    if (endAt !== undefined && !isTime(endAt)) {
        issues.push({ path: `${path}.endAt`, message: "endAt must be a finite number of seconds >= 0." });
    }
    if (isTime(endAt) && endAt <= (isTime(startAt) ? startAt : 0)) {
        issues.push({ path: `${path}.endAt`, message: `endAt (${endAt}s) must be after startAt (${startAt ?? 0}s).` });
    }
    if (spec.id === "" && (startAt !== undefined || endAt !== undefined)) {
        issues.push({ path, message: "the root is present for the whole clip — it cannot carry startAt or endAt." });
    }
}

function validateStill(doc: StillDocument, issues: ValidationIssue[], registry: Registry | undefined): void {
    checkRetiredFields(doc, issues);
    if ((doc as { commands?: unknown }).commands !== undefined) {
        issues.push({
            path: "commands",
            message: "a still has no timeline, so no commands — make it a composition to animate it.",
        });
    }

    const variables = checkVariables(variableRows(doc.variables, issues), issues);
    const sites = checkNodes(doc.nodes, "canvas2d", issues);
    for (const site of sites) {
        const { startAt, endAt } = site.spec as TimedNodeSpec;
        if (startAt !== undefined || endAt !== undefined) {
            issues.push({
                path: site.path,
                message: "a still has no timeline — drop startAt/endAt, or make it a composition.",
            });
        }
    }
    const ok = sites.map((s) => s.spec);
    checkIdSpace(ok, variables, issues);
    if (registry) checkVocabulary(sites, [], "canvas2d", variables, registry, issues);
    const keyed = checkNodeKeys(sites, issues);

    const declared = new Set(variables.keys());
    const keys = new Set(keyed.keys());
    const bound: BoundProp[] = [];
    for (const site of sites) {
        checkExpressions(site.spec.props, `${site.path}.props`, declared, keys, issues);
        if (site.spec.key) boundProps(site.spec.key, site.spec.props, `${site.path}.props`, bound);
    }
    checkExpressionCycles(bound, issues);
}

function validateComposition(doc: CompositionDocument, issues: ValidationIssue[], registry: Registry | undefined): void {
    validateTimedDocument(doc, "canvas2d", issues, registry);
}

/**
 * An audio document is structurally a composition with `audioBus` as the root type, so the checks are shared:
 * a cycle, duplicate id or command running before its target is the same message in any clip kind.
 */
function validateAudio(doc: AudioDocument, issues: ValidationIssue[], registry: Registry | undefined): void {
    validateTimedDocument(doc, "audioBus", issues, registry);
}

/** Command types the format no longer has, and where what they did went. */
const RETIRED_COMMANDS: Readonly<Record<string, string>> = {
    add: "a node is a row in `nodes` — its `startAt` is when it enters.",
    variable: "a variable is declared in `variables`.",
};

function validateTimedDocument(
    doc: CompositionDocument | AudioDocument,
    rootType: string,
    issues: ValidationIssue[],
    registry: Registry | undefined,
): void {
    checkRetiredFields(doc, issues);
    if (!Array.isArray(doc.commands)) {
        issues.push({ path: "commands", message: "commands must be an array." });
        return;
    }
    if (doc.duration !== undefined && !isTime(doc.duration)) {
        issues.push({ path: "duration", message: "duration must be a finite number of seconds >= 0." });
    }

    /** Gathered first: every expression check needs to know what is declared. */
    const variables = checkVariables(variableRows(doc.variables, issues), issues);

    const nodeSites = checkNodes(doc.nodes, rootType, issues);
    for (const site of nodeSites) checkSpan(site.spec as TimedNodeSpec, site.path, issues);
    const nodes = nodeSites.map((s) => s.spec);
    checkIdSpace(nodes, variables, issues);
    const keyed = checkNodeKeys(nodeSites, issues);

    /** Each with the row it was authored in: a position in this list is not a position in `commands`. */
    const valid: { spec: CommandSpec; path: string }[] = [];
    const ids = new Set<string>();
    doc.commands.forEach((c: unknown, i: number) => {
        if (!checkCommandSpec(c, `commands[${i}]`, issues)) return;
        if (ids.has(c.id)) {
            issues.push({ path: `commands[${i}].id`, message: `duplicate command id "${c.id}".` });
            return;
        }
        const retired = RETIRED_COMMANDS[c.type];
        if (retired) {
            issues.push({ path: `commands[${i}].type`, message: `there is no "${c.type}" command — ${retired}` });
            return;
        }
        ids.add(c.id);
        valid.push({ spec: c, path: `commands[${i}]` });
    });

    /**
     * A command cannot act on a node that is not there yet: the one ordering rule, and the one a timeline editor
     * breaks by dragging a tween earlier than its node. "There" is the effective span (a child cannot enter before
     * its parent). A variable target is exempt: it holds its declared value from t=0.
     */
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (registry) checkVocabulary(nodeSites, valid, rootType, variables, registry, issues);
    for (const { spec: c, path } of valid) {
        if (c.targetId === null) continue;
        if (variables.has(c.targetId)) continue;
        const span = effectiveSpanIn(byId, c.targetId);
        if (span === undefined) {
            issues.push({
                path: `${path}.targetId`,
                message: `targetId "${c.targetId}" is not a node or variable in this document.`,
            });
        } else if (c.at < span.start) {
            issues.push({
                path: `${path}.at`,
                message: `command runs at ${c.at}s but its target "${c.targetId}" is not present until ${span.start}s.`,
            });
        }
    }

    /**
     * Expressions wherever a prop can be authored: node props (root included), a `to`/`set` props bag, or a named
     * command's arguments.
     */
    const declared = new Set(variables.keys());
    const keys = new Set(keyed.keys());
    for (const site of nodeSites) {
        checkExpressions(site.spec.props, `${site.path}.props`, declared, keys, issues);
    }
    for (const { spec: c, path } of valid) checkExpressions(c.args, `${path}.args`, declared, keys, issues);

    /**
     * Cycles over the two places a binding is installed: a node's own props and `set`, the one command whose args
     * reach `node.set()`.
     */
    const bound: BoundProp[] = [];
    for (const site of nodeSites) {
        if (site.spec.key) boundProps(site.spec.key, site.spec.props, `${site.path}.props`, bound);
    }
    for (const { spec: c, path } of valid) {
        if (c.type !== "set" || c.targetId === null) continue;
        const key = byId.get(c.targetId)?.key;
        if (key) boundProps(key, c.args, `${path}.args`, bound);
    }
    checkExpressionCycles(bound, issues);
}

/** Returns every issue rather than throwing on the first, so a host can show the list. */
export function validateDocument(doc: unknown, options: ValidateOptions = {}): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (!isPlainObject(doc)) {
        return { valid: false, issues: [{ path: "", message: "document must be an object." }] };
    }
    checkFormatVersion(doc, issues);
    const { registry } = options;
    const kind = (doc as Partial<ClipDocument>).kind;
    if (kind === "still") {
        validateStill(doc as unknown as StillDocument, issues, registry);
    } else if (kind === "composition") {
        validateComposition(doc as unknown as CompositionDocument, issues, registry);
    } else if (kind === "audio") {
        validateAudio(doc as unknown as AudioDocument, issues, registry);
    } else {
        issues.push({
            path: "kind",
            message: `kind must be "still", "composition" or "audio" (got ${JSON.stringify(kind)}).`,
        });
    }

    return { valid: issues.length === 0, issues };
}

/**
 * Each clip is validated by the same rules as a standalone one, with issues prefixed by the track that carries
 * it.
 */
export function validateProjectDocument(doc: unknown, options: ValidateOptions = {}): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (!isPlainObject(doc)) {
        return { valid: false, issues: [{ path: "", message: "document must be an object." }] };
    }
    const project = doc as Record<string, unknown>;
    if (project.kind !== "project") {
        issues.push({ path: "kind", message: `kind must be "project" (got ${JSON.stringify(project.kind)}).` });
    }
    if (typeof project.name !== "string" || project.name.length === 0) {
        issues.push({ path: "name", message: "name must be a non-empty string." });
    }
    if (project.fps !== undefined && (typeof project.fps !== "number" || !(project.fps > 0) || !Number.isFinite(project.fps))) {
        issues.push({ path: "fps", message: "fps must be a positive number when present." });
    }
    checkFormatVersion(project, issues);
    for (const [field, message] of Object.entries(RETIRED_PROJECT_FIELDS)) {
        if (project[field] !== undefined) issues.push({ path: field, message });
    }

    /**
     * Zero tracks is legitimate: a new project has no clips, and every host of this array treats an empty one as
     * ordinary (`exportProject`/`mixTimelineAudio` no-op, `screenshotProject` raises its own "nothing to
     * screenshot").
     */
    if (!Array.isArray(project.tracks)) {
        issues.push({ path: "tracks", message: "tracks must be an array." });
        return { valid: false, issues };
    }

    const ids = new Set<string>();
    project.tracks.forEach((raw, i) => {
        const path = `tracks[${i}]`;
        if (!isPlainObject(raw)) {
            issues.push({ path, message: "track must be an object." });
            return;
        }
        const track = raw as Record<string, unknown>;

        if (typeof track.id !== "string" || track.id.length === 0) {
            issues.push({ path: `${path}.id`, message: "id must be a non-empty string." });
        } else if (ids.has(track.id)) {
            issues.push({ path: `${path}.id`, message: `duplicate track id "${track.id}".` });
        } else {
            ids.add(track.id);
        }
        if (track.name !== undefined && typeof track.name !== "string") {
            issues.push({ path: `${path}.name`, message: "name must be a string when present." });
        }
        if (track.startAt !== undefined && !isTime(track.startAt)) {
            issues.push({ path: `${path}.startAt`, message: "startAt must be a finite number of seconds >= 0." });
        }
        /**
         * Required, not defaulted: a length that falls back to a media file's would silently stretch a three-minute
         * bed into a thirty-second edit.
         */
        if (!isTime(track.duration)) {
            issues.push({
                path: `${path}.duration`,
                message: "duration is required, and must be a finite number of seconds >= 0.",
            });
        }

        if (track.clip === undefined) {
            issues.push({ path: `${path}.clip`, message: "clip is required — a track places a clip document inline." });
            return;
        }
        for (const issue of clipIssuesOf(track.clip, options)) {
            issues.push({ path: `${path}.clip${issue.path ? `.${issue.path}` : ""}`, message: issue.message });
        }
    });

    return { valid: issues.length === 0, issues };
}

/**
 * Keyed by clip object: a host re-validates the whole project after every edit, which replaces only the clip
 * it touched. A clip mutated in place is not seen again (the identity contract `Session.replace` holds).
 */
const CLIP_ISSUES = new WeakMap<object, readonly ValidationIssue[]>();

function clipIssuesOf(clip: unknown, options: ValidateOptions): readonly ValidationIssue[] {
    if (!isPlainObject(clip) || options.registry) return validateDocument(clip, options).issues;
    let issues = CLIP_ISSUES.get(clip);
    if (!issues) {
        issues = validateDocument(clip).issues;
        CLIP_ISSUES.set(clip, issues);
    }
    return issues;
}

export function assertValidProjectDocument(doc: unknown, options?: ValidateOptions): void {
    const { valid, issues } = validateProjectDocument(doc, options);
    if (!valid) {
        const detail = issues.map((i) => `  ${i.path || "<root>"}: ${i.message}`).join("\n");
        throw new Error(`Invalid project document:\n${detail}`);
    }
}

/** For a caller with no UI to show issues in. */
export function assertValidDocument(doc: unknown, options?: ValidateOptions): ClipDocument {
    const { valid, issues } = validateDocument(doc, options);
    if (!valid) {
        const detail = issues.map((i) => `  ${i.path || "<root>"}: ${i.message}`).join("\n");
        throw new Error(`Invalid clip document:\n${detail}`);
    }
    return doc as ClipDocument;
}
