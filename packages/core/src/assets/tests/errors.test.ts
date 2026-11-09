import { describe, it, expect } from 'vitest';
import { AssetNotLoadedError } from '@/assets/errors';

describe('AssetNotLoadedError hint', () => {
    // The hint named `assets.image(...)` for every type that was not a font.
    it.each([
        ['image', 'assets.image('],
        ['font', 'assets.font('],
        ['video', 'assets.video('],
        ['loader', 'assets.loader('],
    ] as const)('names the scope method for a %s', (type, method) => {
        const error = new AssetNotLoadedError(type, 'thing');
        expect(error.message).toContain(method);
        expect(error.message).toContain('declareAssets()');
    });

    it('points audio at a command sound, which has no scope method', () => {
        const error = new AssetNotLoadedError('audio', 'song.mp3');
        expect(error.message).toContain('timeline.sound(');
        expect(error.message).not.toContain('assets.');
    });

    it('uses a given hint verbatim', () => {
        expect(new AssetNotLoadedError('image', 'a.png', 'Custom hint.').message).toBe('image asset "a.png" is not loaded. Custom hint.');
    });

    it('carries the type and source, an unset nodeId and a name, and is an Error', () => {
        const error = new AssetNotLoadedError('video', 'clip.mp4');
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ name: 'AssetNotLoadedError', assetType: 'video', src: 'clip.mp4' });
        expect(error.nodeId).toBeUndefined();
        expect(error.message).toBe(
            'video asset "clip.mp4" is not loaded. Declare it from the node\'s declareAssets() (e.g. assets.video(...)), '
            + 'so the asset timeline loads it before this frame draws.',
        );
    });

    it('lets the renderer stamp a nodeId afterwards', () => {
        const error = new AssetNotLoadedError('image', 'a.png');
        error.nodeId = 'card';
        expect(error.nodeId).toBe('card');
    });
});
