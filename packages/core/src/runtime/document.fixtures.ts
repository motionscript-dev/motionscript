/**
 * Test-only builders: documents written in a line, a probe node that records what the runtime does to it, and
 * runtime objects wired over the fakes in `runtime.fixtures.ts`. Excluded from the published build via
 * `src/**\/*.fixtures.ts` in tsconfig.
 */
import type { AssetCatalog } from "@/assets/catalog";
import type { AssetScope } from "@/assets/scope";
import type { ProjectDocument, Track } from "@/document/project";
import { Registry } from "@/document/registry";
import {
    documentDuration,
    type ClipDocument,
    type CommandSpec,
    type CompositionDocument,
    type EaseSpec,
    type NodeSpec,
    type StillDocument,
    type TimedNodeSpec,
} from "@/document/types";
import type { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { RenderPass2D } from "@/render/render-context2d";
import type { RuntimeScope } from "@/runtime/clip-instance";
import { PlaybackController, type ControllerParams } from "@/runtime/playback-controller";
import { AssetTimeline, type AssetTimelineOptions } from "@/runtime/asset-timeline";
import { StateEvaluator } from "@/runtime/state-evaluator";
import {
    FakeAssetCatalog,
    FakeAudioSink,
    FakeClock,
    FakeMeasureContext,
    FakeRenderContext,
    FakeStorageAdapter,
    asCatalog,
    asRenderContext,
    asStorage,
} from "@/runtime/runtime.fixtures";

export const FPS = 10;
export const VIEWPORT = { width: 200, height: 100 };

export function node(
    id: string,
    type: string,
    props: Record<string, unknown> = {},
    parentId: string | null = null,
    layerOrder = 0,
): NodeSpec {
    return { id, type, parentId, layerOrder, props };
}

export function still(...nodes: NodeSpec[]): StillDocument {
    return { kind: "still", nodes };
}

/** `type` defaults to `"to"`; `target: null` is the root. */
export interface CommandStep {
    target: string | null;
    type?: string;
    args: Record<string, unknown>;
    duration?: number;
    easing?: EaseSpec;
}

/** After the previous one ends, a number of seconds to hold, or commands that start together. */
export type Step = CommandStep | number | readonly CommandStep[];

/**
 * `nodes` as given (present from 0 unless they carry a span), then `steps` placed the way a chain places them.
 * Its `duration` is the chain's total, so a trailing hold counts; pass one to override.
 */
export function comp(nodes: TimedNodeSpec[], steps: readonly Step[] = [], duration?: number): CompositionDocument {
    const commands: CommandSpec[] = [];
    let at = 0;
    let n = 0;
    for (const step of steps) {
        if (typeof step === "number") {
            at += step;
            continue;
        }
        let longest = 0;
        for (const s of (Array.isArray(step) ? step : [step]) as CommandStep[]) {
            const length = s.duration ?? 0;
            commands.push({
                id: `c${n++}`,
                type: s.type ?? "to",
                targetId: s.target,
                at,
                duration: length,
                ...(s.easing && { easing: s.easing }),
                args: s.args,
            });
            longest = Math.max(longest, length);
        }
        at += longest;
    }
    const total = duration ?? (at > 0 ? at : undefined);
    return { kind: "composition", nodes, commands, ...(total !== undefined && { duration: total }) };
}

export function track(id: string, clip: ClipDocument, over: Partial<Track> = {}): Track {
    return { id, clip, duration: documentDuration(clip), ...over };
}

export function project(tracks: Track[], over: Partial<ProjectDocument> = {}): ProjectDocument {
    return { kind: "project", name: "Test", fps: FPS, viewport: VIEWPORT, tracks, ...over };
}

export interface ProbeLog {
    renders: number;
    /** Once per frame asset refinement declares the probe at. */
    declares: number;
    renderTimes: number[];
    /** One per build of the row holding it. */
    constructed: string[];
}

/**
 * A rect that records what the runtime does to it, and declares whatever `onDeclare` asks each time its assets
 * are collected.
 */
export function probeRegistry(
    onDeclare?: (assets: AssetScope, call: number) => void,
): { registry: Registry; log: ProbeLog } {
    const log: ProbeLog = { renders: 0, declares: 0, renderTimes: [], constructed: [] };
    /**
     * The generated Rect class, so a subclass keeps its own members (a subclass of the component value would not).
     */
    class Probe extends (Rect.node as unknown as typeof Node2D) {
        constructor(props?: ConstructorParameters<typeof Node2D>[0]) {
            super(props);
            log.constructed.push(this.id);
        }

        protected override renderContent(pass: RenderPass2D): void {
            log.renders++;
            log.renderTimes.push(this.time.elapsed);
            super.renderContent(pass);
        }

        override declareAssets(assets: AssetScope): void {
            super.declareAssets(assets);
            onDeclare?.(assets, log.declares);
            log.declares++;
        }
    }
    return { registry: new Registry({ nodes: { probe: Probe as never } }), log };
}

export function runtimeScope(over: Partial<RuntimeScope> = {}): RuntimeScope {
    return {
        registry: new Registry(),
        viewport: VIEWPORT,
        fps: FPS,
        assets: asCatalog(new FakeAssetCatalog()),
        measurer: new FakeMeasureContext(),
        ...over,
    };
}

function scopeFor(doc: ProjectDocument, over: Partial<RuntimeScope>): RuntimeScope {
    return runtimeScope({
        ...(doc.fps !== undefined && { fps: doc.fps }),
        ...(doc.viewport !== undefined && { viewport: doc.viewport }),
        ...over,
    });
}

export function evaluatorFor(doc: ProjectDocument, over: Partial<RuntimeScope> = {}): StateEvaluator {
    return new StateEvaluator(doc, scopeFor(doc, over));
}

export function precompFor(doc: ProjectDocument, over: Partial<RuntimeScope> = {}, options?: AssetTimelineOptions): AssetTimeline {
    return new AssetTimeline(doc, scopeFor(doc, over), options);
}

export interface OpenedController {
    controller: PlaybackController;
    clock: FakeClock;
    audio: FakeAudioSink;
    storage: FakeStorageAdapter;
    rc: FakeRenderContext;
}

/** `doc` gets the fixture fps and viewport if it has none of its own. */
export function openController(
    doc: ProjectDocument,
    over: Partial<Omit<ControllerParams, "assets">> & { assets?: AssetCatalog } = {},
): OpenedController {
    const clock = new FakeClock();
    const audio = new FakeAudioSink();
    const storage = new FakeStorageAdapter();
    const rc = new FakeRenderContext();
    const controller = new PlaybackController({
        project: { ...doc, fps: doc.fps ?? FPS, viewport: doc.viewport ?? VIEWPORT },
        registry: new Registry(),
        renderContext: asRenderContext(rc),
        measurer: new FakeMeasureContext(),
        storageAdapter: asStorage(storage),
        masterClock: clock,
        audioDevice: audio,
        assets: asCatalog(new FakeAssetCatalog()),
        ...over,
    });
    return { controller, clock, audio, storage, rc };
}
