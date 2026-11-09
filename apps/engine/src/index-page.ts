/**
 * A one-file page so the server is usable on its own — pick a scene, render it
 * in Node, watch the mp4 come back. Inlined rather than served from disk
 * because this app has no build step and nothing else to serve.
 */
/** A scene row plus whether this process can actually render it. */
export interface PageScene {
    id: string;
    name: string;
    description: string;
    available: boolean;
}

export function indexPage(scenes: PageScene[]): string {
    const options = scenes
        .map(s => {
            const unavailable = s.available ? '' : ' disabled';
            const note = s.available ? '' : ' (needs a font in assets/fonts/)';
            return `<option value="${s.id}"${unavailable}>${s.name} — ${s.description}${note}</option>`;
        })
        .join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motion Script — engine server</title>
<style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; background: #0b0d12; color: #e7ecf5; padding: 32px 24px; }
  main { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  h1 { font-size: 20px; margin: 0; }
  p { color: #8b93a4; font-size: 14px; margin: 0; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  select, button { background: #161a21; color: inherit; border: 1px solid #262c37; border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; }
  button { cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  img, video { width: 100%; border-radius: 10px; background: #000; border: 1px solid #262c37; }
  code { background: #161a21; padding: 1px 5px; border-radius: 5px; }
  .status { font-size: 12px; color: #8b93a4; }
</style>
</head>
<body>
<main>
  <h1>Motion Script — engine server</h1>
  <p>Scenes rendered from this Node process through the browser engine in headless Chromium (WebGPU).
     Video needs <code>ffmpeg</code> on <code>PATH</code>.</p>

  <div class="row">
    <select id="scene">${options}</select>
    <select id="scale">
      <option value="0.5">0.5×</option>
      <option value="1" selected>1×</option>
    </select>
    <select id="at">
      <option value="last" selected>last frame</option>
      <option value="first">first frame</option>
      <option value="1s">at 1s</option>
    </select>
    <button id="still">render still</button>
    <button id="video">render mp4</button>
    <span class="status" id="status"></span>
  </div>

  <img id="frame" alt="" hidden />
  <video id="player" controls loop hidden></video>
</main>
<script type="module">
  const $ = id => document.getElementById(id);
  const status = message => { $('status').textContent = message; };
  const params = () => new URLSearchParams({ scene: $('scene').value, scale: $('scale').value });

  $('still').addEventListener('click', () => {
    $('player').hidden = true;
    $('frame').hidden = false;
    $('frame').src = '/image?' + params() + '&at=' + $('at').value + '&t=' + Date.now();
    status('still rendered at ' + $('at').value);
  });

  $('video').addEventListener('click', async () => {
    const button = $('video');
    button.disabled = true;
    status('rendering — every frame is drawn on the CPU, so give it a moment…');
    const started = performance.now();
    try {
      const response = await fetch('/video?' + params());
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      $('frame').hidden = true;
      const player = $('player');
      if (player.src) URL.revokeObjectURL(player.src);
      player.src = URL.createObjectURL(blob);
      player.hidden = false;
      void player.play();
      status((blob.size / 1e6).toFixed(2) + ' MB in ' + ((performance.now() - started) / 1000).toFixed(1) + 's');
    } catch (error) {
      status('failed: ' + error.message);
    } finally {
      button.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
