import type { JsonDocument, NoteChange } from "./migrate";

/**
 * Format 3 → 4: a `canvas3d`'s scene-wide child nodes become its own entries. Lights join its `lights` list (all of
 * them or none, since any light node replaced the whole default rig), a `fog3d` its `fog`, an `environment3d` its
 * `environment`, and a `camera3d` its camera fields, with that camera's `orbitTo` and `lookTo` commands moved onto
 * the canvas. A node is moved only when the canvas entry says exactly what it did: one with a span, an expression, a
 * command of another kind, children, a rotation or a field the canvas has no room for stays as it is, and still
 * works until the node types are removed.
 */

type Json = Record<string, unknown>;
type Vec = [number, number, number];

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const LIGHTS = new Set(["ambient-light3d", "hemisphere-light3d", "directional-light3d", "point-light3d", "spot-light3d", "area-light3d"]);
const OLD_RIG = ["ambientIntensity", "ambientColor", "keyIntensity", "keyColor"];
const ROTATION = ["rotation", "rotationX", "rotationY", "rotationZ", "quaternion", "scale", "scaleX", "scaleY", "scaleZ"];

function hasExpression(value: unknown): boolean {
    if (typeof value === "string") return value.startsWith("=");
    if (Array.isArray(value)) return value.some(hasExpression);
    if (isObject(value)) return Object.values(value).some(hasExpression);
    return false;
}

function vec(value: unknown): Vec | null {
    if (value === undefined) return [0, 0, 0];
    if (typeof value === "number") return [value, value, value];
    if (Array.isArray(value) && value.every((n) => typeof n === "number")) return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
    if (isObject(value) && [value.x, value.y, value.z].every((n) => n === undefined || typeof n === "number")) {
        return [(value.x as number) ?? 0, (value.y as number) ?? 0, (value.z as number) ?? 0];
    }
    return null;
}

/** A node's position, from `position` or `x`/`y`/`z`; `null` when it is not a plain point. */
function positionOf(props: Json): Vec | null {
    const base = vec(props.position);
    if (!base) return null;
    const axis = (key: string, i: number) => (props[key] === undefined ? base[i] : typeof props[key] === "number" ? props[key] as number : NaN);
    const out: Vec = [axis("x", 0), axis("y", 1), axis("z", 2)];
    return out.every(Number.isFinite) ? out : null;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const degrees = (rad: number) => round(rad * (180 / Math.PI));

/** A shadow as a stage light holds it: absent when the node cast none. */
function shadowOf(props: Json): Json {
    const shadow = props.shadow;
    if (shadow === undefined || shadow === false || shadow === "receive") return {};
    return { shadow: isObject(shadow) ? shadow : true };
}

/** The stage light a light node is, or `null` when one can't say exactly what it did. */
function lightOf(node: Json): Json | null {
    const props = (node.props ?? {}) as Json;
    if (ROTATION.some((key) => props[key] !== undefined && node.type !== "area-light3d")) return null;
    if (props.visible === false || props.decay !== undefined) return null;
    const color = props.color ?? "#ffffff";
    const intensity = props.intensity ?? 1;
    const at = positionOf(props);
    if (!at) return null;
    switch (node.type) {
        case "ambient-light3d":
            return { type: "ambient", color, intensity };
        case "hemisphere-light3d": {
            const sky = props.sky ?? "#ffffff";
            const ground = props.ground ?? "#ffffff";
            // A hemisphere at the origin has no up, so it lit as the two colours' mean: exact only when they agree.
            const up = at[0] === 0 && at[2] === 0 && at[1] > 0;
            if (!up && JSON.stringify(sky) !== JSON.stringify(ground)) return null;
            return { type: "sky", sky, ground, intensity };
        }
        case "directional-light3d": {
            const target = vec(props.target);
            if (!target) return null;
            const d = [at[0] - target[0], at[1] - target[1], at[2] - target[2]];
            if (d.every((n) => n === 0)) return null;
            const shadow = shadowOf(props);
            // A shadow is cast through its target, which a sun's is not.
            if (shadow.shadow && target.some((n) => n !== 0)) return null;
            return {
                type: "sun", color, intensity,
                orbit: degrees(Math.atan2(d[2], d[0])),
                elevation: degrees(Math.atan2(d[1], Math.hypot(d[0], d[2]))),
                ...shadow,
            };
        }
        case "point-light3d":
            return { type: "lamp", color, intensity, position: at, distance: props.distance ?? 0, ...shadowOf(props) };
        case "spot-light3d": {
            const target = vec(props.target);
            if (!target) return null;
            return {
                type: "spot", color, intensity, position: at, target,
                angle: props.angle ?? 60, penumbra: props.penumbra ?? 0, distance: props.distance ?? 0, ...shadowOf(props),
            };
        }
        case "area-light3d": {
            const target = props.lookAt === undefined ? null : vec(props.lookAt);
            if (!target || ROTATION.some((key) => props[key] !== undefined)) return null;
            return { type: "softBox", color, intensity, position: at, target, width: props.width ?? 10, height: props.height ?? 10 };
        }
    }
    return null;
}

function fogOf(node: Json, canvas: Json): Json | null {
    const props = (node.props ?? {}) as Json;
    if (props.density !== undefined) return null;
    const color = props.color ?? (typeof canvas.fill === "string" ? canvas.fill : undefined);
    if (color === undefined) return null;
    return { fog: color, fogNear: props.near ?? 1, fogFar: props.far ?? 1000 };
}

function environmentOf(node: Json): Json | null {
    const props = (node.props ?? {}) as Json;
    const extra = ["faces", "preset", "intensity", "background", "blur", "rotationX", "rotationY", "rotationZ"];
    if (typeof props.src !== "string" || extra.some((key) => props[key] !== undefined)) return null;
    return { environment: [{ type: "image", src: props.src }] };
}

const POLAR = ["orbit", "elevation", "distance"];

function cameraOf(node: Json): Json | null {
    const props = (node.props ?? {}) as Json;
    if (["near", "far", "lookAt", "position", "x", "y", "z", ...ROTATION].some((key) => props[key] !== undefined)) return null;
    if (props.zoom !== undefined && props.zoom !== 1) return null;
    if (!POLAR.some((key) => props[key] !== undefined)) return null;
    const out: Json = {
        orbit: round(90 - ((props.orbit as number) ?? 0)),
        elevation: props.elevation ?? 0,
        zoom: props.distance ?? 10,
        fov: props.fov ?? 50,
    };
    if (props.type === "orthographic") {
        out.projection = "orthographic";
        out.frustumHeight = props.frustumHeight ?? 10;
    }
    if (props.target !== undefined) out.target = props.target;
    return out;
}

/** A camera command as the canvas's, or `null` when the canvas has none like it. */
function cameraCommand(command: Json): Json | null {
    const args = (command.args ?? {}) as Json;
    if (hasExpression(args)) return null;
    if (command.type === "lookTo") return { ...command, args };
    if (command.type !== "orbitTo") return null;
    const out: Json = {};
    if (typeof args.orbit === "number") out.orbit = round(90 - args.orbit);
    if (args.elevation !== undefined) out.elevation = args.elevation;
    if (args.distance !== undefined) out.zoom = args.distance;
    return { ...command, args: out };
}

export function stageEntries(clip: JsonDocument, note: NoteChange): JsonDocument {
    if (!Array.isArray(clip.nodes)) return clip;
    let nodes = clip.nodes as Json[];
    let commands = Array.isArray(clip.commands) ? clip.commands as Json[] : undefined;
    const canvases = nodes.filter((n) => isObject(n) && n.type === "canvas3d");
    if (canvases.length === 0) return clip;

    const targeted = (id: unknown) => (commands ?? []).filter((c) => isObject(c) && c.targetId === id);
    const parents = new Set(nodes.map((n) => (isObject(n) ? n.parentId : undefined)));
    /** Neither a span nor a child nor an expression of its own. */
    const plain = (node: Json) => node.startAt === undefined && node.endAt === undefined && !parents.has(node.id) && !hasExpression(node.props);

    const drop = new Set<unknown>();
    const patch = new Map<unknown, Json>();
    const retarget = new Map<unknown, Json>();
    for (const canvas of canvases) {
        const kids = nodes.filter((n) => isObject(n) && n.parentId === canvas.id);
        const props: Json = { ...((canvas.props ?? {}) as Json) };
        let changed = false;

        const lightNodes = kids.filter((n) => LIGHTS.has(n.type as string)).sort((a, b) => (a.layerOrder as number) - (b.layerOrder as number));
        const lights = lightNodes.map((n) => (plain(n) && targeted(n.id).length === 0 ? lightOf(n) : null));
        if (lightNodes.length > 0) {
            if (lights.every((l) => l !== null)) {
                for (const key of OLD_RIG) delete props[key];
                props.lights = lights;
                lightNodes.forEach((n) => drop.add(n.id));
                changed = true;
                note(`nodes.${String(canvas.id)}`, `${lightNodes.length} light node(s) moved into the canvas's \`lights\`.`);
            } else {
                note(`nodes.${String(canvas.id)}`, "Light nodes kept: one of them does what the canvas's `lights` can't say.");
            }
        }

        const last = (type: string) => kids.filter((n) => n.type === type).at(-1);
        const only = (type: string) => kids.filter((n) => n.type === type).length === 1;
        const fog = last("fog3d");
        const fogEntries = fog && only("fog3d") && plain(fog) && targeted(fog.id).length === 0 ? fogOf(fog, props) : null;
        if (fog && fogEntries) {
            Object.assign(props, fogEntries);
            drop.add(fog.id);
            changed = true;
            note(`nodes.${String(fog.id)}`, "Fog moved into the canvas's `fog`.");
        }
        const env = last("environment3d");
        const envEntries = env && only("environment3d") && plain(env) && targeted(env.id).length === 0 ? environmentOf(env) : null;
        if (env && envEntries) {
            Object.assign(props, envEntries);
            drop.add(env.id);
            changed = true;
            note(`nodes.${String(env.id)}`, "Environment moved into the canvas's `environment`.");
        }
        const camera = last("camera3d");
        if (camera && only("camera3d") && plain(camera)) {
            const fields = cameraOf(camera);
            const moved = targeted(camera.id).map(cameraCommand);
            if (fields && moved.every((c) => c !== null)) {
                Object.assign(props, fields);
                drop.add(camera.id);
                for (const c of moved) retarget.set(c!.id, { ...c!, targetId: canvas.id });
                changed = true;
                note(`nodes.${String(camera.id)}`, "Camera moved into the canvas's camera fields.");
            }
        }
        if (changed) patch.set(canvas.id, props);
    }
    if (drop.size === 0 && patch.size === 0) return clip;
    nodes = nodes
        .filter((n) => !(isObject(n) && drop.has(n.id)))
        .map((n) => (isObject(n) && patch.has(n.id) ? { ...n, props: patch.get(n.id) } : n));
    if (commands && retarget.size > 0) commands = commands.map((c) => (isObject(c) && retarget.has(c.id) ? retarget.get(c.id)! : c));
    return { ...clip, nodes, ...(commands ? { commands } : {}) };
}
