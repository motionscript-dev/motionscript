import { Video } from '@motionscript/sdk';
import { el, scene } from '../doc';
import { holdTail } from './_lib';

/** {@link Video}'s `loop: 'forward'` repeating a short trimmed clip continuously, restarting from `trimStart` once it reaches `trimEnd` rather than stopping on the last frame. */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Video, {
            src: 'video.mp4',
            width: 480,
            height: 270,
            fit: 'fill',
            trimStart: 0,
            trimEnd: 0.6,
            loop: 'forward',
        }),
    );
}, [
    1.8,
    holdTail(1.8),
]);
