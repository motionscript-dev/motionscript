import { Ticker } from "./ticker";

/** A clock with no wall clock behind it: the playhead is wherever it was last put. What a headless session runs on: an export has no realtime to sync to (and must not, since a wall-clock export drifts), so the platform reports `null` from `createTicker` and a session stands this in, keeping everything that is not transport (seeking, picking, reading a node's box, drawing) as in a browser. `play()` is not a no-op override: with `playback === null` nothing reaches it. @internal */
export class SteppedClock extends Ticker {
    seek(t: number): void {
        this.setCurrentTime(t);
    }
}
