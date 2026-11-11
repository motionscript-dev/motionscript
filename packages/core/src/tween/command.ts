import { clamp01 } from "@/util/clamp";
import { EasingFunction } from "./ease/type";
import { loopPasses, loopPhase, loopSpan, type LoopSpec } from "./loop";
import { LerpFunction } from "./lerp";
import { Steppable, TweenStepper } from "./stepper";

/** A named animation as a value: `at(t)` is a pure function of normalized time, so a host can ask what frame N looks like without replaying 0..N-1. Pure only once *built* (a factory reads the node's current props to fix its start), so out-of-order evaluation must build commands in timeline order. */
export interface Command<P = Record<string, unknown>> extends Steppable {
    readonly duration: number;
    at(t: number): Partial<P>;
}

/** The single argument a `command()` method takes: its own params under `data` plus shared timing, one object so a manifest can read a command's shape off `T`. `duration`/`data` are optional for synchronous or data-free commands. `R` differs from `T` when `data` is loose author input (`Fill`) but `lerp` works on its resolved form. */
export interface CommandArgs<T = Record<string, unknown>, R = T> {
    data?: T;
    duration?: number;
    easing?: EasingFunction;
    lerp?: LerpFunction<R>;
}

const SETTLES = Symbol("settles");

/** Marks a command whose `at` reads only what it captured when built and only writes prop slots, end values all at `at(1)`, so a timeline may hold it finished by writing those instead of running it (see `document/settled-index`). */
export function settling<C extends { at(t: number): unknown }>(command: C): C {
    (command as unknown as Record<symbol, boolean>)[SETTLES] = true;
    return command;
}

export function settles(command: { at(t: number): unknown }): boolean {
    return (command as unknown as Record<symbol, boolean>)[SETTLES] === true;
}

export function isCommand(x: unknown): x is Command {
    return typeof (x as Command)?.at === "function"
        && typeof (x as Command)?.duration === "number";
}

/** What a {@link Command} writes its evaluated props onto. */
export interface CommandTarget<P> {
    set(props: Partial<P>): void;
}

/** Build a {@link Command} from a pure `t → props` function. `easing` is applied inside, so `at` itself takes raw normalized time. */
export function makeCommand<P>(
    target: CommandTarget<P>,
    at: (t: number) => Partial<P>,
    duration: number,
    easing?: EasingFunction,
): Command<P> {
    const value = (t: number): Partial<P> => at(easing ? easing(clamp01(t)) : clamp01(t));
    return fromValue(target, duration, value);
}

/** A {@link Command} whose product is a side effect (state a `set()` can't reach). `apply` must be a pure function of `t`: it runs for any `t`, any number of times, in any order, so accumulating (`x += …`) drifts the instant anything scrubs. */
export function driveCommand(
    duration: number,
    apply: (t: number) => void,
    easing?: EasingFunction,
): Command<Record<string, never>> {
    const sink: CommandTarget<Record<string, never>> = { set: () => { } };
    return makeCommand(sink, (t) => {
        apply(t);
        return {};
    }, duration, easing);
}

/** Repeats `command` as one seekable {@link Command} lasting every pass. Wrapping works for every command: the inner one is asked for a pass-local `t`, and its easing applies per pass (three bounces, not one ease over three). `fill` is the seconds an unlimited loop may cover (default one pass). A stamp (`duration === 0`) is returned untouched. */
export function loopCommand<P>(command: Command<P>, loop: LoopSpec, fill?: number): Command<P> {
    const one = command.duration;
    if (one <= 0 || loopPasses(loop) <= 1) return command;
    const duration = loopSpan(loop, one, fill);
    const value = (t: number): Partial<P> => command.at(loopPhase(loop, clamp01(t) * duration, one));

    return {
        duration,
        at: value,
        _stepper(): TweenStepper {
            let elapsed = 0;
            return {
                seek: (e: number) => {
                    elapsed = e;
                    value(e / duration);
                },
                advance: (dt: number): boolean => {
                    elapsed += dt;
                    const done = elapsed >= duration;
                    value(done ? 1 : elapsed / duration);
                    return done;
                },
            };
        },
    };
}

/** Runs `commands` one after another as a single seekable {@link Command}; a finished child holds at `at(1)`, so an early-written prop keeps its value. */
export function commandSequence<P>(
    target: CommandTarget<P>,
    ...commands: Command<P>[]
): Command<P> {
    const duration = commands.reduce((sum, c) => sum + c.duration, 0);

    return fromValue(target, duration, (t) => {
        const elapsed = t * duration;
        const props: Partial<P> = {};
        let cursor = 0;
        for (const command of commands) {
            if (elapsed < cursor) break;
            const local = command.duration > 0 ? (elapsed - cursor) / command.duration : 1;
            Object.assign(props, command.at(clamp01(local)));
            cursor += command.duration;
        }
        return props;
    });
}

/** Run `commands` together as one {@link Command}, ending when the longest does. Later commands win on a shared prop. */
export function commandParallel<P>(
    target: CommandTarget<P>,
    ...commands: Command<P>[]
): Command<P> {
    const duration = commands.reduce((max, c) => Math.max(max, c.duration), 0);

    return fromValue(target, duration, (t) => {
        const elapsed = t * duration;
        const props: Partial<P> = {};
        for (const command of commands) {
            const local = command.duration > 0 ? elapsed / command.duration : 1;
            Object.assign(props, command.at(clamp01(local)));
        }
        return props;
    });
}

function fromValue<P>(
    target: CommandTarget<P>,
    duration: number,
    value: (t: number) => Partial<P>,
): Command<P> {
    const progress = (elapsed: number): number => (duration > 0 ? elapsed / duration : 1);

    return {
        duration,
        // Writes as well as returns: a host evaluating a timeline calls `at(t)` and discards the result, so a command that only *described* its frame was inert wherever a document is seeked.
        at(t: number): Partial<P> {
            const props = value(t);
            target.set(props);
            return props;
        },

        _stepper(): TweenStepper {
            let elapsed = 0;
            return {
                seek: (e: number) => {
                    elapsed = e;
                    target.set(value(progress(e)));
                },
                advance: (dt: number): boolean => {
                    elapsed += dt;
                    const done = elapsed >= duration;
                    target.set(value(done ? 1 : progress(elapsed)));
                    return done;
                },
            };
        },
    };
}
