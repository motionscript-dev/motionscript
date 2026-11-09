import { describe, it, expect } from 'vitest';
import { ManifestAssetCatalog } from '@/assets/catalog';
import type { AssetManifest } from '@/assets/manifest';

function makeManifest(): AssetManifest {
    return {
        image: {
            'brick-texture.png': { width: 10, height: 10, sizeBytes: 1, src: './brick-texture.png' },
            'textures/brick-texture.png': { width: 20, height: 20, sizeBytes: 2, src: './textures/brick-texture.png' },
        },
        video: {
            'clips/intro.mp4': { width: 100, height: 100, duration: 5, sizeBytes: 3, src: './clips/intro.mp4' },
        },
        audio: {
            'typewriter.wav': { duration: 1, sizeBytes: 1, src: './typewriter.wav' },
            'sfx/typewriter.wav': { duration: 2, sizeBytes: 2, src: './sfx/typewriter.wav' },
        },
        font: {
            'Inter@400': { fontFamily: 'Inter', fontWeight: 400, src: './fonts/Inter-Regular.ttf', sizeBytes: 1 },
            'Inter@700': { fontFamily: 'Inter', fontWeight: 700, src: './fonts/Inter-Bold.ttf', sizeBytes: 2 },
            'Mono@400': { fontFamily: 'Mono', fontWeight: 400, src: './fonts/Mono.ttf', sizeBytes: 3 },
            'Empty@400': { fontFamily: 'Empty', fontWeight: 400, src: './fonts/Empty.ttf', sizeBytes: 0 },
        },
    };
}

describe('AssetCatalog folder-qualified lookups', () => {
    it('resolves a root-level image by its bare filename (backward compatibility)', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getImageMeta('brick-texture.png').width).toBe(10);
    });

    it('resolves a nested image via "folder/file.png", "./folder/file.png", "/folder/file.png", and a backslash path, all to the same distinct entry', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        const bare = catalog.getImageMeta('textures/brick-texture.png');
        const dotSlash = catalog.getImageMeta('./textures/brick-texture.png');
        const leadingSlash = catalog.getImageMeta('/textures/brick-texture.png');
        const backslash = catalog.getImageMeta('textures\\brick-texture.png');

        expect(bare.width).toBe(20);
        expect(dotSlash).toEqual(bare);
        expect(leadingSlash).toEqual(bare);
        expect(backslash).toEqual(bare);

        // Never collides with the root-level file of the same basename.
        expect(bare.width).not.toBe(catalog.getImageMeta('brick-texture.png').width);
    });

    it('throws for a missing image, quoting the original (non-normalized) src', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(() => catalog.getImageMeta('missing.png')).toThrowError(/"missing\.png"/);
    });

    it('resolves nested and root audio distinctly, with the same normalization rules', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getAudioMeta('typewriter.wav').duration).toBe(1);
        expect(catalog.getAudioMeta('./sfx/typewriter.wav').duration).toBe(2);
        expect(catalog.getAudioMeta('/sfx/typewriter.wav').duration).toBe(2);
    });

    it('resolves a nested video via a folder-qualified src', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getVideoMeta('./clips/intro.mp4').duration).toBe(5);
    });

    it('getMediaDuration normalizes for both its audio and video branches', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getMediaDuration('./sfx/typewriter.wav')).toBe(2);
        expect(catalog.getMediaDuration('./clips/intro.mp4')).toBe(5);
        expect(() => catalog.getMediaDuration('nonexistent.wav')).toThrowError(/"nonexistent\.wav"/);
    });
});

describe('AssetCatalog font lookups', () => {
    it('getFontMeta resolves a face by its family@weight key', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getFontMeta('Inter@700')).toEqual({
            fontFamily: 'Inter', fontWeight: 700, src: './fonts/Inter-Bold.ttf', sizeBytes: 2,
        });
    });

    it('getFontMeta does not normalize its key the way a path is, and a miss names the key', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(() => catalog.getFontMeta('Inter')).toThrowError('No font metadata for key: Inter');
        expect(() => catalog.getFontMeta('/Inter@700')).toThrowError('No font metadata for key: /Inter@700');
    });

    it('getFontFamilyMetas returns every face of a family, whatever its weight', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        const faces = catalog.getFontFamilyMetas('Inter');
        expect(faces.map((face) => face.fontWeight).sort()).toEqual([400, 700]);
        expect(faces.every((face) => face.fontFamily === 'Inter')).toBe(true);
    });

    it('getFontFamilyMetas matches the family exactly and returns an empty list for an unknown one', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getFontFamilyMetas('Unknown')).toEqual([]);
        expect(catalog.getFontFamilyMetas('inter')).toEqual([]);
        expect(catalog.getFontFamilyMetas('')).toEqual([]);
    });
});

describe('AssetCatalog sizes and misses', () => {
    it('getImageSize returns the intrinsic dimensions alone, not the rest of the entry', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getImageSize('textures/brick-texture.png')).toEqual({ width: 20, height: 20 });
        expect(catalog.getImageSize('./brick-texture.png')).toEqual({ width: 10, height: 10 });
    });

    it('getImageSize throws the image miss for a source it does not know', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(() => catalog.getImageSize('gone.png')).toThrowError(/Image asset not found: "gone\.png"/);
    });

    it('getAudioMeta names the source it could not find, quoted as the caller wrote it', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(() => catalog.getAudioMeta('./missing.wav')).toThrowError('No audio metadata for src: ./missing.wav');
    });

    it('getVideoMeta and getVideoDuration read the same entry, and miss alike', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(catalog.getVideoDuration('clips/intro.mp4')).toBe(catalog.getVideoMeta('clips/intro.mp4').duration);
        expect(() => catalog.getVideoDuration('nope.mp4')).toThrowError(/Video asset not found: "nope\.mp4"/);
        expect(() => catalog.getAudioDuration('nope.wav')).toThrowError('No audio metadata for src: nope.wav');
    });

    it('getMediaDuration prefers audio over a video of the same key', () => {
        const manifest = makeManifest();
        manifest.audio['clips/intro.mp4'] = { duration: 9, sizeBytes: 1, src: './clips/intro.mp4' };
        expect(new ManifestAssetCatalog(manifest).getMediaDuration('clips/intro.mp4')).toBe(9);
    });

    it('reconcile points the same catalog at a new manifest in place', () => {
        const catalog = new ManifestAssetCatalog(makeManifest());
        expect(() => catalog.getImageMeta('new.png')).toThrowError();

        const next = makeManifest();
        next.image['new.png'] = { width: 5, height: 6, sizeBytes: 1, src: './new.png' };
        catalog.reconcile(next);

        expect(catalog.getImageSize('new.png')).toEqual({ width: 5, height: 6 });
    });
});
