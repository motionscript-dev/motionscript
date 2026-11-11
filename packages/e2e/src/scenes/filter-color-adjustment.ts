import { Rect, Fills, Adjustments } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Adjustments.colorAdjustment}: brightness, contrast, saturation, vibrance, shadows, highlights, temperature, tint, and vignette all animating together for a full color-grade sweep. */
const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, {
                ref: rect,
                width: 320,
                height: 320,
                cornerRadius: 24,
                fill: Fills.image('kingfisher.jpg', {
                    fit: 'fill',
                    preset: { adjustments: Adjustments.colorAdjustment({
                        brightness: 0,
                        contrast: 1,
                        saturation: 1,
                        vibrance: 0,
                        shadows: 0,
                        highlights: 0,
                        temperature: 0,
                        tint: 0,
                        vignette: 0 }) } }),
            }),
        ] }),
    );
}, [
    () => rect().to({ data: {
            fill: Fills.image('kingfisher.jpg', {
                fit: 'fill',
                preset: { adjustments: Adjustments.colorAdjustment({
                    brightness: 0.2,
                    contrast: 1.5,
                    saturation: 1.8,
                    vibrance: 0.6,
                    shadows: 0.3,
                    highlights: -0.3,
                    temperature: 0.4,
                    tint: -0.2,
                    vignette: 0.6 }) } }) }, duration: 1.6, easing: easeInOut('quad') }),
    holdTail(1.6),
]);
