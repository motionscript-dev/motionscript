import { RenderContext2D, RenderPass2D } from "@/render/render-context2d";
import { Graphics2D } from "@/render/graphics2d";
import { Clip } from "@/render/clip";
import { type Command, type CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";
import { lerpLookAt, type LookAt, type SpaceCamera } from "@/attributes/layout/space3d";
import { NO_PROJECTION_3D, type Projection3D } from "@/attributes/layout/matrix2d";
import { Alignment } from "@/attributes/layout/alignment";
import type { FlowMode, FlowProps, FlowSettings, GapSize } from "@/layout/types";
import { fillOps } from "@/attributes/shape/fill/registry";
import { FillResolved } from "@/attributes/shape/fill/union";
import { Fill } from "@/attributes/shape/fill/chain";
import type { AssetScope } from "@/assets/scope";
import { CameraScope, Node2D, NodeConfig, Node2DProps } from "@/components/trees/2d/node2d";
import { spaceRootFrame } from "@/components/trees/2d/node-space";
import type { Node, NodeDimension } from "@/components/trees/node/node";
import { NodeAudio } from "@/components/trees/audio/node-audio";
import { declareMembers, property } from "@/attributes/properties/decorator";
import { alignmentProperty, fillProperty, flowProperty } from "@/attributes/properties/typed";

/** @internal */
export interface Canvas2DProps extends Node2DProps, FlowProps {
    /**
     * Background fill layer(s). Each item can be a CSS color string, a fill
     * prop object, an already-resolved fill, or a {@link FillChain} from the
     * `Fills` builder. Painted behind the scene's children.
     */
    fill: Fill;
    /**
     * Overlay layer(s) — same loose values as {@link fill}, but painted *over*
     * the fill **and** the children (clipped to the viewport). Use for textures
     * laid across the whole scene, e.g. a VHS-grain image or video.
     */
    overlay: Fill;
    /** Camera magnification factor. Values > 1 zoom in; < 1 zoom out. */
    zoom: number;
    /**
     * World-space point that maps to the centre of the viewport. In a
     * {@link space3D} it is also what the camera orbits, and `z` puts it in
     * depth — the same sense as a node's `depth`, so a negative `z` flies in.
     */
    lookAt: LookAt;
    /** Rotation of the camera view in degrees (clockwise). */
    heading: number;
    /**
     * Place the children in one 3D space seen through this camera, rather than
     * each projecting through a perspective of its own. Their `depth` and tilt
     * are then positions and turns in that space, and siblings paint far to
     * near. A switch rather than something read off the camera's numbers, so
     * turning it on can never jump a tween.
     *
     * While it is on, `perspective` is the camera's distance from {@link lookAt}
     * at `dolly: 0` — CSS's convention, so that plane draws 1:1 and `0` is a
     * parallel projection — and the stage's own tilt and depth are unused.
     */
    space3D: boolean;
    /** Degrees about the vertical axis through {@link lookAt}. 0 is head-on; positive moves the camera to the right. Same as `Camera3D`. */
    orbit: number;
    /** Degrees above the layers. Positive looks down on them. Same as `Camera3D`. */
    elevation: number;
    /** Px the camera has moved in toward {@link lookAt}. Inert with no perspective, as depth is. */
    dolly: number;
}

/**
 * The single root container every clip document builds into.
 *
 * A `Canvas2D` is a plain {@link Node2D} that doubles as the clip's layout frame
 * and camera. It lays its children out (flex `horizontal`/`vertical` or
 * `freeform`, with `gap`, `align`, `padding`) and paints a scene-wide background
 * (`fill`) and `overlay` — *and* views those laid-out children through a viewport
 * transform (`zoom`, `lookAt`, `heading`).
 *
 * Unlike a {@link Rect} it is **not a shape**: it has no stroke, shadow, corner,
 * or `start`/`end` props. It carries only the scene-wide concerns — background
 * paint, child layout, and camera — so `stage.fill`, `stage.flow`, etc. read
 * the root directly without exposing per-shape geometry the scene root never has.
 *
 * Its layout props are the arrangement {@link Node2D} lays its children out by,
 * the same as a {@link Rect}'s — see {@link flowArrangement}.
 */
/** @internal */
export class Canvas2D extends Node2D<Canvas2DProps> {

    // ---- Background paint -------------------------------------------------
    // Author-facing paint props. Like Rect, the declared type is the loose
    // `Fill` so assignment (`this.fill = 'red'`) and reads share one type; the
    // property accessor stores the *resolved* value via the mapper.
    declare fill: Fill;
    declare overlay: Fill;

    // ---- Layout container -------------------------------------------------
    declare flow: FlowMode;
    declare readonly gap: GapSize;
    declare readonly wrap: boolean;
    // `undefined` means "follow `gap`", not "missing" — see FlowProps.crossGap.
    declare readonly crossGap: number | undefined;
    declare readonly columns: number;
    // Declared loose as `Alignment` (covers `this.align = 'center'`); the
    // accessor stores the resolved per-axis `Vector2` pivot. See Rect.
    declare align: Alignment;

    // ---- Camera -----------------------------------------------------------
    /** Camera magnification factor (default: 1). */
    declare zoom: number;
    /** World-space focus point (default: {x:0, y:0}). */
    declare lookAt: LookAt;
    /** Camera view rotation in degrees (default: 0). */
    declare heading: number;
    declare space3D: boolean;
    declare orbit: number;
    declare elevation: number;
    declare dolly: number;

    constructor(props: NodeConfig<Canvas2D, Canvas2DProps>) {
        super(props);
    }

    // ---- Camera motion commands -------------------------------------------
    // Mirror the Camera node's viewport commands.

    /** Animate `zoom`. Values > 1 zoom in; < 1 zoom out. */
    zoomTo(args: CommandArgs<{ zoom: number }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /** Pan — animate `lookAt`, the world-space point mapped to the viewport center. `z` moves it in depth. */
    panTo(args: CommandArgs<{ lookAt: LookAt }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /**
     * Swing the camera round {@link lookAt}. The argument names are the ones the
     * 3D components' `orbitTo` takes, less `zoom`: here that is the lens, not a
     * distance, and it has a command of its own.
     */
    orbitTo(args: CommandArgs<{ orbit?: number; elevation?: number }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /** Move the camera in toward {@link lookAt} (positive) or back out. */
    dollyTo(args: CommandArgs<{ dolly: number }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /** Animate the view rotation (`heading`), in degrees clockwise. */
    headingTo(args: CommandArgs<{ heading: number }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    fillTo(args: CommandArgs<Fill, FillResolved[]> & { duration: number }): Command<Canvas2DProps> {
        const from = this.fill as FillResolved[];
        const target = fillOps.resolve(args.data as Fill);
        const lerp = args.lerp ?? fillOps.lerp;
        return this.command<Canvas2DProps>(t => ({ fill: lerp(from, target, t) }) as Partial<Canvas2DProps>, args.duration, args.easing);
    }

    overlayTo(args: CommandArgs<Fill, FillResolved[]> & { duration: number }): Command<Canvas2DProps> {
        const from = this.overlay as FillResolved[];
        const target = fillOps.resolve(args.data as Fill);
        const lerp = args.lerp ?? fillOps.lerp;
        return this.command<Canvas2DProps>(t => ({ overlay: lerp(from, target, t) }) as Partial<Canvas2DProps>, args.duration, args.easing);
    }

    // ---- Layout -----------------------------------------------------------

    protected override flowArrangement(): FlowSettings {
        return this;
    }

    // ---- Drawing ----------------------------------------------------------

    // The viewport-sized background box behind the children.
    private shapeGraphics(): Graphics2D {
        return new Graphics2D().rect({
            width: this.layoutBounds.width,
            height: this.layoutBounds.height,
        });
    }

    protected override renderSelf(draw: RenderContext2D): void {
        const fill = this.fill as FillResolved[];
        if (fill.length === 0) return;
        draw.draw(this.shapeGraphics().fill(fill));
    }

    // Overlay over fill + children, clipped to the viewport silhouette.
    protected override renderOverlay(ctx: RenderContext2D): void {
        const overlay = this.overlay as FillResolved[];
        if (overlay.length === 0) return;
        ctx.draw(this.shapeGraphics().fill(overlay));
    }

    /**
     * Accept audio children as well as 2D ones.
     *
     * The scene root is where the two trees meet, mirroring `Canvas3D` — and for
     * the same reason it is *this* node: a composition already carries both
     * halves of a clip, so a voiceover belongs in the document that shows the
     * picture it is narrating rather than in a second document beside it.
     *
     * Nothing partitions them by hand. `Node2D.children` already filters to its
     * own kind, so layout and render skip the audio subtree for free, and the
     * audio declaration walk reads the unfiltered list.
     */
    protected override acceptsChild(child: Node): boolean {
        return child.dimension === "2d" || child.dimension === "audio";
    }

    override get _childTrees(): readonly NodeDimension[] {
        return ["2d", "audio"];
    }

    /** This node's children in the audio tree. */
    get childrenAudio(): NodeAudio[] {
        return this._allChildren.filter((c): c is NodeAudio => c instanceof NodeAudio);
    }

    // The world container, not a shape, so it declares its own `fill`/`overlay`.
    override declareAssets(assets: AssetScope): void {
        super.declareAssets(assets);
        assets.fill(this.fill as FillResolved[]);
        assets.fill(this.overlay as FillResolved[]);
    }

    // The viewport outline — used for `clip` and as the area backdrop effects
    // are confined to.
    protected override clipSelf(): Clip {
        return new Clip().rect({
            width: this.layoutBounds.width,
            height: this.layoutBounds.height,
        });
    }

    // ---- Rendering --------------------------------------------------------

    // Children are laid out by the flow engine; here we view that laid-out
    // world through the camera viewport transform, the same way the Camera node
    // does. When the camera is at rest (zoom 1, no heading, origin at 0) this is
    // the identity, so a plain layout root pays nothing extra.
    // Non-null exactly when renderChildren below opens a camera, so a consumer
    // reproducing the render transform (node picking) inserts the same scope in
    // the same place — and skips it on the at-rest fast path, where the renderer
    // pushes nothing at all.
    override _cameraScope(): CameraScope | null {
        if (this.space3D) return null;
        if (this.zoom === 1 && this.heading === 0 && this.lookAt.x === 0 && this.lookAt.y === 0) return null;
        return { lookAt: this.lookAt, zoom: this.zoom, heading: this.heading };
    }

    override _spaceCamera(): SpaceCamera | null {
        if (!this.space3D) return null;
        const rect = this.layoutBounds;
        return {
            perspective: this.perspective,
            orbit: this.orbit,
            elevation: this.elevation,
            dolly: this.dolly,
            lookAt: this.lookAt,
            zoom: this.zoom,
            heading: this.heading,
            viewportX: rect?.x ?? 0,
            viewportY: -(rect?.y ?? 0),
        };
    }

    // In a space the stage's own tilt and depth would turn the whole scene as
    // one flat card; its `perspective` is the camera's instead.
    protected override _projection(): Projection3D {
        return this.space3D ? NO_PROJECTION_3D : super._projection();
    }

    protected override renderChildren(ctx: RenderPass2D): void {
        const camera = this._spaceCamera();
        if (camera) {
            this._renderInSpace(ctx, spaceRootFrame(this, camera));
            return;
        }
        if (this.zoom === 1 && this.heading === 0 && this.lookAt.x === 0 && this.lookAt.y === 0) {
            super.renderChildren(ctx);
            return;
        }

        const rect = this.layoutBounds;
        const w = rect?.width ?? 0;
        const h = rect?.height ?? 0;
        const cx = rect?.x ?? 0;
        const cy = rect?.y ?? 0;

        ctx.beginCamera(
            { x: cx, y: -cy, width: w, height: h },
            this.lookAt,
            this.zoom,
            this.heading,
        );

        for (const child of this._children) if (child instanceof Node2D) child.render(ctx);

        ctx.endCamera();
    }
}

declareMembers(Canvas2D, {
    fill: fillProperty(),
    overlay: fillProperty(),
    flow: flowProperty(),
    gap: property({ default: 0 }),
    wrap: property({ default: false }),
    crossGap: property({ default: undefined }),
    columns: property({ default: 1 }),
    align: alignmentProperty(),
    zoom: property({ default: 1 }),
    lookAt: property({ default: { x: 0, y: 0 }, tween: lerpLookAt }),
    heading: property({ default: 0 }),
    space3D: property({ default: false }),
    orbit: property({ default: 0 }),
    elevation: property({ default: 0 }),
    dolly: property({ default: 0 }),

    zoomTo: command({ args: [{ key: "zoom", kind: "number", min: 0.01, step: 0.1, unit: "×" }] }),
    panTo: command({ args: [{ key: "lookAt", kind: "vector2", properties: { x: { kind: "number" }, y: { kind: "number" }, z: { kind: "number" } } }] }),
    orbitTo: command({ args: [{ key: "orbit", kind: "number", step: 1, unit: "°" }, { key: "elevation", kind: "number", step: 1, unit: "°" }] }),
    dollyTo: command({ args: [{ key: "dolly", kind: "number", step: 10 }] }),
    headingTo: command({ args: [{ key: "heading", kind: "number", step: 1, unit: "°" }] }),
    fillTo: command(),
    overlayTo: command(),
});
