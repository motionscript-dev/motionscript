import { Rect } from '@motionscript/sdk';
import { createRef, el, scene } from '../doc';
import { Code, lines } from '@motionscript/code';
import { holdTail } from './_lib';

/** Code node rendered with the vscode-dark theme; highlights a line mid-scene. */
const code = createRef<Code>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
            el(Rect, { cornerRadius: 16, fill: '#1e1e1e', height: 'hug', width: 'hug', clip: true, children: [
                el(Code, {
                    ref: code,
                    theme: 'vscode-dark',
                    language: 'typescript',
                    padding: { horizontal: 48, vertical: 36 },
                    fontSize: 20,
                    code: `// fetch a user record
const user = await db.find(42);
return user?.name ?? "guest";`,
                }),
            ] }),
        ] }),
    );
}, [
    0.4,
    () => code().highlight({ data: { target: lines(2) }, duration: 0.6 }),
    holdTail(1.0),
]);
