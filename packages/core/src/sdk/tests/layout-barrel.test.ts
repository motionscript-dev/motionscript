import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

// The two barrels are loaded by a dynamic import with a hand-built URL, as
// `tests/sdk-parity.test.ts` does: a barrel import is a lint error outside a
// barrel, and a non-literal specifier is how a test reads one on purpose. The
// types go through `import()` type queries, which the type-checker resolves.
type Root = typeof import('@/index');
type Sdk = typeof import('@/sdk');
type RootFlowMode = import('@/index').FlowMode;
type SdkFlowMode = import('@/sdk').FlowMode;
type RootGapSize = import('@/index').GapSize;
type SdkGapSize = import('@/sdk').GapSize;
type RootFlowResolved = import('@/index').FlowResolved;
type SdkFlowResolved = import('@/sdk').FlowResolved;
type RootFlowProps = import('@/index').FlowProps;
type SdkFlowProps = import('@/sdk').FlowProps;
type RootFlowSettings = import('@/index').FlowSettings;
type SdkFlowSettings = import('@/sdk').FlowSettings;
type RootLayoutItem = import('@/index').LayoutItem;
type SdkLayoutItem = import('@/sdk').LayoutItem;
type RootFlowSpace = import('@/index').FlowSpace;
type SdkFlowSpace = import('@/sdk').FlowSpace;
type RootFlowLine = import('@/index').FlowLine;
type SdkFlowLine = import('@/sdk').FlowLine;
type RootFlowMeasure = import('@/index').FlowMeasure;
type SdkFlowMeasure = import('@/sdk').FlowMeasure;
type RootBoxBounds = import('@/index').BoxBounds;
type SdkBoxBounds = import('@/sdk').BoxBounds;
type RootSizeConstraints = import('@/index').SizeConstraints;
type SdkSizeConstraints = import('@/sdk').SizeConstraints;
type RootExtents = import('@/index').Extents;

const here = dirname(fileURLToPath(import.meta.url));
const rootUrl = pathToFileURL(resolve(here, '../../index.ts')).href;
const sdkUrl = pathToFileURL(resolve(here, '../index.ts')).href;
let root: Root;
let sdk: Sdk;

// Importing the two whole barrels cold outlasts the default 5 s.
const COLD = 60_000;

const FLOW_OPS_METHODS = [
    'resolve', 'lerp', 'arrange', 'measure', 'place', 'reusable', 'freeSlot', 'contentBox', 'size', 'collapsedRun',
] as const;

describe('the layout barrel', () => {
    beforeAll(async () => {
        root = (await import(/* @vite-ignore */ rootUrl)) as Root;
        sdk = (await import(/* @vite-ignore */ sdkUrl)) as Sdk;
    }, COLD);

    it('exports flowOps from the root and from /sdk, as the same object', () => {
        expect(root.flowOps).toBeDefined();
        expect(sdk.flowOps).toBe(root.flowOps);
    }, COLD);

    it('carries exactly the flowOps methods', () => {
        expect(Object.keys(root.flowOps).sort()).toEqual([...FLOW_OPS_METHODS].sort());
        for (const method of FLOW_OPS_METHODS) expect(root.flowOps[method]).toBeTypeOf('function');
    }, COLD);

    it('exports the flow vocabulary types from both barrels (checked by the type-checker)', () => {
        expectTypeOf<RootFlowMode>().toEqualTypeOf<SdkFlowMode>();
        expectTypeOf<RootGapSize>().toEqualTypeOf<SdkGapSize>();
        expectTypeOf<RootFlowResolved>().toEqualTypeOf<SdkFlowResolved>();
        expectTypeOf<RootFlowProps>().toEqualTypeOf<SdkFlowProps>();
        expectTypeOf<RootFlowSettings>().toEqualTypeOf<SdkFlowSettings>();
        expectTypeOf<RootLayoutItem>().toEqualTypeOf<SdkLayoutItem>();
        expectTypeOf<RootFlowSpace>().toEqualTypeOf<SdkFlowSpace>();
        expectTypeOf<RootFlowLine>().toEqualTypeOf<SdkFlowLine>();
        expectTypeOf<RootFlowMeasure>().toEqualTypeOf<SdkFlowMeasure>();
        expectTypeOf<RootBoxBounds>().toEqualTypeOf<SdkBoxBounds>();
        expectTypeOf<RootSizeConstraints>().toEqualTypeOf<SdkSizeConstraints>();
    });

    it('exports Extents from the root barrel too, though the SDK omits it', () => {
        const extents: RootExtents = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
        expect(extents.maxX).toBe(3);
    });
});
