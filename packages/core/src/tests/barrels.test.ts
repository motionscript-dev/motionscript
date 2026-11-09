import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { expressionOps } from "../document/expression/ops";
import { ExpressionError } from "../document/expression/types";
import * as component from "../component";

// The barrels are loaded by a dynamic import with a computed specifier: lint
// forbids importing an index file from a non-barrel (and the type surface is
// checked separately, below), the same route `sdk-parity.test.ts` takes.
const here = dirname(fileURLToPath(import.meta.url));
const load = (path: string): Promise<Record<string, unknown>> =>
    import(/* @vite-ignore */ pathToFileURL(resolve(here, path)).href) as Promise<Record<string, unknown>>;

let core: Record<string, unknown>;
let sdk: Record<string, unknown>;

beforeAll(async () => {
    [core, sdk] = await Promise.all([load("../index.ts"), load("../sdk/index.ts")]);
}, 60_000);

type Sdk = typeof import("../sdk/index");
type Root = typeof import("../index");

/** Mentions types in a value position, so the typecheck fails if one is not exported. */
const typesOf = <T extends unknown[]>(): T | undefined => undefined;

/**
 * Which names each barrel carries, for the capabilities whose specs state it:
 * the document model (001), expressions (002), the timeline (003), commands and
 * tweens (004) and dynamic nodes (014). `sdk-parity.test.ts` checks that the
 * published SDK and this curated surface agree; this checks what is on them.
 */

const has = (barrel: object, name: string): boolean => name in barrel;
const missing = (barrel: object, names: readonly string[]): string[] => names.filter((name) => !has(barrel, name));
const present = (barrel: object, names: readonly string[]): string[] => names.filter((name) => has(barrel, name));

describe("the document model", () => {
    const ON_CORE = [
        "validateDocument", "assertValidDocument", "validateProjectDocument", "assertValidProjectDocument",
        "Registry", "getNodeDescriptor", "NODE_META",
        "isStillDocument", "isCompositionDocument", "isAudioDocument", "hasTimeline", "isProjectDocument",
        "asProjectDocument", "documentDuration", "commandSpan", "nodeSpan", "effectiveSpan", "effectiveSpans",
        "untimed", "ROOT_NODE_ID",
        "DOCUMENT_FORMAT_VERSION", "DOCUMENT_MIGRATIONS", "DocumentTooNewError", "documentFormatVersion", "migrateDocument",
        "migrateNodeProps", "missingNodeOf",
        "PropSlot", "getPropSlot", "getPropertyMeta",
    ];
    const ON_SDK = [
        "validateDocument", "assertValidDocument", "Registry",
        "isProjectDocument", "asProjectDocument", "documentDuration", "commandSpan", "hasTimeline",
        "nodeSpan", "effectiveSpan", "untimed", "ROOT_NODE_ID",
        "DOCUMENT_FORMAT_VERSION", "DocumentTooNewError", "documentFormatVersion", "migrateDocument", "migrateNodeProps", "missingNodeOf",
    ];
    /** The class-era authoring surface: core keeps what its own classes and the factory call, and no barrel carries it. */
    const SEALED = [
        "node", "property", "command", "driveCommand",
        "Node", "Node2D", "Node3D", "NodeAudio",
        "PaintNode", "ShapeNode", "TextBase", "RectBase", "EllipseBase", "PathBase", "PathShapeBase",
        "PolygonBase", "PolygramBase", "Mesh3DBase", "Canvas3DBase",
    ];
    const TYPED = [
        "fillProperty", "strokeProperty", "shadowProperty", "effectsProperty", "colorProperty",
        "cornerRadiusProperty", "cornerStyleProperty", "insetsProperty", "alignmentProperty",
        "vector2Property", "pathProperty", "sizeProperty", "textProperty", "flowProperty",
        "vector3Property", "euler3Property", "quaternionProperty", "audioParamProperty", "audioEffectsProperty",
    ];
    const INTERNAL = [
        "installBuiltins", "DENIED_GLOBALS", "indexDocument", "diffClip", "commandTraits", "jsonEqual",
        "planTimelinePatch", "resolveEase", "MIN_REBUILD_NODES",
    ];

    it("resolves its names from the root barrel", () => {
        expect(missing(core, ON_CORE)).toEqual([]);
    });

    it("resolves the curated names from /sdk", () => {
        expect(missing(sdk, ON_SDK)).toEqual([]);
    });

    it("carries no typed property on either barrel: they declare a class's props", () => {
        expect(present(core, TYPED)).toEqual([]);
        expect(present(sdk, TYPED)).toEqual([]);
    });

    it("keeps the registration functions off both barrels: a node type is a component", () => {
        expect(present(sdk, SEALED)).toEqual([]);
        expect(present(core, ["node", "withdraw", "property", "command", "declareMembers"])).toEqual([]);
    });

    it("keeps the internal modules off both barrels", () => {
        expect(present(core, INTERNAL)).toEqual([]);
        expect(present(sdk, INTERNAL)).toEqual([]);
    });

    it("hands the SDK the same function as the root for every shared name", () => {
        for (const name of ON_SDK) {
            expect(sdk[name], name).toBe(core[name]);
        }
    });

    it("keeps the engine and its session off /sdk", () => {
        expect(present(sdk, ["Engine", "Session", "ClipTimeline", "PropSlot", "getPropSlot"])).toEqual([]);
    });

    // Whether the SDK carries the project validators and the descriptor types is undecided.
    it.todo("settles whether /sdk exports validateProjectDocument and assertValidProjectDocument");
});

describe("expressions", () => {
    const OPS = [
        "isSource", "unescape", "parse", "tryParse", "compile", "bind", "bindProps",
        "collect", "renameRefs", "functions", "constants", "dialect",
    ];

    it("exports expressionOps and ExpressionError from the root and /sdk", () => {
        for (const barrel of [core, sdk]) {
            expect(missing(barrel, ["expressionOps", "ExpressionError"])).toEqual([]);
            expect(barrel.expressionOps).toBe(expressionOps);
            expect(barrel.ExpressionError).toBe(ExpressionError);
        }
    });

    it("carries the whole operation set on expressionOps", () => {
        expect(Object.keys(expressionOps).sort()).toEqual([...OPS].sort());
    });

    it("keeps the reference helpers internal", () => {
        expect(present(core, ["expressionRefs", "splitNodeRef"])).toEqual([]);
        expect(present(sdk, ["expressionRefs", "splitNodeRef"])).toEqual([]);
    });

    it("throws an ExpressionError that is an Error", () => {
        const failure = (() => { try { expressionOps.parse("=4+"); } catch (e) { return e; } })();
        expect(failure).toBeInstanceOf(core.ExpressionError as typeof ExpressionError);
        expect(failure).toBeInstanceOf(Error);
    });
});

describe("the timeline", () => {
    it("exports commandSpan, documentDuration and hasTimeline from the root and /sdk", () => {
        for (const barrel of [core, sdk]) {
            expect(missing(barrel, ["commandSpan", "documentDuration", "hasTimeline"])).toEqual([]);
        }
    });

    it("exports ClipTimeline from the root alone", () => {
        expect(has(core, "ClipTimeline")).toBe(true);
        expect(has(sdk, "ClipTimeline")).toBe(false);
    });

    it("exports none of the planner or the ease resolver from any barrel", () => {
        const internal = ["planTimelinePatch", "MIN_REBUILD_NODES", "resolveEase", "TimelinePatch"];
        expect(present(core, internal)).toEqual([]);
        expect(present(sdk, internal)).toEqual([]);
        expect(present(component, internal)).toEqual([]);
    });
});

describe("commands, tweens and easing", () => {
    const CURATED = [
        "lerpNumber", "getCommandMeta", "isCommand", "makeCommand",
        "commandSequence", "commandParallel", "loopCommand", "linear", "easeIn", "easeOut", "easeInOut",
        "commandSpan",
    ];
    const CORE_ONLY = [
        "toCommand", "curveEase", "curveSegments", "curveSegmentT", "isEaseCurve",
        "loopPasses", "loopRepeats", "loopSpan", "loopPhase", "lerpPerspective",
        "prepareNumericTween", "prepareNumericCellTween", "isSteppable", "DEFAULT_EASE", "COMMAND_META",
    ];

    it("carries the curated set on the root and /sdk", () => {
        expect(missing(core, CURATED)).toEqual([]);
        expect(missing(sdk, CURATED)).toEqual([]);
    });

    it("carries the rest of tween/ on the root only", () => {
        expect(missing(core, CORE_ONLY)).toEqual([]);
        expect(present(sdk, CORE_ONLY)).toEqual([]);
    });

    it("leaves the inert command and stepper on no barrel", () => {
        const inert = ["inertCommand", "inertStepper"];
        expect(present(core, inert)).toEqual([]);
        expect(present(sdk, inert)).toEqual([]);
        expect(present(component, inert)).toEqual([]);
    });

    it("carries no seekable composition on any barrel: a component command returns timeline pieces", () => {
        const seekable = ["at", "sequence", "together", "drive", "compose", "asCommand", "declarePaints"];
        for (const barrel of [core, sdk, component]) expect(present(barrel, seekable)).toEqual([]);
        expect(present(component, ["hold"])).toEqual([]);
    });

    it("carries `hold`, the audio curve, on the root and /sdk", () => {
        expect(sdk.hold).toBe(core.hold);
        expect(core.hold).toBeTypeOf("function");
    });
});

describe("dynamic nodes", () => {
    it("exports Registry and Engine from the root", () => {
        expect(missing(core, ["Registry", "Engine"])).toEqual([]);
    });

    it("exports Registry from /sdk, and neither node, the engine nor its options", () => {
        expect(missing(sdk, ["Registry"])).toEqual([]);
        expect(present(sdk, ["node", "Engine", "Session"])).toEqual([]);
    });

    it("keeps the denied-globals list and the config resolver off every barrel", () => {
        for (const barrel of [core, sdk, component]) {
            expect(present(barrel, ["DENIED_GLOBALS", "resolveDynamicNodes"])).toEqual([]);
        }
    });
});

/**
 * Types are erased at run time, so these are checked by `tsc` through the
 * test-inclusive tsconfig: a missing export is a compile error, not a failure here.
 */
describe("type exports", () => {
    it("resolves the document and registry types from /sdk", () => {
        expect(typesOf<[
            import("../sdk/index").ProjectDocument, import("../sdk/index").Track,
            import("../sdk/index").VisualDocument, import("../sdk/index").ClipDocument,
            import("../sdk/index").StillDocument, import("../sdk/index").CompositionDocument,
            import("../sdk/index").AudioDocument, import("../sdk/index").NodeSpec,
            import("../sdk/index").TimedNodeSpec, import("../sdk/index").NodeSpan,
            import("../sdk/index").CommandSpec, import("../sdk/index").EaseSpec,
            import("../sdk/index").LoopSpec, import("../sdk/index").LoopDirection,
            import("../sdk/index").VariableSpec, import("../sdk/index").ValidationIssue,
            import("../sdk/index").ValidationResult, import("../sdk/index").RegistryOptions,
            import("../sdk/index").NodeTypeMap, import("../sdk/index").ShaderPackMap,
            import("../sdk/index").NodeTypeRecord, import("../sdk/index").NodeCommandEntry,
            import("../sdk/index").NodeConstructor, import("../sdk/index").CommandFactory,
            import("../sdk/index").CommandTypeEntry, import("../sdk/index").VariableCommandFactory,
            import("../sdk/index").VariableLerp, import("../sdk/index").VariableTarget,
            import("../sdk/index").Theme, import("../sdk/index").ColorTokens,
            import("../sdk/index").Typography, import("../sdk/index").TypographyPreset,
        ]>()).toBeUndefined();
    });

    it("resolves the expression and tween types from /sdk", () => {
        expect(typesOf<[
            import("../sdk/index").ParsedExpression, import("../sdk/index").ExpressionNode,
            import("../sdk/index").ExpressionDialect, import("../sdk/index").VariableResolver,
            import("../sdk/index").Command, import("../sdk/index").CommandArgs,
            import("../sdk/index").CommandMeta, import("../sdk/index").CommandOptions,
            import("../sdk/index").AnimationTarget<unknown>, import("../sdk/index").Steppable,
            import("../sdk/index").TweenStepper, import("../sdk/index").LerpFunction<number>,
            import("../sdk/index").TweenOptions<number>, import("../sdk/index").EasingFunction,
            import("../sdk/index").EaseParams, import("../sdk/index").StandardEase,
        ]>()).toBeUndefined();
    });

    it("resolves the host-side types from the root", () => {
        expect(typesOf<[
            import("../index").CompiledProps, import("../index").CompiledValue,
            import("../index").DynamicNodeConfig, import("../index").EngineOptions,
            import("../index").ExpressionSite, import("../index").FnArity,
            import("../index").NodePropertyDescriptor, import("../index").NodeTypeDescriptor,
            import("../index").PlacedCommandInfo,
        ]>()).toBeUndefined();
    });

    it("keeps the value barrels the shape the types describe", () => {
        // `Sdk` and `Root` are the namespaces' own types: a name moved off one is caught above.
        const names: Array<keyof Sdk & keyof Root> = ["Registry", "expressionOps", "commandSpan"];
        for (const name of names) expect(sdk[name]).toBe(core[name]);
    });
});
