import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { Code } from '@motionscript/code';
import { holdTail } from './_lib';

/** {@link Code.padding}: the inset between the code text and its frame growing from tight to spacious. */
const code = createRef<Code>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { cornerRadius: 16, fill: '#0f121a', height: 'hug', width: 'hug', clip: true, children: [
                el(Code, {
                    ref: code,
                    theme: 'vscode-dark',
                    language: 'typescript',
                    padding: { horizontal: 12, vertical: 12 },
                    fontSize: 18,
                    code: 'const ready = true;',
                }),
            ] }),
        ] }),
    );
}, [
    () => code().to({ data: { padding: { horizontal: 80, vertical: 64 } }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
