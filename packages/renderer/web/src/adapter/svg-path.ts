// SVG path data (the strings ./geometry emits) into the doc's PathData. Arcs become cubics.

import { type PathData, PathBuilder } from "../doc";

/** Endpoint-parameterised arc → cubic segments (SVG implementation notes F.6). */
function arcTo(b: PathBuilder, x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number) {
    if (rx === 0 || ry === 0) {
        b.lineTo(x2, y2);
        return;
    }
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const c = Math.cos(phi), s = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const xp = c * dx + s * dy, yp = -s * dx + c * dy;
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lam > 1) {
        rx *= Math.sqrt(lam);
        ry *= Math.sqrt(lam);
    }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    let k = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) k = -k;
    const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
    const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
    const seg = dt / n;
    const alpha = (4 / 3) * Math.tan(seg / 4);
    const pt = (t: number) => [cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c];
    const dpt = (t: number) => [-rx * Math.sin(t) * c - ry * Math.cos(t) * s, -rx * Math.sin(t) * s + ry * Math.cos(t) * c];
    for (let i = 0; i < n; i++) {
        const ta = t1 + i * seg, tb = ta + seg;
        const [ax, ay] = pt(ta), [bx, by] = pt(tb), [dax, day] = dpt(ta), [dbx, dby] = dpt(tb);
        b.cubicTo(ax + alpha * dax, ay + alpha * day, bx - alpha * dbx, by - alpha * dby, i === n - 1 ? x2 : bx, i === n - 1 ? y2 : by);
    }
}

export function parseSvgPath(d: string): PathData {
    const b = new PathBuilder();
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    let i = 0;
    let cmd = "";
    let x = 0, y = 0, sx = 0, sy = 0;
    let lcx = 0, lcy = 0, lqx = 0, lqy = 0;
    let prev = "";
    const num = () => Number(tokens[i++]);
    const more = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
    while (i < tokens.length) {
        if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const ox = rel ? x : 0, oy = rel ? y : 0;
        switch (C) {
            case "M": {
                x = ox + num(); y = oy + num();
                b.moveTo(x, y);
                sx = x; sy = y;
                cmd = rel ? "l" : "L";
                break;
            }
            case "L": x = ox + num(); y = oy + num(); b.lineTo(x, y); break;
            case "H": x = (rel ? x : 0) + num(); b.lineTo(x, y); break;
            case "V": y = (rel ? y : 0) + num(); b.lineTo(x, y); break;
            case "C": {
                const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
                x = ox + num(); y = oy + num();
                b.cubicTo(x1, y1, x2, y2, x, y);
                lcx = x2; lcy = y2;
                break;
            }
            case "S": {
                const r = prev === "C" || prev === "S";
                const x1 = r ? 2 * x - lcx : x, y1 = r ? 2 * y - lcy : y;
                const x2 = ox + num(), y2 = oy + num();
                x = ox + num(); y = oy + num();
                b.cubicTo(x1, y1, x2, y2, x, y);
                lcx = x2; lcy = y2;
                break;
            }
            case "Q": {
                lqx = ox + num(); lqy = oy + num();
                x = ox + num(); y = oy + num();
                b.quadTo(lqx, lqy, x, y);
                break;
            }
            case "T": {
                const r = prev === "Q" || prev === "T";
                lqx = r ? 2 * x - lqx : x; lqy = r ? 2 * y - lqy : y;
                x = ox + num(); y = oy + num();
                b.quadTo(lqx, lqy, x, y);
                break;
            }
            case "A": {
                const rx = num(), ry = num(), phi = (num() * Math.PI) / 180, large = num() !== 0, sweep = num() !== 0;
                const nx = ox + num(), ny = oy + num();
                arcTo(b, x, y, rx, ry, phi, large, sweep, nx, ny);
                x = nx; y = ny;
                break;
            }
            case "Z": b.close(); x = sx; y = sy; break;
            default: i++;
        }
        prev = C;
        if (C === "Z" && more()) cmd = "L";
    }
    return b.build();
}
