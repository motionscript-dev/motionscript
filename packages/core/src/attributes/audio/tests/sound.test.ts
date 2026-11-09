import { describe, it, expect, vi } from 'vitest';
import { Sound } from '@/attributes/audio/sound';
import { AudioEffects } from '@/attributes/audio/effects/chain';
import { ramp } from '@/attributes/audio/ramp';
import { requestOf } from '@/attributes/audio/schedule';
import { ManifestAssetCatalog } from '@/assets/catalog';
import type { AssetManifest } from '@/assets/manifest';

const SRC = 'song.mp3';
const DURATION = 10;

const catalog = new ManifestAssetCatalog({
    image: {},
    video: {},
    audio: { [SRC]: { duration: DURATION, sizeBytes: 0, src: SRC } },
    font: {},
} satisfies AssetManifest);

describe('requestOf effects', () => {
    it('carries resolved effects onto the request', () => {
        const req = requestOf({ src: SRC, effects: AudioEffects.gain(2).lowpass(800), trimEnd: 4 }, catalog, 's', 0);
        expect(req.effects).toEqual([
            { type: 'gain', value: 2 },
            { type: 'lowpass', frequency: 800, q: undefined },
        ]);
    });

    it('omits effects when none are set', () => {
        expect(requestOf({ src: SRC, trimEnd: 4 }, catalog, 's', 0).effects).toBeUndefined();
    });

    it('carries transitions onto the request', () => {
        const req = requestOf({ src: SRC, trimEnd: 4, transitionIn: { duration: 0.5 }, transitionOut: { duration: 1 } }, catalog, 's', 0);
        expect(req.transitionIn).toEqual({ duration: 0.5 });
        expect(req.transitionOut).toEqual({ duration: 1 });
    });
});

describe('requestOf optional', () => {
    it('carries optional onto the request, and not into its id', () => {
        const plain = requestOf({ src: SRC, trimEnd: 4 }, catalog, 's', 0);
        const optional = requestOf({ src: SRC, trimEnd: 4, optional: true }, catalog, 's', 0);
        expect(optional.optional).toBe(true);
        expect(plain.optional).toBeUndefined();
        expect(optional.id).toBe(plain.id);
    });
});

describe('speed timing', () => {
    it('shrinks endAt for a faster clip (explicit trimEnd)', () => {
        const req = requestOf({ src: SRC, speed: 2, trimEnd: 4 }, catalog, 's', 0);
        expect(req.endAt).toBeCloseTo(2);
    });

    it('grows endAt for a slower clip', () => {
        const req = requestOf({ src: SRC, speed: 0.5, trimEnd: 4 }, catalog, 's', 0);
        expect(req.endAt).toBeCloseTo(8);
    });

    it('emits an OPEN request carrying speed-adjusted media length for an unbounded clip', () => {
        const req = requestOf({ src: SRC, speed: 2 }, catalog, 's', 0);
        expect(req.open).toBe(true);
        expect(req.endAt).toBe(Infinity);
        expect(req.mediaDuration).toBeCloseTo(5);
    });

    it('leaves endAt unchanged at speed 1', () => {
        expect(requestOf({ src: SRC, trimEnd: 4 }, catalog, 's', 0).endAt).toBeCloseTo(4);
    });

    it('integrates a speed ramp to compute clip duration', () => {
        const req = requestOf({ src: SRC, speed: ramp(2, 2, 4), trimEnd: 4 }, catalog, 's', 0);
        expect(req.endAt).toBeCloseTo(2, 1);
        expect(req.sourceLength).toBe(4);
    });

    it('treats a non-positive speed as 1', () => {
        expect(requestOf({ src: SRC, speed: 0, trimEnd: 4 }, catalog, 's', 0).endAt).toBeCloseTo(4);
    });

    it("plays a looping clip's speed ramp at its start value", () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const req = requestOf({ src: SRC, loop: true, speed: ramp(1.5, 2, 4) }, catalog, 's', 0);
        expect(req.speed).toBe(1.5);
        expect(req.sourceLength).toBeUndefined();
        warn.mockRestore();
    });
});

describe('requestOf open marking', () => {
    it('an untrimmed, uncut clip is open', () => {
        expect(requestOf({ src: SRC }, catalog, 's', 0).open).toBe(true);
    });

    // An open marker would let open-request resolution re-extend the clip across later tracks.
    it('a clip cut by `until` is bounded and NOT open', () => {
        const req = requestOf({ src: SRC, until: 2 }, catalog, 's', 0);
        expect(req.open).toBeFalsy();
        expect(req.mediaDuration).toBeUndefined();
        expect(req.endAt).toBeCloseTo(2);
    });
});

describe('requestOf loop', () => {
    // The device loops [trimStart, trimEnd), so the request has to carry the
    // out-point; otherwise the whole decoded buffer wraps and the trim is lost.
    it('carries the trim region of a looping clip', () => {
        const req = requestOf({ src: SRC, loop: true, trimStart: 2, trimEnd: 5 }, catalog, 's', 0);
        expect(req.trimStart).toBe(2);
        expect(req.trimEnd).toBe(5);
    });

    // `trimEnd` bounds one pass; it must not end a loop the way it ends a one-shot.
    it('a looping clip with a trimEnd and no cut runs open', () => {
        const req = requestOf({ src: SRC, loop: true, trimEnd: 3 }, catalog, 's', 0);
        expect(req.open).toBe(true);
        expect(req.endAt).toBe(Infinity);
    });

    it('a looping clip is ended by its cut, not by its trim', () => {
        const req = requestOf({ src: SRC, loop: true, trimEnd: 3, until: 8 }, catalog, 's', 0);
        expect(req.open).toBeFalsy();
        expect(req.endAt).toBe(8);
    });

    it('does not carry a trimEnd for a one-shot, whose endAt already is the out-point', () => {
        const req = requestOf({ src: SRC, trimEnd: 3 }, catalog, 's', 0);
        expect(req.trimEnd).toBeUndefined();
        expect(req.endAt).toBeCloseTo(3);
    });

    it('ignores an out-point at or before the in-point', () => {
        expect(requestOf({ src: SRC, loop: true, trimStart: 4, trimEnd: 4 }, catalog, 's', 0).trimEnd).toBeUndefined();
    });
});

describe('Sound.clipDuration', () => {
    it('is the trimmed length at speed 1', () => {
        const sound = new Sound({ src: SRC, trimEnd: 4 });
        expect(sound.clipDuration).toBeCloseTo(4, 5);
    });

    it('is half as long at 2x speed', () => {
        const sound = new Sound({ src: SRC, speed: 2, trimEnd: 4 });
        expect(sound.clipDuration).toBeCloseTo(2, 5);
    });

    it('is twice as long at 0.5x speed', () => {
        const sound = new Sound({ src: SRC, speed: 0.5, trimEnd: 4 });
        expect(sound.clipDuration).toBeCloseTo(8, 5);
    });

    it('is undefined when the clip is unbounded', () => {
        expect(new Sound({ src: SRC }).clipDuration).toBeUndefined();
    });
});
