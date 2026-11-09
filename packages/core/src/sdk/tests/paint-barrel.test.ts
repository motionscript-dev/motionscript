import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

// The two barrels are loaded by a dynamic import with a hand-built URL, as
// `tests/sdk-parity.test.ts` does: a barrel import is a lint error outside a
// barrel, and a non-literal specifier is how a test reads one on purpose.
type Root = typeof import('@/index');
type Sdk = typeof import('@/sdk');

const here = dirname(fileURLToPath(import.meta.url));
const rootUrl = pathToFileURL(resolve(here, '../../index.ts')).href;
const sdkUrl = pathToFileURL(resolve(here, '../index.ts')).href;
let root: Root;
let sdk: Sdk;

// Importing the two whole barrels cold outlasts the default 5 s.
const COLD = 60_000;

describe('the paint attribute barrel', () => {
    beforeAll(async () => {
        root = (await import(/* @vite-ignore */ rootUrl)) as Root;
        sdk = (await import(/* @vite-ignore */ sdkUrl)) as Sdk;
    }, COLD);

    const OPS = ['fillOps', 'strokeOps', 'shadowOps', 'cornerRadiusOps', 'cornerStyleOps', 'effectsOps', 'colorOps'] as const;

    it.each(OPS)('exports %s from the root, with resolve and lerp', (name) => {
        const ops = root[name] as { resolve: unknown; lerp: unknown };
        expect(ops.resolve).toBeTypeOf('function');
        expect(ops.lerp).toBeTypeOf('function');
    }, COLD);

    it('gives the corner ops their uniformity helpers', () => {
        expect(root.cornerRadiusOps.isUniformInput).toBeTypeOf('function');
        expect(root.cornerRadiusOps.isUniform).toBeTypeOf('function');
        expect(root.cornerRadiusOps.isZero).toBeTypeOf('function');
        expect(root.cornerStyleOps.isUniformInput).toBeTypeOf('function');
        expect(root.cornerStyleOps.isUniform).toBeTypeOf('function');
    }, COLD);

    it('re-exports from /sdk the same objects and functions as the root', () => {
        for (const name of ['fillOps', 'strokeOps', 'shadowOps', 'cornerRadiusOps', 'cornerStyleOps'] as const) {
            expect(sdk[name]).toBe(root[name]);
        }
        for (const name of ['resolveFill', 'resolveStroke', 'resolveShadow', 'resolveCorners', 'parseColor'] as const) {
            expect(sdk[name]).toBeTypeOf('function');
            expect(sdk[name]).toBe(root[name]);
        }
    }, COLD);

    it('exports the builders from the root and from /sdk', () => {
        for (const name of ['Fills', 'Effects', 'Adjustments', 'VideoAdjustments'] as const) {
            expect(root[name]).toBeDefined();
            expect(sdk[name]).toBe(root[name]);
        }
    }, COLD);

    it('carries colorOps on /sdk too, as the same object', () => {
        expect(sdk.colorOps).toBeDefined();
        expect(sdk.colorOps).toBe(root.colorOps);
    }, COLD);

    // `effectsOps` is reachable from the root only. Flip this when it joins the SDK.
    it('keeps effectsOps off /sdk for now', () => {
        expect(Object.hasOwn(sdk, 'effectsOps')).toBe(false);
    }, COLD);

    it('exports the shader uniform functions a renderer consumes from the root', () => {
        for (const name of [
            'normalizeUniforms', 'lerpUniformValue', 'lerpUniformRecord', 'uniformValuesEqual', 'uniformRecordsEqual',
            'isWgslShader', 'shaderContractOf',
        ] as const) {
            expect(root[name]).toBeTypeOf('function');
        }
    }, COLD);
});

describe('the paint types on both barrels', () => {
    // Checked by the type-checker: each pair names the same type from the root and from /sdk.
    it('resolve the fill and colour types from both (checked by the type-checker)', () => {
        expectTypeOf<import('@/index').Fill>().toEqualTypeOf<import('@/sdk').Fill>();
        expectTypeOf<import('@/index').FillChain>().toEqualTypeOf<import('@/sdk').FillChain>();
        expectTypeOf<import('@/index').FillOptions>().toEqualTypeOf<import('@/sdk').FillOptions>();
        expectTypeOf<import('@/index').VideoFillOptions>().toEqualTypeOf<import('@/sdk').VideoFillOptions>();
        expectTypeOf<import('@/index').FillResolved>().toEqualTypeOf<import('@/sdk').FillResolved>();
        expectTypeOf<import('@/index').FillSpace>().toEqualTypeOf<import('@/sdk').FillSpace>();
        expectTypeOf<import('@/index').Color>().toEqualTypeOf<import('@/sdk').Color>();
        expectTypeOf<import('@/index').NormalizedColor>().toEqualTypeOf<import('@/sdk').NormalizedColor>();
        expectTypeOf<import('@/index').BlendMode>().toEqualTypeOf<import('@/sdk').BlendMode>();
    });

    it('resolve the stroke, shadow and corner types from both (checked by the type-checker)', () => {
        expectTypeOf<import('@/index').Stroke>().toEqualTypeOf<import('@/sdk').Stroke>();
        expectTypeOf<import('@/index').StrokeProp>().toEqualTypeOf<import('@/sdk').StrokeProp>();
        expectTypeOf<import('@/index').StrokeResolved>().toEqualTypeOf<import('@/sdk').StrokeResolved>();
        expectTypeOf<import('@/index').StrokeAlign>().toEqualTypeOf<import('@/sdk').StrokeAlign>();
        expectTypeOf<import('@/index').StrokeCap>().toEqualTypeOf<import('@/sdk').StrokeCap>();
        expectTypeOf<import('@/index').StrokeJoin>().toEqualTypeOf<import('@/sdk').StrokeJoin>();
        expectTypeOf<import('@/index').Shadow>().toEqualTypeOf<import('@/sdk').Shadow>();
        expectTypeOf<import('@/index').ShadowProp>().toEqualTypeOf<import('@/sdk').ShadowProp>();
        expectTypeOf<import('@/index').ShadowResolved>().toEqualTypeOf<import('@/sdk').ShadowResolved>();
        expectTypeOf<import('@/index').Corners<number>>().toEqualTypeOf<import('@/sdk').Corners<number>>();
        expectTypeOf<import('@/index').CornerStyle>().toEqualTypeOf<import('@/sdk').CornerStyle>();
        expectTypeOf<import('@/index').CornerStyleResolved>().toEqualTypeOf<import('@/sdk').CornerStyleResolved>();
        expectTypeOf<import('@/index').CornerRadiusResolved>().toEqualTypeOf<import('@/sdk').CornerRadiusResolved>();
    });

    it('resolve the effect and adjustment types from both (checked by the type-checker)', () => {
        expectTypeOf<import('@/index').Effect>().toEqualTypeOf<import('@/sdk').Effect>();
        expectTypeOf<import('@/index').EffectMode>().toEqualTypeOf<import('@/sdk').EffectMode>();
        expectTypeOf<import('@/index').EffectSurface>().toEqualTypeOf<import('@/sdk').EffectSurface>();
        expectTypeOf<import('@/index').ImageAdjustment>().toEqualTypeOf<import('@/sdk').ImageAdjustment>();
        expectTypeOf<import('@/index').VideoAdjustment>().toEqualTypeOf<import('@/sdk').VideoAdjustment>();
        expectTypeOf<import('@/index').MediaAdjustment>().toEqualTypeOf<import('@/sdk').MediaAdjustment>();
    });

    it('resolve the shader fill types from both (checked by the type-checker)', () => {
        expectTypeOf<import('@/index').ShaderFillProp>().toEqualTypeOf<import('@/sdk').ShaderFillProp>();
        expectTypeOf<import('@/index').ShaderFillResolved>().toEqualTypeOf<import('@/sdk').ShaderFillResolved>();
        expectTypeOf<import('@/index').ShaderTexture>().toEqualTypeOf<import('@/sdk').ShaderTexture>();
        expectTypeOf<import('@/index').ShaderUniformRecord>().toEqualTypeOf<import('@/sdk').ShaderUniformRecord>();
    });
});
