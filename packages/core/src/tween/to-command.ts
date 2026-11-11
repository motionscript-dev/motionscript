import { clamp01 } from "@/util/clamp";
import { EasingFunction } from "@/tween/ease/type";
import { Steppable, TweenStepper } from "@/tween/stepper";
import { Command } from "./command";

/** Implemented by a node (or other host) to be driven by {@link toCommand}: `_prepareStep` resolves one tween into a flat, mutation-driving {@link TweenStepper}, the primitive both the flat `parallel` fast path and the command's evaluation are built from. */
export interface AnimationTarget<P> {
    _prepareStep(props: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper;
}

/** The {@link Command} `node.to(...)` returns: one tween on one target, **single, not chainable** (sequencing is the timeline's: a command carries its own `at`). Implements {@link Command} and {@link Steppable} (the flat driver). `at` and `_stepper` each keep their **own** prepared stepper: preparing snapshots the tween's `from` from the live target, so two drivers must never fight over one mutable stepper. */
class ToCommand<P> implements Command<P>, Steppable {
    private atPrepared: TweenStepper | null = null;

    constructor(
        private readonly target: AnimationTarget<P>,
        private readonly props: Partial<P>,
        readonly duration: number,
        private readonly easing?: EasingFunction,
    ) { }

    /** The props this command writes at normalized `t`, applied as a side effect (direct cell writes through the prepared stepper, like `driveCommand`) rather than returned: only the target's `_prepareStep` knows how to apply a custom tween function or mapped prop correctly. */
    at(t: number): Partial<P> {
        if (!this.atPrepared) this.atPrepared = this.prepare();
        this.atPrepared.seek(clamp01(t) * this.duration);
        return {};
    }

    _stepper(): TweenStepper {
        return this.prepare();
    }

    private prepare(): TweenStepper {
        return this.target._prepareStep(this.props, this.duration, this.easing);
    }
}

export function toCommand<P>(
    target: AnimationTarget<P>,
    props: Partial<P>,
    duration: number,
    easing?: EasingFunction,
): Command<P> {
    return new ToCommand<P>(target, props, duration, easing);
}
