/**
 * Thông tin app nhà phát triển của từng nền tảng (Meta App, TikTok for Business App, TikTok Shop App).
 * Super Admin nhập ở Cài đặt › Tích hợp. Lưu trong bảng settings; khi trả về giao diện thì che bí mật.
 */
import crypto from "node:crypto";
import { getSetting, setSetting } from "../db.js";

export type MetaAppConfig = { appId: string; appSecret: string; verifyToken: string; graphVersion: string };
export type TikTokAppConfig = { appId: string; secret: string; authUrl: string; /** khóa bí mật gắn vào URL webhook */ webhookKey: string };
export type TikTokShopAppConfig = { appKey: string; appSecret: string; serviceId: string };
export type ZaloOaAppConfig = {
  appId: string;
  appSecret: string;
  /** "OA Secret Key" ở mục Webhook của app, dùng kiểm tra chữ ký */
  oaSecretKey: string;
  /** Mã xác thực tên miền của Zalo (tùy chọn) */
  verifyCode: string;
  /** khóa bí mật gắn vào URL webhook */
  webhookKey: string;
};

const KEYS = { meta: "app.meta", tiktok: "app.tiktok", tiktok_shop: "app.tiktok_shop", zalo_oa: "app.zalo_oa" } as const;
export type AppKind = keyof typeof KEYS;

export function metaConfig(): MetaAppConfig | null {
  const c = getSetting<MetaAppConfig>(KEYS.meta);
  return c?.appId && c.appSecret ? { ...c, graphVersion: c.graphVersion || "v23.0" } : null;
}
export function tiktokConfig(): TikTokAppConfig | null {
  const c = getSetting<TikTokAppConfig>(KEYS.tiktok);
  return c?.appId && c.secret ? c : null;
}
export function tiktokShopConfig(): TikTokShopAppConfig | null {
  const c = getSetting<TikTokShopAppConfig>(KEYS.tiktok_shop);
  return c?.appKey && c.appSecret ? c : null;
}

export function zaloOaConfig(): ZaloOaAppConfig | null {
  const c = getSetting<ZaloOaAppConfig>(KEYS.zalo_oa);
  return c?.appId && c.appSecret ? c : null;
}

const mask = (v?: string) => (v ? `•••${v.slice(-3)}` : "");

/** Cấu hình hiện tại (che bí mật) để hiển thị. */
export function publicConfigs() {
  const meta = getSetting<MetaAppConfig>(KEYS.meta);
  const tt = getSetting<TikTokAppConfig>(KEYS.tiktok);
  const tts = getSetting<TikTokShopAppConfig>(KEYS.tiktok_shop);
  const zoa = getSetting<ZaloOaAppConfig>(KEYS.zalo_oa);
  return {
    zalo_oa: zoa
      ? { appId: zoa.appId, appSecret: mask(zoa.appSecret), oaSecretKey: mask(zoa.oaSecretKey), verifyCode: zoa.verifyCode, configured: !!zaloOaConfig() }
      : { configured: false },
    meta: meta
      ? { appId: meta.appId, appSecret: mask(meta.appSecret), verifyToken: meta.verifyToken, graphVersion: meta.graphVersion ?? "v23.0", configured: !!metaConfig() }
      : { configured: false },
    tiktok: tt ? { appId: tt.appId, secret: mask(tt.secret), authUrl: tt.authUrl, configured: !!tiktokConfig() } : { configured: false },
    tiktok_shop: tts
      ? { appKey: tts.appKey, appSecret: mask(tts.appSecret), serviceId: tts.serviceId, configured: !!tiktokShopConfig() }
      : { configured: false },
  };
}

/** Lưu cấu hình; ô bí mật để trống = giữ giá trị cũ. */
export function saveConfig(kind: AppKind, input: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (kind === "meta") {
    const cur = getSetting<MetaAppConfig>(KEYS.meta);
    setSetting(KEYS.meta, {
      appId: str(input.appId) || cur?.appId || "",
      appSecret: str(input.appSecret) || cur?.appSecret || "",
      verifyToken: cur?.verifyToken || crypto.randomBytes(16).toString("hex"),
      graphVersion: str(input.graphVersion) || cur?.graphVersion || "v23.0",
    });
  } else if (kind === "tiktok") {
    const cur = getSetting<TikTokAppConfig>(KEYS.tiktok);
    setSetting(KEYS.tiktok, {
      appId: str(input.appId) || cur?.appId || "",
      secret: str(input.secret) || cur?.secret || "",
      authUrl: str(input.authUrl) || cur?.authUrl || "",
      webhookKey: cur?.webhookKey || crypto.randomBytes(16).toString("hex"),
    });
  } else if (kind === "zalo_oa") {
    const cur = getSetting<ZaloOaAppConfig>(KEYS.zalo_oa);
    setSetting(KEYS.zalo_oa, {
      appId: str(input.appId) || cur?.appId || "",
      appSecret: str(input.appSecret) || cur?.appSecret || "",
      oaSecretKey: str(input.oaSecretKey) || cur?.oaSecretKey || "",
      verifyCode: input.verifyCode !== undefined ? str(input.verifyCode).replace(/[^A-Za-z0-9_-]/g, "") : cur?.verifyCode || "",
      webhookKey: cur?.webhookKey || crypto.randomBytes(16).toString("hex"),
    });
  } else {
    const cur = getSetting<TikTokShopAppConfig>(KEYS.tiktok_shop);
    setSetting(KEYS.tiktok_shop, {
      appKey: str(input.appKey) || cur?.appKey || "",
      appSecret: str(input.appSecret) || cur?.appSecret || "",
      serviceId: str(input.serviceId) || cur?.serviceId || "",
    });
  }
  return publicConfigs();
}
