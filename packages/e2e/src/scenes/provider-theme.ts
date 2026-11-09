import { ThemeProvider } from '@motionscript/sdk';
import { ThemedRect } from '@/components/themed-rect';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link ThemeProvider} merging custom tokens onto the ambient theme: a node reading `'brand'`/`'brandText'` through the context gets the values supplied here, and a nested provider's `brand` wins for what it wraps. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(ThemeProvider, { theme: { brand: '#ff6a3d', brandText: '#1a0d08' }, children: [
            el(ThemedRect, {
                token: 'brand',
                width: 360,
                height: 220,
                cornerRadius: 24,
                flow: 'freeform',
                align: { x: 0, y: 0 },
                children: [
                    el(ThemedRect, { token: 'brandText', width: 160, height: 48, cornerRadius: 12 }),
                    el(ThemeProvider, { theme: { brand: '#3d9bff' }, children: [
                        el(ThemedRect, { token: 'brand', width: 96, height: 96, cornerRadius: 48, y: 70 }),
                    ] }),
                ],
            }),
        ] }),
    );
}, [
    1.2,
    holdTail(1.2),
]);
