import {
  commandsFor,
  easeIn,
  easeInOut,
  easeOut,
  flowOps,
  insetsOps,
  Types,
  type ChildView,
  type InsetsResolved,
  type LayoutBox,
  type LayoutItem,
  type Measurer,
  type Node2D,
  type NodeFrame,
  type NodeView,
  type Piece,
  type Placement2D,
  type RenderContext,
  type Size2D,
  type SpaceCamera,
  type Timeline,
  type Values,
} from "@motionscript/sdk"

import {
  applyItemEffects,
  REVEAL_STYLES,
  WAVE_STYLES,
  type FocusState,
  type RevealState,
  type WaveState,
} from "./item-effects"
import { normalizeOrder, parseOrder, slotOfItem } from "./order"
import { hashSeed, shuffled } from "./random"
import { blendSlot, focalLengthOf, slotsOf, spreadSlot, type Arrangement, type Slot } from "./slots"
import { STAGGER_ORDERS, staggerProgress, staggerRanks, type StaggerOrder } from "./stagger"

// What every grid is built from: spread `state`, `commands` and `defaults` in, give `fields` the
// {@link Arranger} that makes the arrangement from the state, and pass the component and its
// arranger through {@link define}.
// The items are the children in layer order; a slot is a parent transform on a child, so its own
// x/y/rotation/scale and their commands still work relative to it.
// Every frame measures the children, asks the arrangement for slots (pure in state, sizes and
// clock), blends from the arrangement a transition leaves, and layers the per-item effects; the
// result is each child's box and slot, which rendering, picking and `global` all read.
// Every command is a pure function of time. Per-item ones stagger inside their duration and write
// their state to entries, which keeps them seekable; ones that change the arrangement keep the one
// they leave as data and blend each item from its old slot to its new.

/** An arrangement a grid is leaving, kept as data so its slots can be worked out afresh every frame. */
export interface GridSnapshot {
  arrangement: Arrangement
  /** The grid the arrangement was borrowed from, or `""` for the grid's own. */
  source: string
  order: readonly number[]
  spread: number
}

/** A change of arrangement under way: where the items are coming from, and how far each has come. */
export interface GridTransition {
  from: GridSnapshot
  /** Each item's eased, staggered progress, `0..1`. */
  mix: readonly number[]
}

/** The stagger options every per-item command takes. */
export interface StaggerArgs {
  staggerOrder?: StaggerOrder
  /** `0..0.95`: how much of the command's length the items' offsets take up. */
  stagger?: number
}

/**
 * Every grid's document key — what a reference to "another grid" may name. A
 * `nodeRef` descriptor carries it as `nodeTypes`, for a host's picker to offer
 * only those.
 */
export const ITEM_GRID_TYPES = ["rectangularGrid", "radialGrid", "pathGrid", "sphereGrid"] as const

/** The stagger a move to new slots takes when its command states none. */
export const TRANSITION_STAGGER = 0.3

/** A reference to another node, a host's picker offering only `types`. Its fields read a view of it. */
export function nodeRef(types: readonly string[]) {
  const described = { kind: "nodeRef", nodeTypes: types, animatable: false }
  return Types.custom<string, NodeView | null>("", described)
}

/** The stagger args every per-item command takes, `stagger` defaulting to `fallback`. */
export function staggerArgs(fallback: number) {
  return {
    staggerOrder: Types.oneOf(STAGGER_ORDERS, { default: "index" }),
    stagger: Types.number(fallback, { min: 0, max: 0.95, step: 0.05 }),
  }
}

/**
 * A command arg a host fills in with `hint`, which a row may leave out: the
 * command then keeps what the grid has. A run arg's default is both what a
 * host offers and what an omitted arg means, so the hint rides on the arg's
 * description alone, and an omitted arg reads `undefined`.
 */
export function hinted<T extends number | string>(hint: T, options: object = {}) {
  const described: Record<string, unknown> = { ...options, default: hint }
  return Types.custom<T | undefined>(undefined, described as never)
}

/** A command arg naming another node, a host's picker offering only `types`; left out, it reads `undefined`. */
export function nodeRefArg(types: readonly string[]) {
  const described = { kind: "nodeRef", nodeTypes: types }
  return Types.custom<string | undefined>(undefined, described)
}

/** The state every grid shares. */
export const state = {
  /** Items in slot order: slot `k` holds child `order[k]`. Empty is the children's own order. */
  order: Types.custom<number[]>([], { kind: "order", animatable: false }),
  /** `0` gathers every item at the centre, `1` is the arrangement, past `1` pushes them apart. */
  spread: Types.number(1, { min: 0, max: 3, step: 0.05 }),
  /** Another grid whose arrangement this one takes on — what `morphInto` animates. */
  arrangeLike: nodeRef(ITEM_GRID_TYPES),
  // What the per-item commands write. State rather than settings: a command
  // owns each while it runs, and a document has no reason to name them. Unset
  // until a command writes one, so a fresh node's row does not state them.
  revealState: Types.custom<RevealState | null | undefined>(undefined, { kind: "state", animatable: false }),
  waveState: Types.custom<WaveState | null | undefined>(undefined, { kind: "state", animatable: false }),
  focusState: Types.custom<FocusState | null | undefined>(undefined, { kind: "state", animatable: false }),
  transition: Types.custom<GridTransition | null | undefined>(undefined, { kind: "state", animatable: false }),
  /** The grid a transition's leaving arrangement was borrowed from, followed while the items travel. */
  transitionSource: Types.custom<string, NodeView | null, { readonly private: true }>("", { kind: "nodeRef", private: true }),
}

/** A grid's size is what its items come to, whether it was built with children or they arrive after it. */
export const defaults = { width: "hug", height: "hug" } as const

/** What a grid's commands read of its state, beyond its own arrangement's entries. */
export type GridValues = Values<typeof state> & { readonly padding: InsetsResolved }

/** What a grid's measure, layout and render read of its state, beyond its own arrangement's entries. */
export type GridState = GridValues & {
  readonly width: LayoutItem["width"]
  readonly height: LayoutItem["height"]
  readonly children: readonly ChildView[]
}

/** What makes one grid's arrangement from its state: the rest of a grid is this module. */
export interface Arranger<S = unknown> {
  /** This grid's own arrangement, for a content box of `box`. */
  arrangement(state: S, box: Size2D): Arrangement
  /** The room each item is measured in — the whole content box, unless the arrangement has cells. */
  itemSpace?(state: S, count: number, space: Size2D): Size2D
}

type GridComponent = { readonly key: string; readonly node: abstract new (...args: never[]) => object }

const GRIDS = new Map<string, { readonly component: GridComponent; readonly arranger: Arranger<never> }>()

/**
 * `component` as a grid: registers its `arranger`, which another grid borrowing
 * its arrangement or morphing into it reads it by, and which {@link isGrid} knows it by.
 */
export function define<C extends GridComponent, S>(component: C, arranger: Arranger<S>): C {
  GRIDS.set(component.key, { component, arranger: arranger as Arranger<never> })
  return component
}

/** Whether `value` is a node of one of the grids {@link define} has seen. */
export function isGrid(value: unknown): boolean {
  for (const { component } of GRIDS.values()) if (value instanceof component.node) return true
  return false
}

/** The grid's measure, layout and render, for `arranger`'s arrangement: spread them into the component. */
export function fields<S>(arranger: Arranger<S>) {
  return {
    measure: (measurer: Measurer, s: GridState & S, children: readonly ChildView[]) => measure(measurer, s, children, arranger),
    layout: (box: LayoutBox, s: GridState & S, children: readonly ChildView[]) => layout(box, s, children, arranger),
    render: (ctx: RenderContext, s: GridState & S) => render(ctx, s, arranger),
  }
}

const NO_CONTENT: Size2D = { width: 0, height: 0 }
const CENTRE = { x: 0, y: 0 }

/** What `measure` found, for `layout` to reuse in the same pass. Keyed by the grid's state, one object per node. */
const measured = new WeakMap<object, { space: Size2D; sizes: Size2D[] }>()

export function measure<S>(measurer: Measurer, s: GridState & S, children: readonly ChildView[], arranger: Arranger<S>): Size2D {
  const constraints = { maxWidth: measurer.max.width, maxHeight: measurer.max.height }
  const padding = s.padding
  if (children.length === 0) {
    measured.delete(s)
    return flowOps.size(s, constraints, padding, NO_CONTENT)
  }
  const space = flowOps.contentBox(s, constraints, padding)
  const sizes = measureItems(children, space, s, arranger)
  measured.set(s, { space, sizes })
  const grid = { state: s, arranger, children, isSelf: sharesChildren(children) }
  const target = targetSlots(grid, sizes.length, sizes, space, measurer.time.total)
  return flowOps.size(s, constraints, padding, extentOf(target.slots, sizes, focalOf(s, target.arrangement)))
}

export function layout<S>(box: LayoutBox, s: GridState & S, children: readonly ChildView[], arranger: Arranger<S>): readonly Placement2D[] {
  const kept = measured.get(s)
  measured.delete(s)
  if (children.length === 0) return []
  const inner = insetsOps.insetBounds(box.width, box.height, s.padding)
  const sizes = kept && kept.sizes.length === children.length && sameSize(kept.space, inner)
    ? kept.sizes
    : measureItems(children, inner, s, arranger)
  const slots = resolve({ state: s, arranger, children, isSelf: sharesChildren(children) }, sizes, inner, box.time.total)
  return slots.map((slot, i) => placement(inner, slot, sizes[i]))
}

/** A grid with depth is seen through a camera of its own, painting far to near, unless it already sits in a space, whose camera its items join. */
export function render<S>(ctx: RenderContext, s: GridState & S, arranger: Arranger<S>): void {
  // With no items there is nothing to see through a camera.
  const focal = s.children.length === 0 ? 0 : focalOf(s, arrangementOf({ state: s, arranger, children: [], isSelf: () => false }, contentBox(ctx.size, s.padding)))
  if (focal > 0 && !ctx.inSpace) ctx.space(cameraAt(focal))
  else ctx.children()
}

/** Its laid-out size inside its padding. */
export function contentBoxOf(grid: Node2D): Size2D {
  const b = grid.layoutBounds
  return contentBox({ width: b.width, height: b.height }, grid.effectivePadding())
}

type GridTimeline = Timeline<StaggerArgs, never>

/** Each item's slot as the arrangement stands while a command is built (the tree stands at time 0 then): what its stagger is ranked by. */
export function itemSlots(timeline: Timeline<object, never>, s: GridValues, children: readonly ChildView[]): Slot[] {
  const grid = commandGrid(timeline, s, children)
  const sizes = children.map((child) => child.size)
  return targetSlots(grid, children.length, sizes, contentBox(timeline.node.size, s.padding), 0).slots
}

/** Each item's start in a stagger. A random order is seeded by the node's id, so it never changes between builds. */
export function ranks(timeline: Timeline<object, never>, s: GridValues, children: readonly ChildView[], order: StaggerOrder | undefined): number[] {
  return staggerRanks(order ?? "index", itemSlots(timeline, s, children), hashSeed(timeline.node.id))
}

/** Writes `changes` to the arrangement and moves each item, staggered, from its slot in the one being left to its slot in the new one. */
export function transitionTo(
  timeline: GridTimeline,
  s: GridValues,
  children: readonly ChildView[],
  changes: Record<string, unknown>,
  stagger = TRANSITION_STAGGER,
): Piece {
  const from = snapshot(timeline, s, children)
  const ease = timeline.easing ?? easeInOut("cubic")
  const order = ranks(timeline, s, children, timeline.args.staggerOrder)
  const spread = timeline.args.stagger ?? stagger
  return timeline.animate((t) => {
    if (t >= 1) return { ...changes, transition: null, transitionSource: "" } as never
    const mix = order.map((rank) => ease(staggerProgress(rank, t, spread)))
    return { ...changes, transition: { from, mix }, transitionSource: from.source } as never
  }, { eased: false })
}

/** Emphasise the items `isFocus` picks and push the rest back. */
export function focusOn(
  timeline: Timeline<object, never>,
  s: GridValues,
  isFocus: (item: number) => boolean,
  count: number,
  dim: number,
  grow: number,
): Piece {
  const from = s.focusState
  const target = Array.from({ length: count }, (_, i) => (isFocus(i) ? 1 : -1))
  const ease = timeline.easing ?? easeInOut("cubic")
  return timeline.animate((t) => {
    const e = ease(t)
    return {
      focusState: {
        dim: lerp(from?.dim ?? dim, dim, e),
        grow: lerp(from?.grow ?? grow, grow, e),
        values: target.map((v, i) => lerp(from?.values[i] ?? 0, v, e)),
      },
    } as never
  }, { eased: false })
}

// What the commands are typed against: the shared state, and the padding every node has.
const GRID_STATE = { ...state, padding: Types.insets }

export const commands = commandsFor(GRID_STATE, {
  /**
   * Bring the items in, one after another. Every item starts hidden, so place
   * it where the grid enters — or after a `conceal`.
   */
  reveal: {
    args: { style: Types.oneOf(REVEAL_STYLES, { default: "scale" }), ...staggerArgs(0.5) },
    run: (timeline, s, children) => {
      const style = timeline.args.style ?? "scale"
      const ease = timeline.easing ?? (style === "scale" || style === "flip" ? easeOut("back") : easeOut("cubic"))
      const order = ranks(timeline as never, s, children, timeline.args.staggerOrder)
      const stagger = timeline.args.stagger ?? 0.5
      return timeline.animate((t) => {
        if (t >= 1) return { revealState: null }
        return { revealState: { style, values: order.map((rank) => ease(staggerProgress(rank, t, stagger))) } }
      }, { eased: false })
    },
  },
  /** Take the items out, one after another — `reveal` in reverse. They stay hidden after. */
  conceal: {
    args: { style: Types.oneOf(REVEAL_STYLES, { default: "scale" }), ...staggerArgs(0.5) },
    run: (timeline, s, children) => {
      const style = timeline.args.style ?? "scale"
      const ease = timeline.easing ?? (style === "scale" || style === "flip" ? easeIn("back") : easeInOut("cubic"))
      const order = ranks(timeline as never, s, children, timeline.args.staggerOrder)
      const stagger = timeline.args.stagger ?? 0.5
      const from = s.revealState?.values
      return timeline.animate((t) => ({
        revealState: {
          style,
          values: order.map((rank, i) => (from?.[i] ?? 1) * (1 - ease(staggerProgress(rank, t, stagger)))),
        },
      }), { eased: false })
    },
  },
  /** Send a ripple through the items that swells each in turn and settles back. */
  wave: {
    args: {
      style: Types.oneOf(WAVE_STYLES, { default: "scale" }),
      amount: Types.number(0.3, { min: 0, max: 2, step: 0.05 }),
      ...staggerArgs(0.7),
    },
    run: (timeline, s, children) => {
      const style = timeline.args.style ?? "scale"
      const amount = timeline.args.amount ?? 0.3
      const ease = timeline.easing ?? easeInOut("sine")
      const order = ranks(timeline as never, s, children, timeline.args.staggerOrder)
      const stagger = timeline.args.stagger ?? 0.7
      return timeline.animate((t) => {
        if (t >= 1) return { waveState: null }
        return { waveState: { style, amount, values: order.map((rank) => Math.sin(Math.PI * ease(staggerProgress(rank, t, stagger)))) } }
      }, { eased: false })
    },
  },
  /** Bring one item (by its place in the layers, from 0) forward and push the rest back. */
  focus: {
    args: {
      item: Types.number(0, { min: 0, step: 1 }),
      dim: Types.number(0.7, { min: 0, max: 1, step: 0.05 }),
      grow: Types.number(0.15, { min: 0, max: 1, step: 0.05 }),
    },
    run: (timeline, s, children) => {
      const item = Math.round(timeline.args.item ?? 0)
      return focusOn(timeline as never, s, (i) => i === item, children.length, timeline.args.dim ?? 0.7, timeline.args.grow ?? 0.15)
    },
  },
  /** Bring every item back to even. */
  unfocus: (timeline, s) => {
    const from = s.focusState
    const ease = timeline.easing ?? easeInOut("cubic")
    return timeline.animate((t) => {
      if (t >= 1 || !from) return { focusState: null }
      const k = 1 - ease(t)
      return { focusState: { ...from, values: from.values.map((v) => v * k) } }
    }, { eased: false })
  },
  /** Gather the items toward the centre (`0`), back to the arrangement (`1`), or push them apart. */
  spreadTo: {
    args: { spread: Types.number(1, { min: 0, max: 3, step: 0.05 }) },
    run: (timeline) => timeline.tween({ spread: timeline.args.spread ?? 1 }),
  },
  /** Send every item to a random slot. The same `seed` always deals the same way. */
  shuffle: {
    args: { seed: Types.number(1, { min: 0, step: 1 }), ...staggerArgs(TRANSITION_STAGGER) },
    run: (timeline, s, children) => {
      const current = normalizeOrder(s.order, children.length)
      let next = shuffled(current, timeline.args.seed ?? 1)
      // A shuffle that deals everything back where it was would look like nothing happened.
      if (next.length > 1 && next.every((item, k) => item === current[k])) next = [...next.slice(1), next[0]]
      return transitionTo(timeline as never, s, children, { order: next })
    },
  },
  /** Two items trade places, by their place in the layers. */
  swap: {
    args: {
      first: Types.number(0, { min: 0, step: 1 }),
      second: Types.number(1, { min: 0, step: 1 }),
      ...staggerArgs(0),
    },
    run: (timeline, s, children) => {
      const order = normalizeOrder(s.order, children.length)
      const a = order.indexOf(Math.round(timeline.args.first ?? 0))
      const b = order.indexOf(Math.round(timeline.args.second ?? 1))
      if (a >= 0 && b >= 0) [order[a], order[b]] = [order[b], order[a]]
      return transitionTo(timeline as never, s, children, { order }, 0)
    },
  },
  /** Move the items into a new order — a list of layer indices, first slot first, like `"2, 0, 1"`. */
  reorder: {
    args: { order: Types.text(""), ...staggerArgs(TRANSITION_STAGGER) },
    run: (timeline, s, children) => {
      const order = normalizeOrder(parseOrder(timeline.args.order), children.length)
      return transitionTo(timeline as never, s, children, { order })
    },
  },
  /**
   * Move every item into another grid's arrangement — a grid into a ring, a ring
   * onto a sphere — and keep following it. An empty `target` morphs back to
   * this grid's own.
   */
  morphInto: {
    args: { target: nodeRefArg(ITEM_GRID_TYPES), ...staggerArgs(TRANSITION_STAGGER) },
    run: (timeline, s, children) => transitionTo(timeline as never, s, children, { arrangeLike: timeline.args.target ?? "" }),
  },
})

interface Grid {
  readonly state: GridValues
  readonly arranger: Arranger<never>
  readonly children: readonly ChildView[]
  /** Whether a view is this grid itself, which borrows nothing from itself. */
  readonly isSelf: (view: NodeView) => boolean
}

function arrangerOf(key: string): Arranger<never> {
  const grid = GRIDS.get(key)
  if (!grid) throw new Error(`"${key}" is no grid: pass its component through ItemGrid.define.`)
  return grid.arranger
}

/** A grid `view` names, when it is one this kit can arrange and not the reader itself. */
function gridIn(view: NodeView | null | undefined, grid: Grid): { view: NodeView; arranger: Arranger<never> } | null {
  if (!view) return null
  const found = GRIDS.get(view.key)
  if (!found || grid.isSelf(view)) return null
  return { view, arranger: found.arranger }
}

/** In layout, a view is this grid when it holds the same children: a child has one parent. */
function sharesChildren(children: readonly ChildView[]): (view: NodeView) => boolean {
  return (view) => {
    if (children.length === 0) return false
    const theirs = (view.state as { readonly children?: readonly ChildView[] }).children
    return theirs?.[0] === children[0]
  }
}

function commandGrid(timeline: Timeline<object, never>, s: GridValues, children: readonly ChildView[]): Grid {
  return { state: s, arranger: arrangerOf(timeline.node.key), children, isSelf: (view) => view.id === timeline.node.id }
}

function snapshot(timeline: Timeline<object, never>, s: GridValues, children: readonly ChildView[]): GridSnapshot {
  const grid = commandGrid(timeline, s, children)
  const source = gridIn(s.arrangeLike, grid)
  return {
    arrangement: source
      ? source.arranger.arrangement(source.view.state as never, viewBox(source.view))
      : grid.arranger.arrangement(s as never, contentBox(timeline.node.size, s.padding)),
    source: source?.view.id ?? "",
    order: normalizeOrder(s.order, children.length),
    spread: s.spread,
  }
}

function measureItems(children: readonly ChildView[], space: Size2D, s: unknown, arranger: Arranger<never>): Size2D[] {
  const sizes = children.map((child) => child.measure(space))
  const cell = arranger.itemSpace ? arranger.itemSpace(s as never, children.length, space) : space
  if (cell === space) return sizes
  return children.map((child) => child.measure(cell))
}

/** The arrangement the grid is heading for: the one it borrows, or its own. */
function arrangementOf(grid: Grid, box: Size2D): Arrangement {
  const source = gridIn(grid.state.arrangeLike, grid)
  return source ? source.arranger.arrangement(source.view.state as never, viewBox(source.view)) : grid.arranger.arrangement(grid.state as never, box)
}

/** Where each item sits in the arrangement it is heading for, before any transition or effect. */
function targetSlots(grid: Grid, count: number, sizes: readonly Size2D[], box: Size2D, time: number): { slots: Slot[]; arrangement: Arrangement } {
  const s = grid.state
  const source = gridIn(s.arrangeLike, grid)
  const sourceBox = source ? viewBox(source.view) : box
  const arrangement = source ? source.arranger.arrangement(source.view.state as never, sourceBox) : grid.arranger.arrangement(s as never, box)
  let slots = slotsOf(arrangement, { count, sizes, box: sourceBox, time })
  if (source) slots = inFrame(source.view.frame, slots)
  const slotOf = slotOfItem(normalizeOrder(s.order, count))
  return { slots: slotOf.map((k) => spreadSlot(slots[k], s.spread)), arrangement }
}

/** Each item's final slot this frame: the target, blended from any transition, with its effects on. */
function resolve(grid: Grid, sizes: readonly Size2D[], box: Size2D, time: number): Slot[] {
  const s = grid.state
  const count = sizes.length
  const slots = targetSlots(grid, count, sizes, box, time).slots
  const transition = s.transition
  if (transition) {
    const { from } = transition
    const named = from.source ? s.transitionSource : null
    const source = named && named.id === from.source && GRIDS.has(named.key) ? named : null
    const self = source !== null && grid.isSelf(source)
    const fromBox = source && !self ? viewBox(source) : box
    let leaving = slotsOf(from.arrangement, { count, sizes, box: fromBox, time })
    if (source && !self) leaving = inFrame(source.frame, leaving)
    const slotOf = slotOfItem(normalizeOrder(from.order, count))
    for (let i = 0; i < count; i++) {
      slots[i] = blendSlot(spreadSlot(leaving[slotOf[i]], from.spread), slots[i], transition.mix[i] ?? 1)
    }
  }
  const reveal = s.revealState
  const wave = s.waveState
  const focus = s.focusState
  if (reveal || wave || focus) {
    for (let i = 0; i < count; i++) applyItemEffects(slots[i], i, sizes[i], reveal, wave, focus)
  }
  return slots
}

/** The camera distance the grid is seen through: the target's, or, while a morph runs, the one it is leaving. */
function focalOf(s: GridValues, target: Arrangement): number {
  // A morph into or out of depth keeps the camera for its whole length.
  return focalLengthOf(target) || (s.transition ? focalLengthOf(s.transition.from.arrangement) : 0)
}

function cameraAt(focal: number): SpaceCamera {
  return {
    perspective: focal,
    orbit: 0,
    elevation: 0,
    dolly: 0,
    lookAt: CENTRE,
    zoom: 1,
    heading: 0,
    viewportX: 0,
    viewportY: 0,
  }
}

/** A slot as a child's placement: its box centred on the slot, and the slot's transform when it has one. */
function placement(inner: { x: number; y: number }, s: Slot, size: Size2D): Placement2D {
  const box = { x: inner.x + s.x, y: s.y - inner.y, width: size.width, height: size.height }
  if (s.rotation === 0 && s.scale === 1 && s.rotationX === 0 && s.rotationY === 0 && s.depth === 0 && s.opacity === 1) return box
  return {
    ...box,
    rotation: s.rotation,
    scale: s.scale,
    rotationX: s.rotationX,
    rotationY: s.rotationY,
    depth: s.depth,
    opacity: s.opacity,
  }
}

/** `slots`, laid out in another grid's frame, moved into this grid's. */
function inFrame(frame: NodeFrame, slots: Slot[]): Slot[] {
  return slots.map((s) => {
    const p = rotateClockwise(s.x * frame.scale, s.y * frame.scale, frame.rotation)
    return {
      ...s,
      x: frame.x + p.x,
      y: frame.y + p.y,
      depth: s.depth * frame.scale,
      rotation: s.rotation + frame.rotation,
      scale: s.scale * frame.scale,
    }
  })
}

function viewBox(view: NodeView): Size2D {
  return contentBox(view.size, (view.state as { readonly padding: InsetsResolved }).padding)
}

/** A box of `size` inside `padding`: what a command reads as its grid's content box from `timeline.node.size`. */
export function contentBox(size: Size2D, padding: InsetsResolved): Size2D {
  const inner = insetsOps.insetBounds(size.width, size.height, padding)
  return { width: inner.width, height: inner.height }
}

/** The box, centred on the grid, that holds every item where its slot puts it. */
function extentOf(slots: readonly Slot[], sizes: readonly Size2D[], focal: number): Size2D {
  let halfWidth = 0
  let halfHeight = 0
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    const size = sizes[i]
    const rad = (s.rotation * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    // What the camera does to a slot at depth, so a sphere hugs its front.
    const lens = focal > 0 && focal - s.depth > 1 ? focal / (focal - s.depth) : 1
    const w = ((size.width * cos + size.height * sin) / 2) * s.scale * lens
    const h = ((size.width * sin + size.height * cos) / 2) * s.scale * lens
    halfWidth = Math.max(halfWidth, Math.abs(s.x) * lens + w)
    halfHeight = Math.max(halfHeight, Math.abs(s.y) * lens + h)
  }
  return { width: halfWidth * 2, height: halfHeight * 2 }
}

function rotateClockwise(x: number, y: number, degrees: number): { x: number; y: number } {
  if (degrees === 0) return { x, y }
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos + y * sin, y: -x * sin + y * cos }
}

function sameSize(a: Size2D, b: Size2D): boolean {
  return Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.height - b.height) < 1e-6
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
