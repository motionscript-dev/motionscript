import { TweenStepper } from "./stepper";
import type { Command } from "./command";

/** An animation that occupies its duration and writes nothing: what a command on an **unmounted** node becomes. Such a node has no box, surface or timeline, but the timeline slot it was placed in is entitled to its duration; a real command of the right length keeps the scene's timing where throwing would abort the pass and returning nothing would silently shorten it. The failure (animating a node the author forgot to `add`) reads as "nothing moved", which is what shows on screen anyway. */
export function inertCommand<P>(target: object, duration: number): Command<P> {
    void target;
    return {
        duration,
        at: () => ({}) as Partial<P>,
        _stepper: () => inertStepper(duration),
    };
}

/** The {@link TweenStepper} half of {@link inertCommand}: runs its clock, writes nothing. */
export function inertStepper(duration: number): TweenStepper {
    let elapsed = 0;
    return {
        seek: (e: number) => { elapsed = e; },
        advance: (dt: number): boolean => {
            elapsed += dt;
            return elapsed >= duration;
        },
    };
}
