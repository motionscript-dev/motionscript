import {
  Rect,
  Text,
  Types,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk";
import { enterBudget } from "@motionscript/sdk/component";

import { asParts, fresh } from "../kit/entries";
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion";
import {
  DEFAULT_X_AXIS,
  type AxisConfig,
  type Range,
} from "../kit/shared";
import { markerCaption } from "../kit/vertical-axis";

const SLIDE = 24;

/**
 * The horizontal axis of a {@link LineChart}: a row of {@link Text} markers, the
 * mirror of `VerticalAxis` (bound text and positions, landed resting state).
 * Markers are placed by value across the range, whatever they say: `2026-03`
 * sits three months along, not three slots along, unlike a bar chart's axis.
 */
export const HorizontalAxis = component2d({
  key: "horizontalAxis",
  state: {
    range: fresh<Range>(() => [0, 1]),
    /** Tick values in data units. */
    markers: fresh<number[]>(() => []),
    /** One caption per marker in its order; a missing one reads as the bare numeric value. */
    captions: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    /** Caption centred beneath the markers; empty hides it. */
    label: "",
    arrivals: arrivalsEntry(),
  },
  // A node made of markers would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const tickPad = insetsOps.resolve(state.axis.tickPadding).top;
    const titlePad = insetsOps.resolve(state.axis.titlePadding).top;

    const column: Node2D[] = [];
    // The column's parent is the axis, whose box the markers are placed in.
    const box = () => (column[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? { width: 0, height: 0 };
    const sorted = () => [...state.markers].sort((a, b) => a - b);
    const fracAt = (value: number | undefined) => {
      if (value === undefined) return 0;
      const [min, max] = state.range;
      return max <= min ? 0 : (value - min) / (max - min);
    };

    const markers = state.markers.map((_, i) => {
      const marker: Node2D = new Text({
        ...textOps.styleProps(state.axis.labelStyle),
        text: () => {
          const value = sorted()[i];
          return value === undefined ? "" : markerCaption(state, value);
        },
        x: () => {
          const width = box().width;
          const centred = (fracAt(sorted()[i]) - 0.5) * width;
          // Held inside the right edge, the chart's own: the last marker is centred on the last grid line, so half of it would fall outside the box. The left edge has the vertical axis's gutter beyond it.
          const limit = width / 2 - marker.layoutBounds.width / 2;
          return Math.min(centred, limit);
        },
        opacity: () => arrivalOf(state.arrivals, i).opacity,
        y: () => arrivalOf(state.arrivals, i).shift,
      });
      return marker;
    });

    const children: Node2D[] = [
      new Rect({ width: "fill", height: "hug", padding: { top: tickPad }, children: markers }),
    ];
    if (state.label !== "") {
      children.push(
        new Text({
          ...textOps.styleProps(state.axis.titleStyle),
          text: state.label,
          opacity: () => arrivalOf(state.arrivals, "label").opacity,
          y: () => arrivalOf(state.arrivals, "label").shift,
        }),
      );
    }

    column.push(new Rect({ flow: "vertical", gap: titlePad, height: "hug", width: "fill", children }));
    return asParts(column);
  },
  commands: {
    /** Stagger markers in left to right, then the caption. The duration is the whole entrance ({@link enterBudget}). */
    enter: {
      args: {
        stagger: Types.custom<number | undefined>(undefined),
        slide: Types.number(SLIDE),
      },
      run: (timeline, state) => {
        const { stagger, slide } = timeline.args;
        const count = state.markers.length;
        const captioned = state.label !== "";
        const from: Arrival = { opacity: 0, shift: slide };
        const keys = [...state.markers.keys(), ...(captioned ? ["label"] : [])];
        const arm = timeline.animate(() => ({ arrivals: armed(keys, from) }));
        if (count === 0) return arm;
        const { step, per, caption } = enterBudget(timeline.duration, count, captioned, stagger);
        const ease = frameEase(timeline);
        const markers = state.markers.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }));
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : [];
        return timeline.together([arm, beats(timeline, [...markers, ...label])]);
      },
    },
  },
});

export type HorizontalAxis = NodeOf<typeof HorizontalAxis>;
