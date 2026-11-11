import { EasingFunction } from "@/tween/ease/type";
import { commandParallel, commandSequence, driveCommand, type Command } from "@/tween/command";
import { SizeConstraints } from "@/layout/constraints";
import type { Node2D, Node2DProps } from "./node2d";

/** Measures `child`'s natural size without attaching it to `parent`, so siblings don't shift for a frame. Uses the constraints and scope the parent retained from its last measure pass (`parent.lastMeasure`); `null` if it hasn't been measured yet (nothing on screen to reflow against). */
function measureDetached(parent: Node2D, child: Node2D): { width: number; height: number } | null {
    const pass = parent.lastMeasure;
    const scope = pass?.measurer;
    // The scope (text measurement) is the essential input and only exists once the parent has been laid out.
    if (!scope) return null;
    // Bounded by the parent's constraints, else its laid-out box, else unbounded (a hug child shrink-wraps regardless).
    const constraints: SizeConstraints = pass?.constraints ?? {
        maxWidth: parent.measuredWidth || Number.MAX_SAFE_INTEGER,
        maxHeight: parent.measuredHeight || Number.MAX_SAFE_INTEGER,
    };
    const size = child.measure(constraints, scope);
    return { width: size.width ?? 0, height: size.height ?? 0 };
}

/**
 * Companion for {@link Node2D}'s animated child management: the animated overloads, returned as {@link Command}s
 * built from `child.to(...)` with {@link commandSequence}/{@link commandParallel}. The sync variants stay inline on Node2D.
 *
 * Each command's setup (measuring, collapsing, attaching/detaching/reparenting) runs **lazily, once, on the first
 * evaluation**, not when the function is called. That is load-bearing: a caller often creates the command, lays the
 * parent out, then drives it, relying on a fresh `lastMeasure` when {@link addChildAtAnimated} measures; measuring
 * eagerly would read whatever scope the parent had at call time, often none.
 *
 * The container's `gap` is handled by the per-child `gapScale` tweened in parallel with the child's box (flex folds
 * each child's `gapScale` into its gap budget), so no helper needs the parent's axis or gap value.
 */

/**
 /** Fraction of an insert/remove's `duration` spent on size + gap motion; the rest is the opacity fade. Sequential phases (grow then fade in; fade out then shrink) keep a fading child from overlapping siblings that are still sliding. */
const SIZE_PHASE = 0.7;

/**
 * Animated `addChildAt`: inserts the child **already collapsed to 0**, then grows it in (opacity up, box 0 to its
 * natural size) so siblings slide over rather than jump; the mirror of {@link removeChildAtAnimated}.
 *
 * A `"hug"`/`"fill"` axis has no size until laid out, so it is measured **detached** ({@link measureDetached}) before
 * attaching, keeping siblings from seeing it at full width for a frame. The tween needs numeric endpoints, so the
 * original size token is restored when the command ends. With no retained scope (parent not yet measured) such an
 * axis keeps its authored token and fades in without a width tween.
 */
export function addChildAtAnimated(
    parent: Node2D,
    child: Node2D,
    index: number,
    duration: number,
    easing?: EasingFunction,
): Command<Record<string, never>> {
    let animation: Command<Node2DProps> | null = null;
    let isNumericW = false;
    let isNumericH = false;
    let origW: Node2DProps["width"];
    let origH: Node2DProps["height"];

    const setup = (): Command<Node2DProps> => {
        const targetOpacity = child.opacity;
        // Remember the authored size tokens to restore a hug/fill axis after the grow-in.
        origW = child.width;
        origH = child.height;
        isNumericW = typeof origW === "number";
        isNumericH = typeof origH === "number";

        // Pre-measure non-numeric axes while detached, so sizing can't shift existing siblings.
        const detached = isNumericW && isNumericH ? null : measureDetached(parent, child);

        // Grow-to target: the authored size for a numeric axis, else the detached measurement (no width tween if unmeasured).
        const tweenW = isNumericW || detached !== null;
        const tweenH = isNumericH || detached !== null;
        const targetW = isNumericW ? (origW as number) : (detached?.width ?? 0);
        const targetH = isNumericH ? (origH as number) : (detached?.height ?? 0);

        // Collapse tweenable axes to 0 before inserting so the child takes no room; `gapScale: 0` also suppresses its gap, so the flanking gap opens from 0.
        child.set({
            opacity: 0,
            gapScale: 0,
            ...(tweenW ? { width: 0 } : {}),
            ...(tweenH ? { height: 0 } : {}),
        } as Partial<Node2DProps>);
        parent.addChildAt({ data: { child, index } });

        const sizeProps: Partial<Node2DProps> = {};
        if (tweenW) sizeProps.width = targetW;
        if (tweenH) sizeProps.height = targetH;
        // Two sequential phases so the fading-in child never overlaps sliding siblings: open the box and gap (opacity held
        // at 0), then fade in. `gapScale` 0 -> 1 tracks the size so siblings slide continuously.
        const grow = duration * SIZE_PHASE;
        const fade = duration - grow;
        return commandSequence<Node2DProps>(
            child,
            commandParallel<Node2DProps>(
                child,
                child.to({ data: sizeProps, duration: grow, easing }),
                child.to({ data: { gapScale: 1 } as Partial<Node2DProps>, duration: grow, easing }),
            ),
            child.to({ data: { opacity: targetOpacity } as Partial<Node2DProps>, duration: fade, easing }),
        );
    };

    return driveCommand(duration, (t) => {
        if (!animation) animation = setup();
        animation.at(t);
        if (t >= 1) {
            // Restore any hug/fill token so the child reflows naturally from here; the tween already landed on its measured pixel size.
            const restore: Partial<Node2DProps> = {};
            if (!isNumericW) restore.width = origW;
            if (!isNumericH) restore.height = origH;
            if (!isNumericW || !isNumericH) child.set(restore as Partial<Node2DProps>);
        }
    });
}

/** Animated `removeChildAt`: fades and sizes the child out, then detaches it. The child stays in the tree until the end (`t === 1`), so a host seeking earlier sees it mid-fade; seeking back below the end re-attaches it at its original index, keeping the animation a function of `t` in both directions (as `packages/components/code`'s insert/remove). */
export function removeChildAtAnimated(
    parent: Node2D,
    index: number,
    duration: number,
    easing?: EasingFunction,
): Command<Record<string, never>> {
    let child: Node2D | null = null;
    let animation: Command<Node2DProps> | null = null;
    let setupDone = false;

    const setup = (): void => {
        setupDone = true;
        // Out of range: nothing to animate (`child`/`animation` stay null and every apply() is a no-op).
        if (index < 0 || index >= parent.children.length) return;
        child = parent.children[index];

        // Pin to the current rendered size so the shrink reflows siblings.
        const lw = child.measuredWidth;
        const lh = child.measuredHeight;
        child.set({ width: lw, height: lh } as Partial<Node2DProps>);

        // Mirror of the insert: fade out first (box held at full size), then collapse the box and close the gap (`gapScale` 1 -> 0).
        const fade = duration * (1 - SIZE_PHASE);
        const shrink = duration - fade;
        animation = commandSequence<Node2DProps>(
            child,
            child.to({ data: { opacity: 0 } as Partial<Node2DProps>, duration: fade, easing }),
            commandParallel<Node2DProps>(
                child,
                child.to({ data: { width: 0, height: 0 } as Partial<Node2DProps>, duration: shrink, easing }),
                child.to({ data: { gapScale: 0 } as Partial<Node2DProps>, duration: shrink, easing }),
            ),
        );
    };

    return driveCommand(duration, (t) => {
        if (!setupDone) setup();
        if (!animation || !child) return;
        const done = t >= 1;
        if (!done && child.parent !== parent) {
            // Seeking back into the animation after it reached the end: put the child back.
            parent.addChildAt({ data: { child, index: Math.min(index, parent.children.length) } });
        }
        animation.at(t);
        if (done) {
            parent.remove(child);
            // The same node can be re-added later (scenes reuse refs) and a plain addChild wouldn't reset `gapScale`; restore the default so a stale 0 can't swallow a gap.
            child.set({ gapScale: 1 } as Partial<Node2DProps>);
        }
    });
}

/** Animated `reparent`: fades and sizes the node out of its parent, then reparents and fades it in. The handoff is at the midpoint (`t === 0.5`); seeking across it either way moves the node between parents, as {@link removeChildAtAnimated}. */
export function reparentAnimated(
    node: Node2D,
    newParent: Node2D,
    duration: number,
    easing?: EasingFunction,
): Command<Record<string, never>> {
    const half = duration / 2;
    let animation: Command<Node2DProps> | null = null;
    let oldParent: Node2D | null = null;

    const setup = (): Command<Node2DProps> => {
        const targetOpacity = node.opacity;
        oldParent = node.parent;

        // Pin to the current rendered size so the exit shrink reflows the old parent.
        const lw = node.measuredWidth;
        const lh = node.measuredHeight;
        node.set({ width: lw, height: lh } as Partial<Node2DProps>);

        // One flat sequence (exit over the first half, enter over the second): `commandSequence` re-settles every prior phase
        // on each call, so the enter tweens' `from` is right even when a host seeks straight into the enter half.
        const exitFade = half * (1 - SIZE_PHASE);
        const exitShrink = half - exitFade;
        const enterGrow = half * SIZE_PHASE;
        const enterFade = half - enterGrow;
        return commandSequence<Node2DProps>(
            node,
            node.to({ data: { opacity: 0 } as Partial<Node2DProps>, duration: exitFade, easing }),
            commandParallel<Node2DProps>(
                node,
                node.to({ data: { width: 0, height: 0 } as Partial<Node2DProps>, duration: exitShrink, easing }),
                node.to({ data: { gapScale: 0 } as Partial<Node2DProps>, duration: exitShrink, easing }),
            ),
            commandParallel<Node2DProps>(
                node,
                node.to({ data: { width: lw, height: lh } as Partial<Node2DProps>, duration: enterGrow, easing }),
                node.to({ data: { gapScale: 1 } as Partial<Node2DProps>, duration: enterGrow, easing }),
            ),
            node.to({ data: { opacity: targetOpacity } as Partial<Node2DProps>, duration: enterFade, easing }),
        );
    };

    return driveCommand(duration, (t) => {
        if (!animation) animation = setup();
        const elapsed = t * duration;
        const inNewParent = elapsed >= half;
        if (inNewParent && node.parent !== newParent) {
            if (oldParent) oldParent.remove(node);
            newParent.add(node);
        } else if (!inNewParent && node.parent !== oldParent) {
            newParent.remove(node);
            if (oldParent) oldParent.add(node);
        }
        animation.at(t);
    });
}
