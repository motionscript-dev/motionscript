import { TimeCallback } from "@/platform/ticker";
import { PlaybackController } from "./playback-controller";

/**
 * Realtime transport over a `Session`, reached as `session.playback`. `null` when the environment has no clock
 * (a headless export has no wall clock to sync to): an absence rather than a no-op, so a UI can ask whether a
 * transport exists and hide its scrub bar. Thin on purpose: it is all `PlaybackController`'s, kept so "what a
 * session is" and "what is playing it" are separable.
 */
export class Playback {
    /** @internal — constructed by `Session`, never directly. */
    constructor(private readonly controller: PlaybackController) { }

    get isPlaying(): boolean {
        return this.controller.isPlaying;
    }

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
     * Without the await a paused scrub needs. Use `Session.seekFrame` when paused: it resolves once the frame is
     * drawn.
     */
    seekFrame(frame: number): void {
        this.controller.seekWhilePlaying(frame);
    }

    setMuted(muted: boolean): void {
        this.controller.setMuted(muted);
    }

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
