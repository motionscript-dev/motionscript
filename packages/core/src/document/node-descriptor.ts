import type { PropertyEditor } from "@/attributes/properties/decorator";
import type { NodeDimension } from "@/components/trees/node/node";

/**
 * The technical description of a type: how it lays children out, what a fresh one is seeded with, what it
 * inherits from. Deliberately not how it is presented (no display name, icon, shelf or copy): those are a
 * host's to resolve and translate. Nothing here is read while rendering; it exists so a host has one place to
 * ask.
 */
export interface NodeTypeDescriptor {
    /** Frozen once published: a stored document naming it must keep meaning the same thing. */
    key: string;
    parentKey?: string;
    /**
     * Derived from the class, never written here. `dimension` is a getter on the prototype so it answers before a
     * node is constructed, letting a host ask "can this type go in that tree?" from the registry alone rather than
     * by building one and catching the throw.
     */
    dimension?: NodeDimension;
    /**
     * The trees it takes children from: its own, or a viewport's two (a Canvas3D takes 2D and 3D); empty for a
     * type that takes none. Derived from the class, as {@link dimension} is.
     */
    holds?: readonly NodeDimension[];
    /**
     * False for anything a host reaches into by identity (its own primitives). A type is forkable exactly when the
     * host knows nothing about it beyond this.
     */
    forkable?: boolean;

    layout?: NodeLayoutDescriptor;
    seed?: Record<string, unknown>;

    /**
     * The types this one goes inside: a plot in a coordinate system, a tangent in a plot. A name also stands for
     * every type built on it ({@link parentKey}). Unsaid, it goes wherever its {@link dimension} allows.
     *
     * A statement about the class, not an enforced rule: a node put elsewhere still builds and usually draws
     * nothing, which is what a host is told so it can offer the type only where it works. See `placement.ts`.
     */
    within?: readonly string[];
    /**
     * Types it needs at least one of beside it, under the same parent: an area between curves needs a curve. For a
     * requirement that is not a parent.
     */
    beside?: readonly string[];
    /** Takes only the children that name it in their {@link within}: a plot holds its marks, not a photograph. */
    closed?: boolean;

    /**
     * Derived from `property`, never written here: a hand-written list beside a class of properties is the
     * restatement this descriptor exists to remove. What a host needs beyond the key (a range, an enum's choices)
     * is declared on the `property` itself.
     */
    properties?: Record<string, NodePropertyDescriptor>;
    /**
     * Old prop keys a stored row may still carry, mapped to the entry each became. Derived from the component's
     * `renamed`.
     */
    renamed?: Readonly<Record<string, string>>;
}

export interface NodePropertyDescriptor extends PropertyEditor {
    kind: string;
    default?: unknown;
    /** Present when the component deprecated it: why, and what to use instead. A host stops offering it. */
    deprecated?: string;
}

export interface NodeLayoutDescriptor {
    children?: "flow" | "horizontal" | "vertical" | "grid" | "freeform";
    acceptsChildren?: boolean;
    defaultWidthMode?: NodeSizeMode;
    defaultHeightMode?: NodeSizeMode;
    defaultWidth?: number;
    defaultHeight?: number;
    aspectRatio?: number;
}

export type NodeSizeMode = "fixed" | "hug" | "fill";
