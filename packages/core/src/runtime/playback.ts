import { TimeCallback } from "@/platform/ticker";
import { PlaybackController } from "./playback-controller";

/**
 * Realtime transport over a `Session`.
 *
 * Reached as `session.playback`, and **`null` when the environment has no
 * clock** — a headless export has no wall clock to sync to. That is deliberately
 * an absence rather than a no-op: a UI wants to ask whether a transport exists
 * (and hide its scrub bar if not) rather than call `play()` into a void.
 *
 * Thin on purpose. Everything here is `PlaybackController`'s; this exists so
 * that "what a session is" and "what is currently playing it" are separable, and
 * so the transport half can simply not exist where it makes no sense.
 */
export class Playback {
    /** @internal — constructed by `Session`, never directly. */
    constructor(private readonly controller: PlaybackController) { }

    get isPlaying(): boolean {
        return this.controller.isPlaying;
    }

    /** The playhead, in frames. */
    get frame(): number {
        return this.controller.currentFrame;
    }

    play(speed = 1, reverse = false): void {
        this.controller.play(speed, reverse);
    }

    pause(): void {
        this.controller.pause();
    }

    /**
     * Move the playhead while playing, without the await a paused scrub needs.
     * Use `Session.seekFrame` when paused — it resolves once the frame is drawn.
     */
    seekFrame(frame: number): void {
        this.controller.seekWhilePlaying(frame);
    }

    setMuted(muted: boolean): void {
        this.controller.setMuted(muted);
    }

    /** Fires as the playhead moves, in seconds. */
    onTime(callback: TimeCallback): void {
        this.controller.onTime(callback);
    }

    onPlay(callback: () => void): void {
        this.controller.onPlay(callback);
    }

    onPause(callback: () => void): void {
        this.controller.onPause(callback);
    }
}
