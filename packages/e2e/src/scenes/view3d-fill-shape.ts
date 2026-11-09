import { createRef, easeInOut, el, scene } from '../doc';
import { SpinBoxEllipse } from '@/components/view3d';
import { holdTail } from './_lib';

/**
 * 3D as a *fill*, painted through a non-rectangular path.
 *
 * This is the property that makes 3D composable rather than something only a
 * `Canvas3D` can do: a recorded `Scene3D` is rendered to a texture and used to
 * shade an `Ellipse`'s own path, so it clips to the ellipse and stacks with the
 * other fill layers. A regression in the fill/shader route shows up here and
 * nowhere in `view3d-basic`, which paints through an ordinary rect.
 *
 * This is also the hand-built `Scene3D` escape hatch under test — the node tree is
 * the ordinary way to describe a scene, and this is what it records into — which
 * is why the ellipse is a node type of its own (`SpinBoxEllipse`): the document
 * names only its `spin`.
 */
const shape = createRef<SpinBoxEllipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(el(SpinBoxEllipse, { ref: shape, width: 360, height: 280 }));
}, [
    () => shape().to({ data: { spin: 160 }, duration: 1.4, easing: easeInOut('quad') }),
    holdTail(1.4),
]);
