// Ball detector worker for live cues (native-web/native.js, section 10). Runs the 3-frame ball model
// (tools/ball_detector, ball3f_v2.onnx, trained only on Ladi's own clips) off the main thread, so the pose model keeps
// its core. Input: 3 RGBA frames of 480x270, oldest first, about 33 ms apart. Output: the most likely ball spot
// (0-1 across and down the picture) and the model's confidence. Copied into www/ by tools/import_prototype.mjs.
import * as ort from "./ort/ort.wasm.min.mjs";
ort.env.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
ort.env.wasm.numThreads = 1; // more threads need cross-origin isolation, which would block the YouTube demo player
const W = 480, H = 270, HP = 272, N = HP * W, x = new Float32Array(9 * N);
let S = null;
onmessage = async e => {
  const m = e.data;
  if (m.init) {
    try { S = await ort.InferenceSession.create(m.model, { executionProviders: ["wasm"] }); postMessage({ ready: true }); }
    catch (err) { postMessage({ error: String(err) }); }
    return;
  }
  // BGR, scaled 0-1, channels (t-2, t-1, t), one row of edge padding top and bottom: 270 -> 272 (as in training)
  for (let k = 0; k < 3; k++) {
    const a = m.fr[k], B = (k * 3) * N, G = B + N, R = G + N;
    for (let yy = 0; yy < HP; yy++) {
      const sy = Math.min(H - 1, Math.max(0, yy - 1)) * W, o = yy * W;
      for (let xx = 0; xx < W; xx++) { const i = (sy + xx) * 4; x[B + o + xx] = a[i + 2] / 255; x[G + o + xx] = a[i + 1] / 255; x[R + o + xx] = a[i] / 255; }
    }
  }
  const t0 = performance.now();
  const h = (await S.run({ frames: new ort.Tensor("float32", x, [1, 9, HP, W]) })).heat.data; // 136x240 logits
  let bi = 0;
  for (let i = 1; i < h.length; i++) if (h[i] > h[bi]) bi = i;
  const yy = Math.floor(bi / 240), xx = bi % 240;
  postMessage({ t: m.t, x: (xx * 2 + .5) / W, y: (yy * 2 - .5) / H, s: 1 / (1 + Math.exp(-h[bi])), ms: performance.now() - t0 });
};
