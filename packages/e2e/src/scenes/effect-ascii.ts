import { Rect, Text, Effects, Fills } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * {@link Effects.ascii}: the image resolves into a glyph grid as the cell grows.
 *
 * The `Text` node is load-bearing, not decoration: the atlas is baked from a
 * *registered* font, and a scene with no text registers none — the effect then
 * has nothing to draw with and degrades to a no-op. Naming the same family on
 * the effect keeps the bake off the fallback path.
 *
 * `standard` is plain ASCII, so it renders in any Latin font; `blocks` and
 * `braille` would need one covering those Unicode ranges.
 */
const FAMILY = 'Inter';
const style = { charset: 'standard' as const, fontFamily: FAMILY, ink: '#7dff9b', background: '#04120a' };

const photo = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'vertical', gap: 20, align: { x: 0, y: 0 }, children: [
            el(Rect, { width: 480, height: 300, cornerRadius: 20, clip: true, flow: 'freeform', children: [
                el(Rect, {
                    ref: photo,
                    fill: Fills.image('./cat.jpg', { fit: 'fill' }),
                    width: 'fill',
                    height: 'fill',
                    effects: Effects.ascii({ size: 3, ...style }),
                }),
            ] }),
            el(Text, { text: 'ascii', fontFamily: FAMILY, fontSize: 24, fill: '#7dff9b' }),
        ] }),
    );
}, [
    () => photo().to({ data: { effects: Effects.ascii({ size: 12, ...style }) }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
