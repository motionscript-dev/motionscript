import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // The tests typeset outside any scene, where nothing declares MathJax's loader: they load it up front, as a tool does.
        setupFiles: ['./src/tests/mathjax.setup.ts'],
    },
});
