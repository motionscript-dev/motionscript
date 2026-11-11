/**
 * The reference the asset index is held to: a walk that declares every frame. Excluded from the published
 * build via `src/**\/*.fixtures.ts` in tsconfig.
 */
import { AssetIndex, type AssetSegment } from "@/assets/asset-index";
import type { AssetRecord } from "@/assets/record";
import { AssetDeclaration, type AssetDecl } from "@/assets/scope";
import type { ClipDocument } from "@/document/types";
import { bindDetached, declareNode } from "@/components/trees/node/node-walk";
import { ClipInstance, type RuntimeScope } from "./clip-instance";
import { frameTime, trackFrameCount } from "./placement";

/** The exact answer refinement must reproduce. Throws what the clip throws. */
export function walkedAssetRecords(
    clip: ClipDocument,
    duration: number,
    scope: RuntimeScope,
): ReadonlyMap<string, AssetRecord> {
    const frameCount = trackFrameCount(duration, scope.fps);
    const instance = new ClipInstance(clip, duration, scope);
    try {
        instance.build();
        const windows = new Map<string, AssetSegment>();
        for (let frame = 0; frame < frameCount; frame++) {
            const seconds = frameTime(frame, scope.fps, duration);
            instance.attach(seconds);
            instance.evaluateAt(seconds);
            instance.layout();
            // Per node, with its subtree sources bound to it, as refinement declares.
            instance.forEachOwner((node) => {
                const declaration = new AssetDeclaration(scope.assets, { bindSubtree: (sub) => bindDetached(node, sub) });
                declareNode(node, declaration);
                for (const [key, decl] of declaration.declarations) widen(windows, key, decl, frame);
            });
        }
        const index = new AssetIndex(frameCount);
        index.setOwner("walk", [...windows.values()]);
        return index.records();
    } finally {
        instance.dispose();
    }
}

function widen(windows: Map<string, AssetSegment>, key: string, decl: AssetDecl, frame: number): void {
    const hit = windows.get(key);
    if (!hit) {
        windows.set(key, { key, decl, startFrame: frame, endFrame: frame });
        return;
    }
    hit.startFrame = Math.min(hit.startFrame, frame);
    hit.endFrame = Math.max(hit.endFrame, frame);
}
