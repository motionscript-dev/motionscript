/**
 * WGSL shader scenes beside the catalog: the shader scenes as the lane first
 * baselined them, kept so those baselines keep guarding the user-shader path.
 */
import type { CompositionDocument } from '@motionscript/core';

type Load = () => Promise<{ default: CompositionDocument }>;

export const wgpuScenes: Array<{ id: string; name: string; section: string; description: string; load: Load }> = [
    { id: 'wgsl-fill-custom', name: 'WgslFillCustom', section: 'WGSL', description: 'A WGSL shader fill with one tweened uniform', load: () => import('./scenes/wgsl-fill-custom.ts') },
    { id: 'wgsl-effect-custom', name: 'WgslEffectCustom', section: 'WGSL', description: 'A WGSL shader effect, screen-blended, with reach', load: () => import('./scenes/wgsl-effect-custom.ts') },
    { id: 'wgsl-effect-named', name: 'WgslEffectNamed', section: 'WGSL', description: 'A WGSL backdrop effect whose uniforms bind by name', load: () => import('./scenes/wgsl-effect-named.ts') },
    { id: 'wgsl-effect-backdrop', name: 'WgslEffectBackdrop', section: 'WGSL', description: 'A WGSL backdrop effect', load: () => import('./scenes/wgsl-effect-backdrop.ts') },
];
