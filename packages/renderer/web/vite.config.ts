// The shader lab (shaders.html): ShaderPreview and validateShader on the page.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
    server: { port: 5190, strictPort: true },
    build: { target: "es2022", rolldownOptions: { input: { shaders: fileURLToPath(new URL("shaders.html", import.meta.url)) } } },
});
