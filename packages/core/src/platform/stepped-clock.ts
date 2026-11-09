import { Ticker } from "./ticker";

/**
 * A clock with no wall clock behind it: the playhead is wherever it was last put.
 *
 * What a headless session runs on. `PlaybackController` needs *a* clock to seek
 * against, but an export has no realtime to sync to — and must not have one,
 * because a wall-clock export drifts. So the platform reports `null` from
 * `createTicker` to say "no realtime transport here", and a session stands
 * this in so everything that is not transport — seeking, node picking, reading a
 * node's box, drawing a frame — works exactly as it does in a browser.
 *
 * `play()` is deliberately not overridden into a no-op: nothing reaches it,
 * because a session with no realtime clock exposes `playback === null` and there
 * is no other route to it.
 *
 * @internal
 */
export class SteppedClock extends Ticker {
    seek(t: number): void {
        this.setCurrentTime(t);
    }
}
