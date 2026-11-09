// TEMPORARY glass calibration harness — delete when done.
import fs from 'node:fs';
import path from 'node:path';
import { createServerEngine } from '@motionscript/headless';
import { Rect, Ellipse, Effects, Fills, type ProjectDocument } from '@motionscript/sdk';
import { el, scene } from '../src/doc';

interface ShapeSpec { x0: number; y0: number; x1: number; y1: number; radius?: number; ellipse?: boolean; glass: Record<string, unknown>; fill?: string; fillOpacity?: number }
interface Config { width: number; height: number; backdrop: string; shapes: ShapeSpec[]; scale?: number }

async function main() {
    const [configPath, outPath] = process.argv.slice(2);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;
    const assetsDir = path.dirname(path.resolve(path.dirname(configPath), config.backdrop));
    const { width: W, height: H } = config;
    const doc = scene((stage) => {
        stage.set({ fill: '#000000' });
        stage.add(
            el(Rect, { width: 'fill', height: 'fill', flow: 'freeform', align: { x: 0, y: 0 }, children: [
                el(Rect, { width: W, height: H, fill: Fills.image(path.basename(config.backdrop), { fit: 'fill' }) }),
                config.shapes.map((s) => {
                    const w = s.x1 - s.x0, h = s.y1 - s.y0;
                    const x = (s.x0 + s.x1) / 2 - W / 2;
                    const y = -((s.y0 + s.y1) / 2 - H / 2);
                    const fill = s.fill ? Fills.color(s.fill, { opacity: s.fillOpacity ?? 1 }) : undefined;
                    const effects = Effects.glass(s.glass as never);
                    return s.ellipse
                        ? el(Ellipse, { width: w, height: h, x, y, fill, effects })
                        : el(Rect, { width: w, height: h, x, y, cornerRadius: s.radius ?? 0, fill, effects });
                }),
            ] }),
        );
    }, [0.1]);
    const document: ProjectDocument = {
        kind: 'project', name: 'glass', fps: 30, viewport: { width: W, height: H },
        theme: { colors: {} }, tracks: [{ id: 'glass', clip: doc, duration: doc.duration ?? 0.1 }],
    };
    const key = path.basename(config.backdrop);
    const engine = createServerEngine({
        projectRoot: path.resolve(import.meta.dirname, '..'),
        assetsDir,
        onPageMessage({ type, text }) { if (type === 'error' || /warn/i.test(type)) console.log(`[page ${type}] ${text}`); },
        manifest: { image: { [key]: { src: `/${key}`, width: 0, height: 0, sizeBytes: fs.statSync(path.join(assetsDir, key)).size } }, video: {}, audio: {}, font: {} },
        softwareRender: process.env.MS_SOFTWARE_RENDER !== '0',
    });
    try {
        const shot = await engine.renderImage({ document, frame: 0, scale: config.scale ?? 1, format: 'png' });
        fs.writeFileSync(outPath, shot.bytes);
        console.log('wrote', outPath);
    } finally {
        await engine.close();
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
