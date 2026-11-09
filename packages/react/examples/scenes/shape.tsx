import type { CompositionDocument } from "@motionscript/core";

/**
 * A scene as **data**: a node row that brings the polygram into being, and a
 * `to` that animates it.
 *
 * There is no function body to run. Every frame is `at + duration` arithmetic
 * over this list, so the scene can be asked what it looks like at 1.2s without
 * having drawn 0s first.
 */
const shapeScene: CompositionDocument = {
  kind: "composition",
  nodes: [
    {
      id: "",
      type: "canvas2d",
      parentId: null,
      layerOrder: 0,
      props: { fill: { type: "image", src: "./background.jpg", fit: "fill" } },
    },
    {
      id: "poly",
      type: "polygram",
      parentId: null,
      layerOrder: 0,
      props: {
        stroke: { weight: 15, fill: "white", dash: 20 },
        cornerRadius: 20,
        sides: 5,
        width: 650,
        height: 650,
      },
    },
  ],
  commands: [
    {
      id: "slide",
      type: "to",
      targetId: "poly",
      at: 0,
      duration: 1.5,
      args: { x: 200, stroke: { dashOffset: 200 } },
    },
  ],
};

export default shapeScene;
