import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174,
        fs: {
            // The workspace packages are symlinked from the repo root.
            allow: [path.resolve(__dirname, '..', '..')],
        },
    },
    build: { target: 'esnext' },
});
