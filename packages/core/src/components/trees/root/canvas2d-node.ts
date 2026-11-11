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
    /** Background fill layer(s): any loose fill value or a {@link FillChain}, painted behind the children. */
    fill: Fill;
    /** Overlay layer(s), same loose values as {@link fill}, painted over the fill **and** the children (clipped to the viewport): e.g. a VHS-grain image or video across the scene. */
    overlay: Fill;
    /** Camera magnification factor. Values > 1 zoom in; < 1 zoom out. */
    zoom: number;
    /** World-space point mapped to the viewport centre. In a {@link space3D} it is also what the camera orbits, and `z` puts it in depth (as a node's `depth`: negative `z` flies in). */
    lookAt: LookAt;
    /** Rotation of the camera view in degrees (clockwise). */
    heading: number;
    /** Places the children in one 3D space seen through this camera, rather than each projecting through its own perspective: their `depth` and tilt become positions and turns in that space and siblings paint far to near. A switch, not read off the camera's numbers, so turning it on can't jump a tween. While on, `perspective` is the camera's distance from {@link lookAt} at `dolly: 0` (CSS's convention: that plane draws 1:1, `0` is parallel) and the stage's own tilt and depth are unused. */
    space3D: boolean;
    /** Degrees about the vertical axis through {@link lookAt}. 0 is head-on; positive moves the camera to the right. Same as `Camera3D`. */
    orbit: number;
    /** Degrees above the layers. Positive looks down on them. Same as `Camera3D`. */
    elevation: number;
    /** Px the camera has moved in toward {@link lookAt}. Inert with no perspective, as depth is. */
    dolly: number;
}

/** The single root container every clip document builds into: a {@link Node2D} that is the clip's layout frame and camera. It lays children out, paints a scene-wide `fill` and `overlay`, and views them through a viewport transform (`zoom`, `lookAt`, `heading`). Not a shape: no stroke, shadow, corner or `start`/`end`. Its layout props are the arrangement {@link Node2D} lays children out by ({@link flowArrangement}). */
/** @internal */
export class Canvas2D extends Node2D<Canvas2DProps> {

    // Declared loose (`Fill`) so assignment and reads share one type; the accessor stores the resolved value via the mapper.
    declare fill: Fill;
    declare overlay: Fill;

    declare flow: FlowMode;
    declare readonly gap: GapSize;
    declare readonly wrap: boolean;
    // `undefined` means "follow `gap`", not "missing" — see FlowProps.crossGap.
    declare readonly crossGap: number | undefined;
    declare readonly columns: number;
    // Declared loose as `Alignment`; the accessor stores the resolved per-axis `Vector2` pivot. See Rect.
    declare align: Alignment;

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

    // Camera motion commands mirroring the Camera node's viewport commands.

    /** Animate `zoom`. Values > 1 zoom in; < 1 zoom out. */
    zoomTo(args: CommandArgs<{ zoom: number }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /** Pan — animate `lookAt`, the world-space point mapped to the viewport center. `z` moves it in depth. */
    panTo(args: CommandArgs<{ lookAt: LookAt }> & { duration: number }): Command<Canvas2DProps> {
        return this.to({ data: args.data as Partial<Canvas2DProps>, duration: args.duration, easing: args.easing });
    }

    /** Swings the camera round {@link lookAt}. Argument names are the 3D components' `orbitTo` less `zoom` (here the lens, with its own command). */
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

    protected override flowArrangement(): FlowSettings {
        return this;
    }

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

    /** Accepts audio children as well as 2D ones: the scene root is where the two trees meet (as `Canvas3D`), so a voiceover lives in the document showing the picture it narrates. Nothing partitions them: `Node2D.children` already filters to its own kind and the audio declaration walk reads the unfiltered list. */
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

    // Views the laid-out world through the camera viewport transform (the identity at rest, so a plain layout root pays
    // nothing). Non-null exactly when renderChildren opens a camera, so node picking inserts the same scope in the same
    // place and skips the at-rest fast path, where nothing is pushed.
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
