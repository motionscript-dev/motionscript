import {
  Rect,
  Text,
  Types,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  type Node2D,
} from "@motionscript/sdk";

import { asParts, fresh } from "../kit/entries";
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion";
import {
  DEFAULT_X_AXIS,
  enterBudget,
  type AxisConfig,
  type Range,
} from "../kit/shared";
import { markerCaption } from "../kit/vertical-axis";

/** How far a marker starts above its slot when it enters, in px. */
const SLIDE = 24;

/**
 * The horizontal axis of a {@link LineChart}: a **row of {@link Text} nodes**,
 * one per marker value, running left-to-right. Pure layout — the mirror of the
 * kit's `VerticalAxis`, including its bound (not snapshotted) marker text and
 * positions, and its landed resting state.
 *
 * Markers are always placed **by value** across the range, whatever they say:
 * `2026-03` sits three months along, not three slots along. That is what keeps
 * it distinct from a bar chart's bottom axis, which centres a caption on each
 * slot and has no scale at all — the two only look alike. What the values are
 * captioned *as* is the chart's to decide, in `captions`.
 *
 * `enter` staggers the markers in **left-to-right**: each starts lifted a
 * little above its slot and transparent, then fades and slides down into place.
 */
export const HorizontalAxis = component2d({
  key: "horizontalAxis",
  state: {
    /** `[min, max]` of the horizontal scale the markers are positioned within. */
    range: fresh<Range>(() => [0, 1]),
    /** Tick values (in data units) to draw along the axis. */
    markers: fresh<number[]>(() => []),
    /**
     * How each marker is captioned, one per entry of `markers` and in its order.
     * Empty (the default), or short, captions a marker with its bare numeric
     * reading; a chart whose x column names months or categories writes those.
     */
    captions: fresh<string[]>(() => []),
    /** Marker/caption text style, grid stroke, and gutters — see {@link AxisConfig}. */
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    /** Caption drawn centred in the gutter beneath the marker row; empty (the default) hides it. */
    label: "",
    arrivals: arrivalsEntry(),
  },
  // A plain node filled its parent; one made of its markers would hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const tickPad = insetsOps.resolve(state.axis.tickPadding).top;
    const titlePad = insetsOps.resolve(state.axis.titlePadding).top;

    const column: Node2D[] = [];
    // The column's parent is the axis: its box is what the markers are placed in.
    const box = () => (column[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? { width: 0, height: 0 };
    /** The live tick values, left → right — re-read every frame, not snapshotted. */
    const sorted = () => [...state.markers].sort((a, b) => a - b);
    /** Tick `i`'s fraction across the live `range`, 0 at the left edge. */
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
          // Held inside the axis's right edge, which is also the *chart's*: the
          // last marker is centred on the last grid line, so half of `2026-06`
          // — or of `3300` — would be drawn outside the node's box and outside
          // the rectangle the editor draws around it. Only the right edge is
          // held, because the left one has the vertical axis's whole gutter
          // beyond it, and a marker overhanging into that is inside the chart.
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
    /**
     * Stagger the markers in left to right, then slide the caption in after
     * them. Its first frame arms them all: lifted by `slide` and transparent.
     *
     * The timeline's duration is the **whole** entrance — see
     * `VerticalAxis.enter` and {@link enterBudget}.
     */
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
        // Left marker leads: the row is already left → right.
        const markers = state.markers.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }));
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : [];
        return timeline.together([arm, beats(timeline, [...markers, ...label])]);
      },
    },
  },
});

export type HorizontalAxis = NodeOf<typeof HorizontalAxis>;
