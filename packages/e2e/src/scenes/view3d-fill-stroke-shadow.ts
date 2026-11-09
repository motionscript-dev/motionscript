import { SpinBoxStrokeRect } from '@/components/view3d';
import { easeInOut, el, scene, variableTo } from '../doc';
import { holdTail } from './_lib';

/**
 * A recorded `Scene3D` filling a **stroke** and a **drop shadow**.
 *
 * A 3D fill is the one kind that has to render offscreen before the paint is
 * configured (`preflight`), so it is the only fill that can tell whether a paint
 * path runs the whole fill lifecycle or only the half that configures the paint.
 * It is therefore the regression test for both those paths: when they ran only
 * the second half, this scene drew a bare white card — the band and the shadow
 * were silently absent rather than wrong.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('spin', 0);
    stage.add(
        el(SpinBoxStrokeRect, {
            width: 280,
            height: 260,
            cornerRadius: 20,
            fill: '#f4f6ff',
            spin: '=[spin]' as never,
        }),
    );
}, [
    () => variableTo('spin', 180, 1.4, easeInOut('quad')),
    holdTail(1.4),
]);
