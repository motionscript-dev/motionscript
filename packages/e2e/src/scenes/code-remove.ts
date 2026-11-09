import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code, lines } from '@motionscript/code';
import { holdTail } from './_lib';

/** `remove`: a debug line is deleted from the snippet, collapsing the surrounding lines. */
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
                    code: `function process(data: number[]) {
  console.log("debug:", data);
  return data.filter((n) => n > 0);
}`,
                }),
            ] }),
        ] }),
    );
}, [
    0.5,
    () => code().remove({ data: { target: lines(2) }, duration: 0.7 }),
    holdTail(1.2),
]);
