import {
  component2d,
  pathOps,
  Types,
  type NodeOf,
  type NodeView,
  type PathData,
  type Size2D,
  type Values,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import {
  ItemGrid,
  PATH_SPACINGS,
  PATH_TEMPLATES,
  staggerArgs,
  TRANSITION_STAGGER,
  templatePath,
  type PathArrangement,
  type PathPlacement,
  type PathTemplate,
} from "../kit"

/** A template, or `custom` for the grid's own `path`. */
export const PATH_GRID_SHAPES = [...PATH_TEMPLATES, "custom"] as const

const own = {
  shape: Types.oneOf(PATH_GRID_SHAPES, { default: "circle" }),
  /** Used when `shape` is `custom`: an SVG path, y-down as SVG writes one, centred on its own bounds. */
  path: Types.path,
  /** A path node to follow instead, by id — the items track it wherever it goes. */
  pathNode: ItemGrid.nodeRef(["path"]),
  spacing: Types.oneOf(PATH_SPACINGS, { default: "distribute" }),
  spacingDistance: Types.number(80, { min: 0, step: 1 }),
  /** Share of the path the items are moved along — `1` is once round. */
  offset: Types.number(0, { step: 0.01 }),
  /** Share of the path per second the items travel on their own. */
  flowSpeed: Types.number(0, { step: 0.01, unit: "/s" }),
  trimStart: Types.number(0, { min: 0, max: 1, step: 0.01 }),
  trimEnd: Types.number(1, { min: 0, max: 1, step: 0.01 }),
  alignToPath: true,
}

type Own = Values<typeof own>

const AT_ORIGIN: PathPlacement = { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1 }

/** The size a path grid is placed at when nothing says otherwise, since a template is drawn to fill it. */
const DEFAULT_SIZE = { width: 640, height: 400 }

const arranger: ItemGrid.Arranger<Own> = {
  arrangement: (s, box): PathArrangement => {
    const { path, placement } = pathIn(s, box)
    return {
      kind: "path",
      path,
      placement,
      spacing: s.spacing,
      spacingDistance: s.spacingDistance,
      offset: s.offset,
      flowSpeed: s.flowSpeed,
      trimStart: s.trimStart,
      trimEnd: s.trimEnd,
      alignToPath: s.alignToPath,
    }
  },
}

/**
 * Children along a path: one of the templates drawn to fill the node's box,
 * a path of the grid's own, or a path node elsewhere in the scene, followed
 * wherever it is.
 *
 * Items are spaced by distance along the curve, so they sit evenly on a tight
 * bend and a straight alike. Animating `offset` moves them along it — on a
 * closed path they come round again, which is a conveyor belt for free.
 */
export const PathGrid = ItemGrid.define(component2d({
  key: "pathGrid",
  state: { ...ItemGrid.state, ...own },
  // A template is drawn to fill the box, so a path grid needs one of its own
  // rather than hugging items whose places depend on it.
  defaults: { ...DEFAULT_SIZE },
  commands: {
    ...ItemGrid.commands,
    /** Move the items along the path by `loops` — `1` is once round, and they keep their spacing. */
    flow: {
      args: { loops: Types.number(1, { step: 0.25 }) },
      run: (timeline, s) => timeline.tween({ offset: s.offset + (timeline.args.loops ?? 1) }),
    },
    /** Squeeze the items into part of the path, between two shares of its length. */
    trimTo: {
      args: {
        trimStart: ItemGrid.hinted(0.25, { min: 0, max: 1, step: 0.01 }),
        trimEnd: ItemGrid.hinted(0.75, { min: 0, max: 1, step: 0.01 }),
      },
      run: (timeline, s) => timeline.tween({
        trimStart: timeline.args.trimStart ?? s.trimStart,
        trimEnd: timeline.args.trimEnd ?? s.trimEnd,
      }),
    },
    /**
     * Move the items onto another path — a template, or a path node in the
     * scene. Each item travels from its place on the old path to its place on
     * the new one; the path itself is not morphed.
     */
    setPath: {
      args: {
        shape: ItemGrid.hinted("heart", { kind: "enum", options: PATH_GRID_SHAPES }),
        pathNode: ItemGrid.nodeRefArg(["path"]),
        ...staggerArgs(TRANSITION_STAGGER),
      },
      run: (timeline, s, children) => {
        const pathNode = timeline.args.pathNode ?? ""
        const changes = pathNode ? { pathNode } : { shape: timeline.args.shape ?? s.shape, pathNode: "" }
        return ItemGrid.transitionTo(timeline as never, s, children, changes)
      },
    },
  },
  ...ItemGrid.fields(arranger),
}), arranger)

export type PathGrid = NodeOf<typeof PathGrid>

/** The path the items follow, and where its coordinates land in this grid's frame. */
function pathIn(s: Own, box: Size2D): { path: PathData; placement: PathPlacement } {
  const linked = s.pathNode
  // A document `path` draws its data in its own unit box, at its own position.
  if (linked?.key === "path") return { path: unitPath(linked), placement: { ...AT_ORIGIN, ...linked.frame } }
  // A face-value path draws its data centred on the data's own bounds, at its own position.
  const data = linked?.key === "facePath" ? dataOf(linked) : undefined
  const bounds = data !== undefined ? pathOps.bounds(data) : null
  if (linked && data !== undefined && bounds) {
    return {
      path: data,
      placement: {
        originX: (bounds.minX + bounds.maxX) / 2,
        originY: (bounds.minY + bounds.maxY) / 2,
        ...linked.frame,
      },
    }
  }
  if (s.shape === "custom") {
    const own = pathOps.bounds(s.path)
    if (own) {
      return {
        path: s.path,
        placement: {
          ...AT_ORIGIN,
          originX: (own.minX + own.maxX) / 2,
          originY: (own.minY + own.maxY) / 2,
          flipY: true,
        },
      }
    }
  }
  const template: PathTemplate = s.shape === "custom" ? "circle" : s.shape
  return { path: templatePath(template, box), placement: AT_ORIGIN }
}

function dataOf(view: NodeView): PathData {
  return (view.state as { readonly data: PathData }).data
}

const unitPaths = new WeakMap<NodeView, { data: PathData; width: number; height: number; path: PathData }>()

/**
 * A path node's geometry as it draws it: stored in its unit box, y-down, and
 * scaled to its laid-out size — kept while neither changes, so the path's
 * measurement is kept with it.
 */
function unitPath(view: NodeView): PathData {
  const data = dataOf(view)
  const { width, height } = view.size
  const cached = unitPaths.get(view)
  if (cached && cached.data === data && cached.width === width && cached.height === height) return cached.path
  const path = pathOps.anchorCommands(pathOps.anchors(data), (p) => ({ x: p.x * width, y: -p.y * height }))
  unitPaths.set(view, { data, width, height, path })
  return path
}
