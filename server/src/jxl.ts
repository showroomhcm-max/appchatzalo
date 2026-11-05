/**
 * Đổi ảnh JPEG XL (.jxl, định dạng Zalo PC lưu ảnh) sang JPG để trình duyệt nào cũng xem được.
 *
 * Bộ giải mã libjxl + bộ nén MozJPEG bản WebAssembly lấy từ @jsquash/jxl 1.3.0 và @jsquash/jpeg 1.6.0
 * (Apache-2.0, kèm giấy phép trong server/vendor/jsquash/). Để trong vendor/ thay vì npm vì chỉ cần 2 tệp
 * mã hóa / giải mã, không cần cả gói (bộ nén jxl đa luồng ~5 MB).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VENDOR = path.resolve(process.cwd(), "vendor", "jsquash");

type Codec = { decode?: (b: ArrayBuffer | Uint8Array) => { data: Uint8ClampedArray; width: number; height: number } | null; encode?: Function };
let ready: Promise<{ dec: Codec; enc: Codec }> | null = null;

async function load(file: string, wasm: string): Promise<Codec> {
  const factory = (await import(pathToFileURL(path.join(VENDOR, file)).href)).default as (o: object) => Promise<Codec>;
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(VENDOR, wasm)));
  return factory({
    noInitialRun: true,
    instantiateWasm: (imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance) => void) => {
      const inst = new WebAssembly.Instance(mod, imports);
      cb(inst);
      return inst.exports;
    },
  });
}

function codecs() {
  ready ??= Promise.all([load("jxl/jxl_dec.js", "jxl/jxl_dec.wasm"), load("jpeg/mozjpeg_enc.js", "jpeg/mozjpeg_enc.wasm")]).then(([dec, enc]) => ({ dec, enc }));
  ready.catch(() => (ready = null));
  return ready;
}

export const isJxl = (b: Buffer) =>
  (b[0] === 0xff && b[1] === 0x0a) || b.subarray(0, 12).equals(Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]));

const JPEG_OPTS = {
  quality: 82,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3,
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 82,
};

/** Ảnh .jxl → JPG (chất lượng 82). Lỗi giải mã thì ném lỗi. */
export async function jxlToJpeg(input: Buffer): Promise<Buffer> {
  const { dec, enc } = await codecs();
  const img = dec.decode!(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  if (!img || !img.width || !img.height) throw new Error("Không giải mã được ảnh JPEG XL");
  const out = (enc.encode as Function)(img.data, img.width, img.height, JPEG_OPTS) as Uint8Array;
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/** Nạp bộ giải mã (lỗi = thiếu tệp vendor / WebAssembly): để nơi gọi phân biệt lỗi máy chủ với ảnh hỏng. */
export async function jxlReady() {
  await codecs();
}
