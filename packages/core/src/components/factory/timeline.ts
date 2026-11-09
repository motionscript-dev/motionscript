import type { Node } from "@/components/trees/node/node";
import { getCommandMeta } from "@/tween/command-decorator";
import { driveCommand, settles, settling, type Command, type CommandArgs } from "@/tween/command";
import type { EasingFunction } from "@/tween/ease/type";
import type { NodeView, Piece, PieceData, SoundOptions, Timeline } from "@/components/factory/api";
import type { ComponentHost } from "@/components/factory/views";

const piece = (data: PieceData): Piece => ({ _piece: data });

/** What a command is handed for one placement: its args and timing, and the builders for its pieces. */
export function makeTimeline(args: object, duration: number, easing: EasingFunction | undefined, node: NodeView): Timeline<any, any> {
    return {
        args,
        duration,
        easing,
        node,
        tween: (targets) => piece({ kind: "tween", targets: targets as Record<string, unknown> }),
        animate: (frame, options) => piece({ kind: "animate", frame: frame as (t: number) => Record<string, unknown>, eased: options?.eased !== false }),
        ease: (t) => (easing ? easing(t) : t),
        sound: (src, options) => piece({ kind: "sound", src, options: options ?? {} }),
        wait: (seconds) => piece({ kind: "wait", seconds }),
        together: (pieces) => piece({ kind: "together", pieces }),
        sequence: (pieces) => piece({ kind: "sequence", pieces }),
        stagger: (pieces, options) => piece({ kind: "stagger", pieces, overlap: options?.overlap ?? 0 }),
    };
}

/** A sound a command plays, in seconds from the command's start; `until` absent plays to its own end. */
export interface CommandSound {
    readonly at: number;
    readonly until: number | undefined;
    readonly src: string;
    readonly options: SoundOptions;
}

/** A built piece: how long it lasts, the frame it writes `elapsed` seconds in, whether that only tweens slots, and its sounds. */
interface Timed {
    readonly duration: number;
    readonly settles: boolean;
    readonly sounds: readonly CommandSound[];
    apply(elapsed: number): void;
}

const SILENT: readonly CommandSound[] = [];

/**
 * A leaf, built and run to its end at once, so the piece after it reads where
 * it finished — the rule the timeline already keeps between whole commands.
 */
function leaf(command: Command<Record<string, unknown>>, duration: number, pure = true): Timed {
    command.at(1);
    return { duration, settles: pure, sounds: SILENT, apply: (elapsed) => command.at(duration > 0 ? elapsed / duration : 1) };
}

function placed(parts: readonly Timed[], offsets: readonly number[]): Timed {
    const duration = parts.reduce((max, part, i) => Math.max(max, offsets[i] + part.duration), 0);
    return {
        duration,
        settles: parts.every((part) => part.settles),
        sounds: parts.flatMap((part, i) => part.sounds.map((s) => ({
            ...s, at: s.at + offsets[i], until: s.until === undefined ? undefined : s.until + offsets[i],
        }))),
        apply(elapsed) {
            // A part that hasn't started writes nothing: what came before it stands.
            for (let i = 0; i < parts.length; i++) {
                if (elapsed < offsets[i]) continue;
                parts[i].apply(Math.min(elapsed - offsets[i], parts[i].duration));
            }
        },
    };
}

/** A piece built against the tree as the pieces before it left it, spread over `duration`. */
function timedOf(host: ComponentHost, p: Piece, duration: number, easing: EasingFunction | undefined): Timed {
    const data = p._piece;
    switch (data.kind) {
        case "tween":
            return leaf(host.to({ data: data.targets, duration, easing }) as Command<Record<string, unknown>>, duration);
        case "animate":
            return leaf(host._animate(data.frame, duration, data.eased ? easing : undefined) as Command<Record<string, unknown>>, duration);
        case "child":
            return leaf((data.node as Node).to({ data: data.targets, duration, easing }) as Command<Record<string, unknown>>, duration);
        case "run": {
            // Any command of the child's, so it settles only if that one does.
            const run = runCommand(data.node as Node, data.name, data.args, duration, easing);
            return leaf(run, duration, settles(run));
        }
        case "wait":
            return { duration: data.seconds, settles: true, sounds: SILENT, apply: () => { } };
        case "sound":
            // Scheduled ahead of time, not written per frame: the clip's audio reads it off the built command.
            return { duration: 0, settles: true, sounds: data.src ? [{ at: 0, until: undefined, src: data.src, options: data.options }] : SILENT, apply: () => { } };
        case "together": {
            const parts = data.pieces.map((part) => timedOf(host, part, duration, easing));
            return placed(parts, parts.map(() => 0));
        }
        case "sequence": {
            // Untimed pieces share what fixed `wait`s leave of the span.
            const fixed = data.pieces.reduce((sum, part) => sum + (part._piece.kind === "wait" ? part._piece.seconds : 0), 0);
            const flexible = data.pieces.filter((part) => part._piece.kind !== "wait").length;
            const each = flexible > 0 ? Math.max(0, duration - fixed) / flexible : 0;
            const parts: Timed[] = [];
            const offsets: number[] = [];
            let cursor = 0;
            for (const part of data.pieces) {
                const timed = timedOf(host, part, each, easing);
                parts.push(timed);
                offsets.push(cursor);
                cursor += timed.duration;
            }
            return placed(parts, offsets);
        }
        case "stagger": {
            const n = data.pieces.length;
            if (n === 0) return { duration, settles: true, sounds: SILENT, apply: () => { } };
            const step = 1 - Math.min(1, Math.max(0, data.overlap));
            // n pieces, each `each` long, started `each * step` apart, span the command exactly.
            const each = duration / (1 + (n - 1) * step);
            const parts = data.pieces.map((part) => timedOf(host, part, each, easing));
            return placed(parts, parts.map((_, i) => i * each * step));
        }
    }
}

function runCommand(node: Node, name: string, args: object | undefined, duration: number, easing: EasingFunction | undefined): Command<Record<string, unknown>> {
    const meta = getCommandMeta(node).find((m) => m.key === name);
    const method = meta ? (node as unknown as Record<string, unknown>)[meta.method] : undefined;
    if (typeof method !== "function") throw new Error(`${node.className} has no command "${name}".`);
    const built = (method as (args: CommandArgs) => unknown).call(node, { data: (args ?? {}) as Record<string, unknown>, duration, easing });
    if (!built || typeof built !== "object" || !("at" in built)) throw new Error(`${node.className}.${name} did not return a command.`);
    return built as Command<Record<string, unknown>>;
}

const SOUNDS = new WeakMap<object, { readonly host: Node; readonly sounds: readonly CommandSound[] }>();

/** The sounds a built command plays, and the node playing them. */
export function commandSoundsOf(command: object): { readonly host: Node; readonly sounds: readonly CommandSound[] } | undefined {
    return SOUNDS.get(command);
}

/** The command a component's function returned, as the timeline places it. */
export function commandOf(host: ComponentHost, p: Piece, duration: number, easing: EasingFunction | undefined): Command<Record<string, unknown>> {
    // A lone tween is the engine's own `to`, exactly as a class's command would return it.
    if (p._piece.kind === "tween") return settling(host.to({ data: p._piece.targets, duration, easing }) as Command<Record<string, unknown>>);
    const timed = timedOf(host, p, duration, easing);
    const command = driveCommand(duration, (t) => timed.apply(t * duration)) as unknown as Command<Record<string, unknown>>;
    // A sound is cut when its command ends; a command with no length lets it play out.
    const sounds = timed.sounds.map((s) => (s.until === undefined && duration > 0 ? { ...s, until: duration } : s));
    if (sounds.length > 0) SOUNDS.set(command, { host, sounds });
    return timed.settles ? settling(command) : command;
}
