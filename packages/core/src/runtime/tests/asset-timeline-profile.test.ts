import { beforeEach, describe, expect, it, vi } from 'vitest';

// The profile reads the clock through `now`; a hand-driven one makes every
// elapsed time exact. This file owns the mock, so the scheduling tests that
// need the real clock stay in their own file.
const clock = vi.hoisted(() => ({ value: 0 }));
vi.mock('@/util/scheduler', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/util/scheduler')>()),
    now: () => clock.value,
}));

import { createAssetTimelineProfile, type AssetTimelineTimings, type TrackAssetsTiming } from '@/runtime/asset-timeline';

/** Timing `index` of a finished profile, failing loudly rather than returning the sparse array's hole. */
function timingAt(timings: AssetTimelineTimings, index: number): TrackAssetsTiming {
    const timing = timings[index];
    if (timing === undefined) throw new Error(`no timing recorded at ${index}`);
    return timing;
}

beforeEach(() => {
    clock.value = 0;
});

describe('createAssetTimelineProfile', () => {
    it('attributes the time between phases to the phase that was open', () => {
        const profile = createAssetTimelineProfile();
        const track = profile.track(0, 'a');

        track.enter('build');
        clock.value = 10;
        track.enter('declare');
        clock.value = 25;
        track.enter('evaluate');
        clock.value = 26;
        track.done(30);

        expect(timingAt(profile.timings, 0)).toEqual({
            trackId: 'a', trackIndex: 0, frameCount: 30, totalMs: 26,
            phases: { build: 10, declare: 15, evaluate: 1, audio: 0 },
        });
    });

    it('sums a phase entered more than once', () => {
        const profile = createAssetTimelineProfile();
        const track = profile.track(0, 'a');

        track.enter('evaluate');
        clock.value = 4;
        track.enter('declare');
        clock.value = 5;
        track.enter('evaluate');
        clock.value = 12;
        track.done(1);

        expect(timingAt(profile.timings, 0).phases).toEqual({ build: 0, declare: 1, evaluate: 11, audio: 0 });
        expect(timingAt(profile.timings, 0).totalMs).toBe(12);
    });

    it('leaves the time between suspend and resume out of every phase and out of the total', () => {
        const profile = createAssetTimelineProfile();
        const track = profile.track(0, 'a');

        track.enter('declare');
        clock.value = 5;
        track.suspend();
        // Parked on a yield: the caller is doing something else for a long while.
        clock.value = 1000;
        track.resume();
        clock.value = 1003;
        track.done(10);

        const timing = timingAt(profile.timings, 0);
        expect(timing.phases.declare).toBe(5);
        expect(timing.totalMs).toBe(5 + 3);
    });

    it('bills nothing to a phase after resume until the next phase is entered', () => {
        const profile = createAssetTimelineProfile();
        const track = profile.track(0, 'a');

        track.enter('build');
        clock.value = 2;
        track.suspend();
        clock.value = 100;
        track.resume();
        clock.value = 104;
        track.enter('evaluate');
        clock.value = 109;
        track.done(1);

        const timing = timingAt(profile.timings, 0);
        expect(timing.phases).toEqual({ build: 2, declare: 0, evaluate: 5, audio: 0 });
        // The 4 ms between resume and the next phase count toward the total only.
        expect(timing.totalMs).toBe(2 + 4 + 5);
    });

    it('can suspend and resume repeatedly', () => {
        const profile = createAssetTimelineProfile();
        const track = profile.track(0, 'a');

        track.enter('evaluate');
        for (let i = 0; i < 3; i++) {
            clock.value += 2;
            track.suspend();
            clock.value += 500;
            track.resume();
            // Resumed with no phase open, so the next stretch is unattributed until entered.
            track.enter('evaluate');
        }
        clock.value += 1;
        track.done(1);

        expect(timingAt(profile.timings, 0).phases.evaluate).toBe(2 + 2 + 2 + 1);
        expect(timingAt(profile.timings, 0).totalMs).toBe(7);
    });

    it('starts the clock when the track is created, so time before the first phase counts toward the total', () => {
        const profile = createAssetTimelineProfile();
        clock.value = 100;
        const track = profile.track(0, 'a');
        clock.value = 107;
        track.enter('build');
        clock.value = 110;
        track.done(1);

        expect(timingAt(profile.timings, 0).totalMs).toBe(10);
        expect(timingAt(profile.timings, 0).phases.build).toBe(3);
    });

    it('keeps each track in its own slot, sparse until the track is done', () => {
        const profile = createAssetTimelineProfile();
        const second = profile.track(2, 'c');
        expect(profile.timings).toHaveLength(0);

        second.enter('audio');
        clock.value = 8;
        second.done(5);

        expect(profile.timings).toHaveLength(3);
        expect(profile.timings[0]).toBeUndefined();
        expect(profile.timings[1]).toBeUndefined();
        expect(timingAt(profile.timings, 2)).toMatchObject({ trackId: 'c', trackIndex: 2, frameCount: 5, totalMs: 8 });
        expect(timingAt(profile.timings, 2).phases.audio).toBe(8);
    });

    it('reports every phase, in a record per track that no other track shares', () => {
        const profile = createAssetTimelineProfile();
        const a = profile.track(0, 'a');
        const b = profile.track(1, 'b');
        a.enter('build');
        clock.value = 3;
        a.done(1);
        b.enter('declare');
        clock.value = 5;
        b.done(1);

        expect(Object.keys(timingAt(profile.timings, 0).phases).sort()).toEqual(['audio', 'build', 'declare', 'evaluate']);
        expect(timingAt(profile.timings, 0).phases).not.toBe(timingAt(profile.timings, 1).phases);
        expect(timingAt(profile.timings, 0).phases.declare).toBe(0);
        expect(timingAt(profile.timings, 1).phases.declare).toBe(2);
    });

    it('replaces a track\'s timing when the same slot is done again', () => {
        const profile = createAssetTimelineProfile();
        const first = profile.track(0, 'a');
        first.done(1);
        clock.value = 50;
        const again = profile.track(0, 'a');
        clock.value = 60;
        again.done(2);

        expect(profile.timings).toHaveLength(1);
        expect(timingAt(profile.timings, 0)).toMatchObject({ frameCount: 2, totalMs: 10 });
    });
});
