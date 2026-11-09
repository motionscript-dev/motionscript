import type { PropertyEditor } from "@/attributes/properties/decorator";
import type { NodeDimension } from "@/components/trees/node/node";

/**
 * What a node type declares about itself beyond its key.
 *
 * The **technical** description of a type — how it lays children out, what a
 * fresh one is seeded with, what it inherits from. Deliberately *not* how it is
 * presented: no display name, no icon, no shelf, no copy. Those are a host's to
 * resolve and to translate, and a component that carried them would be shipping
 * one language's product decisions inside an engine artifact.
 *
 * It replaced a `manifest.json` written beside each package. Two descriptions of
 * one class is the shape that drifts, and it did: eight of nine packages ended
 * up promising commands their classes had never implemented.
 *
 * **Nothing here is read while rendering.** A frame is identical whether a type
 * declares a seed or not. It exists so a host has one place to ask.
 */
export interface NodeTypeDescriptor {
    /**
     * The document key, matching `NodeSpec.type`.
     *
     * **Frozen** for anything already published: a stored document naming it has
     * to keep meaning the same thing forever.
     */
    key: string;
    /** The type it inherits editing sections and commands from, for a host that groups them. */
    parentKey?: string;
    /**
     * Which scene graph the type belongs to — **derived from the class**, never
     * written here, for the same reason {@link properties} is.
     *
     * `dimension` is a getter on the prototype precisely so it answers before a
     * node is constructed, which is what lets a host ask "can this type go in
     * that tree?" from the registry alone rather than by building one and
     * catching the throw.
     */
    dimension?: NodeDimension;
    /**
     * The trees it takes children from: its own, or a viewport's two (a Canvas
     * 3D takes 2D and 3D); empty for a type that takes none. **Derived** from
     * the class, as {@link dimension} is.
     */
    holds?: readonly NodeDimension[];
    /**
     * Whether a host may copy this component's source.
     *
     * False for anything a host reaches into by identity — its own primitives. A
     * type is forkable exactly when the host knows nothing about it beyond this.
     */
    forkable?: boolean;

    layout?: NodeLayoutDescriptor;
    /** What a freshly placed one's props are seeded with. */
    seed?: Record<string, unknown>;

    /**
     * The types this one goes inside: a plot in a coordinate system, a tangent
     * in a plot. A name also stands for every type built on it ({@link parentKey}).
     * Unsaid, it goes wherever its {@link dimension} allows.
     *
     * A statement about the class, not a rule the engine enforces: a node put
     * elsewhere still builds and usually draws nothing, which is exactly what
     * a host is told here so it can offer the type only where it works. See
     * `placement.ts`.
     */
    within?: readonly string[];
    /**
     * Types it needs at least one of beside it, under the same parent: an area
     * between curves needs a curve. For a requirement that is not a parent,
     * because the thing needed is shared or there may be several of it.
     */
    beside?: readonly string[];
    /** Takes only the children that name it in their {@link within}: a plot holds its marks, not a photograph. */
    closed?: boolean;

    /**
     * The editable properties, by key — **derived from `property`**, never
     * written here.
     *
     * A hand-written list of a class's properties, beside a class of
     * properties, is exactly the restatement this whole descriptor exists to
     * remove. What a host needs beyond the key — a range, an enum's choices, the
     * controls inside an object-valued prop — is declared on the `property`
     * itself, which is the thing being edited.
     */
    properties?: Record<string, NodePropertyDescriptor>;
    /** Old prop keys a stored row may still carry → the entry each became. **Derived** from the component's `renamed`. */
    renamed?: Readonly<Record<string, string>>;
}

/** One editable property, as a host draws it. */
export interface NodePropertyDescriptor extends PropertyEditor {
    /** The control to draw. Always present here, inferred when not declared. */
    kind: string;
    /** What a freshly placed node holds, when the class declares one. */
    default?: unknown;
    /** Present when the component deprecated it: why, and what to use instead. A host stops offering it. */
    deprecated?: string;
}

/** The layout answer a node type's children get from it. */
export interface NodeLayoutDescriptor {
    children?: "flow" | "horizontal" | "vertical" | "grid" | "freeform";
    acceptsChildren?: boolean;
    defaultWidthMode?: NodeSizeMode;
    defaultHeightMode?: NodeSizeMode;
    /** What a freshly placed one is sized to. */
    defaultWidth?: number;
    defaultHeight?: number;
    /** A locked width:height, for a type whose box *is* its design. */
    aspectRatio?: number;
}

/** How a node type sizes one axis. */
export type NodeSizeMode = "fixed" | "hug" | "fill";
