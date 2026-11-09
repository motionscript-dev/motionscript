import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code, lines } from '@motionscript/code';
import { holdTail } from './_lib';

/** {@link Code.resetHighlight}: a dimmed highlight restores to full opacity across every line. */
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
                    padding: { horizontal: 48, vertical: 36 },
                    fontSize: 18,
                    code: `function total(items: number[]) {
  const sum = items.reduce((a, b) => a + b, 0);
  return sum;
}`,
                }),
            ] }),
        ] }),
    );
}, [
    () => code().highlight({ data: { target: lines(2) }, duration: 0 }),
    0.4,
    () => code().resetHighlight({ duration: 0.6 }),
    holdTail(1.0),
]);
