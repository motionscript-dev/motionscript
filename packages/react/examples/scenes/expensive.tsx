import { Random, type CommandSpec, type CompositionDocument, type TimedNodeSpec } from "@motionscript/core";

/**
 * Two hundred rects, placed and animated — as a generated document.
 *
 * The point of the example: a document is *data*, so code writes it. What used
 * to be a loop inside a scene body is a loop that builds rows, and the result is
 * something a host can store, diff and evaluate out of order rather than a
 * function only the engine can run.
 *
 * It is also the case that used to justify `parallel`: two hundred tweens
 * running together. Here they simply share an `at` — running together is what
 * "the same start time" means, so there is no combinator to reach for.
 */
const COUNT = 200;
const VIEWPORT = { width: 1920, height: 1080 };

function build(): Pick<CompositionDocument, "nodes" | "commands"> {
    // Seeded, so the scene draws the same thing on every build — a document that
    // rendered differently each time would not be a document.
    const random = new Random("expensive");
    const w = VIEWPORT.width;
    const h = VIEWPORT.height;
    const nodes: TimedNodeSpec[] = [
        { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: { fill: "#e8c584" } },
    ];
    const commands: CommandSpec[] = [];

    for (let i = 0; i < COUNT; i++) {
        const id = `rect-${i}`;
        nodes.push({
            id,
            type: "rect",
            parentId: null,
            layerOrder: i,
            props: {
                width: 20,
                height: 20,
                fill: `hsl(${random.nextFloat(0, 360)}, 70%, 60%)`,
                x: random.nextFloat(-w / 2, w / 2),
                y: random.nextFloat(-h / 2, h / 2),
                rotation: random.nextFloat() * 360,
            },
        });
        commands.push({
            id: `move-${i}`,
            type: "to",
            targetId: id,
            // Every one starts at 0 and runs 8s, which is the whole of what
            // "in parallel" ever meant.
            at: 0,
            duration: 8,
            args: {
                x: random.nextFloat(-w / 2, w / 2),
                y: random.nextFloat(-h / 2, h / 2),
                rotation: random.nextFloat() * 360,
            },
        });
    }
    return { nodes, commands };
}

const expensiveScene: CompositionDocument = {
    kind: "composition",
    ...build(),
};

export default expensiveScene;
