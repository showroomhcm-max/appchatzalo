/**
 * Đổi ảnh JPEG XL (.jxl, định dạng Zalo PC lưu ảnh) sang JPG để trình duyệt nào cũng xem được.
 *
 * Bộ giải mã libjxl + bộ nén MozJPEG bản WebAssembly lấy từ @jsquash/jxl 1.3.0 và @jsquash/jpeg 1.6.0
 * (Apache-2.0, kèm giấy phép trong server/vendor/jsquash/). Để trong vendor/ thay vì npm vì chỉ cần 2 tệp
 * mã hóa / giải mã, không cần cả gói (bộ nén jxl đa luồng ~5 MB).
 *
 * Việc đổi chạy trong một luồng riêng (vendor/jsquash/worker.mjs), lần lượt từng ảnh: mỗi ảnh tốn 0,5–3 giây CPU,
 * chạy ở luồng chính sẽ làm app không trả lời nhân viên (lỗi 502) trong lúc máy đồng bộ gửi hàng loạt ảnh.
 */
import path from "node:path";
import { Worker } from "node:worker_threads";

const WORKER = path.resolve(process.cwd(), "vendor", "jsquash", "worker.mjs");
const TIMEOUT_MS = 60_000;

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

type Pending = { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function stop(reason: string) {
  const w = worker;
  worker = null;
  ready = null;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
  void w?.terminate().catch(() => {});
}

function start() {
  if (ready) return ready;
  const w = new Worker(WORKER);
  worker = w;
  w.unref();
  ready = new Promise<void>((resolve, reject) => {
    w.on("message", (m: any) => {
      if (m?.type === "ready") return m.error ? reject(new Error(m.error)) : resolve();
      const p = pending.get(m?.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(Buffer.from(m.out.buffer, m.out.byteOffset, m.out.byteLength));
      else p.reject(new Error(m.error));
    });
    w.on("error", (e: Error) => {
      reject(e);
      if (worker === w) stop(`Luồng đổi ảnh lỗi: ${e.message}`);
    });
    w.on("exit", (code) => {
      reject(new Error(`Luồng đổi ảnh dừng (${code})`));
      if (worker === w) stop(`Luồng đổi ảnh dừng (${code})`);
    });
  });
  ready.catch(() => {
    if (worker === w) stop("Không nạp được bộ đổi ảnh");
  });
  return ready;
}

export const isJxl = (b: Buffer) =>
  (b[0] === 0xff && b[1] === 0x0a) || b.subarray(0, 12).equals(Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]));

/** Nạp bộ đổi ảnh (lỗi = thiếu tệp vendor / WebAssembly): để nơi gọi phân biệt lỗi máy chủ với ảnh hỏng. */
export async function jxlReady() {
  await start();
}

/** Ảnh .jxl → JPG (chất lượng 82), chạy ở luồng riêng. Ảnh hỏng thì ném lỗi; quá 60 giây thì khởi động lại luồng. */
export async function jxlToJpeg(input: Buffer): Promise<Buffer> {
  await start();
  const w = worker!;
  const id = ++seq;
  const copy = new Uint8Array(input); // bản sao để chuyển hẳn sang luồng đổi ảnh
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Đổi ảnh quá 60 giây"));
      stop("Đổi ảnh quá lâu, khởi động lại luồng");
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, input: copy, opts: JPEG_OPTS }, [copy.buffer]);
  });
}
