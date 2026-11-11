import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';

import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import type { DynamicFileList } from '@mathjax/src/js/output/common/FontData.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js';

// `browserAdaptor()` reads `window` at construction, so it cannot run in Node; `liteAdaptor` is DOM-free.
// Elements are only touched through the adaptor's accessors, so their type is opaque.
export const adaptor: any = typeof window === 'undefined' && typeof document === 'undefined'
    ? liteAdaptor()
    : browserAdaptor();
RegisterHTMLHandler(adaptor);

const texJax = new TeX({
    packages: [
        'base', 'ams', 'boldsymbol', 'newcommand',
        'cancel', 'color', 'mhchem', 'physics',
        'bbox', 'mathtools',
    ],
});

// The font files behind the `mathcal`/`mathbb`/... alphabets. MathJax would fetch them asynchronously,
// which a synchronous typesetter cannot wait for, so they are bundled and set up before anything is typeset.
const BUNDLED_FONT_FILES = ['calligraphic', 'double-struck', 'fraktur', 'monospace', 'sans-serif', 'script'];

const svgJax = new SVG({ fontCache: 'local', fontData: MathJaxNewcmFont });
const fontFiles = (MathJaxNewcmFont as unknown as { dynamicFiles: DynamicFileList }).dynamicFiles;
for (const file of BUNDLED_FONT_FILES) fontFiles[file].setup(svgJax.font);

const mjDoc = mathjax.document('', { InputJax: texJax, OutputJax: svgJax });

/** Typeset `text` as display math and hand back MathJax's container, read through {@link adaptor}. */
export function convert(text: string): unknown {
    return mjDoc.convert(text, {
        display: true,
        em: 16,
        ex: 8,
        containerWidth: 80 * 16,
    });
}
