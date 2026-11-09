/**
 * @deprecated A duplicate of the stable authoring surface, kept until the next
 * major: import from `@motionscript/sdk` (or `@motionscript/core/sdk`), where
 * `TextStyle` is `Typeface` and `Corners` is `Shapes.corners` / `Shapes.rect`.
 */
import { component2d as _component2d } from "@/components/factory/component2d";
import { componentAudio as _componentAudio } from "@/components/factory/component-audio";
import { component3d as _component3d } from "@/components/factory/component3d";
import { commandsFor as _commandsFor } from "@/components/factory/commands-for";
import { Types as _Types } from "@/components/factory/types";
import { provides as _provides } from "@/components/factory/api";

// Re-export statements cannot carry `@deprecated`, so the values are re-declared.
/** @deprecated Import `component2d` from `@motionscript/sdk`. */
export const component2d = _component2d;
/** @deprecated Import `componentAudio` from `@motionscript/sdk`. */
export const componentAudio = _componentAudio;
/** @deprecated Import `component3d` from `@motionscript/sdk`. */
export const component3d = _component3d;
/** @deprecated Import `commandsFor` from `@motionscript/sdk`. */
export const commandsFor = _commandsFor;
/** @deprecated Import `Types` from `@motionscript/sdk`. */
export const Types = _Types;
/** @deprecated Import `provides` from `@motionscript/sdk`. */
export const provides = _provides;

export type { Attribute, EntryOptions, NumberOptions, TextOptions } from "@/components/factory/types";
export type {
    Box2DState, BoxAudioState, CallProps, ChildView, Children2D, Component, Element, Entry, InOf, Inputs, Loader,
    Measurer, MergePaint, NodeOf, NodeView, OutOf, Piece, Placement2D, Provided, RenderContext2D, SoundOptions, StateSpec,
    Timeline, Type, Values, Writes, Merge, BuiltNode, CallProps3D, Placement3DProps, RenderContext3D, Transform3DState, Handle, LayoutBox, NodeFrame,
} from "@/components/factory/api";
export * as Paint from "@/components/modules/paint";
export * as Flow from "@/components/modules/flow";
export * as Corners from "@/components/modules/corners";
export * as Shapes from "@/components/modules/shapes";
export * as Aim from "@/components/modules/aim";
export * as TextStyle from "@/components/modules/text-style";
export * as TextLayout from "@/components/modules/text-layout";
export * as Material from "@/components/modules/material";
export * as View3D from "@/components/modules/view3d";
