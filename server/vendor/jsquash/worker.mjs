// Luồng riêng đổi ảnh JPEG XL → JPG (server/src/jxl.ts gọi). Chạy ngoài luồng chính để app vẫn trả lời nhân viên
// trong lúc đổi hàng loạt ảnh Zalo PC (mỗi ảnh tốn 0,5–3 giây CPU).
import fs from "node:fs";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

async function load(file, wasm) {
  const factory = (await import(pathToFileURL(path.join(dir, file)).href)).default;
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(dir, wasm)));
  return factory({
    noInitialRun: true,
    instantiateWasm: (imports, cb) => {
      const inst = new WebAssembly.Instance(mod, imports);
      cb(inst);
      return inst.exports;
    },
  });
}

const ready = Promise.all([load("jxl/jxl_dec.js", "jxl/jxl_dec.wasm"), load("jpeg/mozjpeg_enc.js", "jpeg/mozjpeg_enc.wasm")]);
ready.then(
  () => parentPort.postMessage({ type: "ready" }),
  (e) => parentPort.postMessage({ type: "ready", error: String(e?.message ?? e) }),
);

parentPort.on("message", async ({ id, input, opts }) => {
  try {
    const [dec, enc] = await ready;
    const img = dec.decode(new Uint8Array(input));
    if (!img || !img.width || !img.height) throw new Error("Không giải mã được ảnh JPEG XL");
    const out = enc.encode(img.data, img.width, img.height, opts);
    const copy = new Uint8Array(out); // bản sao riêng để chuyển về luồng chính
    parentPort.postMessage({ id, ok: true, out: copy }, [copy.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
});
