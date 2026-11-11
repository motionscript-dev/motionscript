import type { AudioRequest } from "@/attributes/audio/request";


/** Stackable audio player driven by the AssetManager: it pushes decoded data in via {@link append}, the device schedules {@link AudioRequest}s via {@link schedule} and plays through {@link syncTo} each tick. */
export abstract class AudioSink {
    /** Whether pushing the audio working set does anything. False for a sink that discards everything (an export mixes offline at the end): `AssetManager.syncAudio` rebuilds a `Set`, id strings and a sorted signature every frame, so the work is skipped rather than done and thrown away. */
    get schedulesAudio(): boolean {
        return true;
    }

    abstract has(src: string): boolean;

    /** Decodes and stacks `data` under `src`; idempotent for a cached `src`. */
    abstract append(src: string, data: ArrayBuffer): Promise<void>;

    /** Drop cached audio data (and any active sources) for srcs not in `keep`. */
    abstract retain(keep: ReadonlySet<string>): void;

    /** Sets the working set for the current look-ahead window: requests no longer present stop; new ones become eligible via {@link syncTo} once their data is appended. */
    abstract schedule(requests: readonly AudioRequest[]): void;

    /** Starts/stops scheduled sources to match `clipTime`, every tick; sources whose data isn't appended yet are skipped. */
    abstract syncTo(clipTime: number): void;

    abstract play(time: number, speed: number, reverse: boolean): void | Promise<void>;
    abstract stop(): void;

    /** Mutes or unmutes all output. No-op by default (devices that produce no sound). */
    setMuted(muted: boolean): void {}

    /** Linear gain on all output, on top of each request's `volume`. Independent of {@link setMuted} (unmuting restores this level) so a host can hold a slider and a mute button. No-op by default. */
    setVolume(volume: number): void {}

    dispose(): void {
        this.stop();
    }
}
