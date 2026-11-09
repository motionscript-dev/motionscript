import { Fills, Graphics2D, Mat, Tex, type Color, type Graphics3D, type SurfaceTexture3D, type Vector3 } from "@motionscript/sdk";
import { createBoundedCache } from "../kit/cache";

/** Text in a 3D graph: a camera-facing card, so a number reads square-on from wherever the scene is seen. */

export interface LabelStyle3D {
    /** The height of the text's em, in scene units. */
    size: number;
    color: Color;
    fontFamily: string;
}

/** The em the text is rasterized at, in buffer pixels, and the card's height around it. */
const EM = 64;
const CARD_HEIGHT = 96;

// A texture's identity is its source object, so one text in one style is one source for as long as it is asked for.
const cards = createBoundedCache<{ texture: SurfaceTexture3D; width: number }>(256);

function card(text: string, style: LabelStyle3D): { texture: SurfaceTexture3D; width: number } {
    const key = `${style.fontFamily}|${JSON.stringify(style.color)}|${text}`;
    const hit = cards.get(key);
    if (hit) return hit;
    const width = Math.min(1024, Math.max(128, Math.ceil((text.length * EM * 0.62 + EM) / 32) * 32));
    const source = new Graphics2D()
        .text({
            text,
            fontSize: EM,
            ...(style.fontFamily === "" ? {} : { fontFamily: style.fontFamily }),
            wrap: false,
            width,
            textAlign: "center",
        })
        .fill(Fills.color(style.color));
    // Its pixels never change, so the renderer rasterizes it once rather than every frame.
    const texture: SurfaceTexture3D = { ...Tex.surface(source, { width, height: CARD_HEIGHT }), static: true, identity: `label3d:${key}` };
    const made = { texture, width };
    cards.set(key, made);
    return made;
}

/** Draw `text` centred on `at`, a local point. */
export function drawLabel3D(g3: Graphics3D, text: string, at: Vector3, style: LabelStyle3D): void {
    if (text === "" || !(style.size > 0)) return;
    const { texture, width } = card(text, style);
    const height = (style.size * CARD_HEIGHT) / EM;
    g3.sprite({
        material: Mat.sprite({ map: texture, transparent: true, depthWrite: false }),
        position: at,
        scale: [(height * width) / CARD_HEIGHT, height, 1],
    });
}
