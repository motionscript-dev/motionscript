import type { CompositionDocument, ProjectDocument, Theme } from '@motionscript/sdk';

/**
 * The e2e visual-test project: the node types its scenes name, and the settings
 * every scene renders with — 960x540 (Quarter HD) at 30 fps, as TESTS.md
 * specifies. Each scene is rendered as a one-track project of its own; see
 * {@link projectOf}.
 */
export { NODES as nodes } from './nodes';

export const FPS = 30;
export const VIEWPORT = { width: 960, height: 540 };
export const THEME: Theme = {
    colors: {
        bg: '#0d0f15',
        card: '#161a21',
        primary: '#6990dd',
        accent: '#e8617c',
    },
};

/** A scene as the project the harness renders: one track, running the scene's own length. */
export function projectOf(id: string, clip: CompositionDocument): ProjectDocument {
    return {
        kind: 'project',
        name: id,
        fps: FPS,
        viewport: VIEWPORT,
        theme: THEME,
        tracks: [{ id, clip, duration: clip.duration ?? 0 }],
    };
}
