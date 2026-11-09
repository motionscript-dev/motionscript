import { Clip } from "@/render/clip";
import type { Graphics2D } from "@/render/graphics2d";

/** The outline a shape's ops describe, as a clip: what `clip: true` cuts children to and picking tests against. */
export function clipOf(shape: Graphics2D): Clip {
    const clip = new Clip();
    for (const op of shape.ops()) {
        switch (op.kind) {
            case "rect": clip.rect(op.state); break;
            case "ellipse": clip.ellipse(op.state); break;
            case "path": clip.path(op.state); break;
            case "line": clip.line(op.state); break;
            case "polygon": clip.polygon(op.state); break;
            case "polygram": clip.polygram(op.state); break;
            case "cut": clip.cut(); break;
            default: break;
        }
    }
    return clip;
}
