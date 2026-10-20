import { Zalo, ThreadType, LoginQRCallbackEventType, GroupMessage, type API, type Credentials, type Message, type Reaction } from "zca-js";
import { all, get, logEvent, run } from "./db.js";
import { markReceipt } from "./store.js";
import { bus } from "./bus.js";
import {
  conversationKey,
  saveMessage,
  markUndone,
  updateConversationProfile,
  getConversation,
  findMessageByZaloId,
  setReaction,
  type MessageQuote,
  type Source,
} from "./store.js";

import {
  type Capabilities,
  type ChannelAdapter,
  type ChannelStatus,
  type OutgoingAttachment,
  type Platform,
  type SendOptions,
  type StoredMessage,
} from "./platforms/common.js";
import { MetaSession } from "./platforms/meta.js";
import { TikTokSession } from "./platforms/tiktok.js";
import { TikTokShopSession } from "./platforms/tiktok-shop.js";
import { ZaloOaSession } from "./platforms/zalo-oa.js";
export type { OutgoingAttachment, StoredMessage } from "./platforms/common.js";

export type StickerInfo = { id: number; cateId: number; type: number; url: string | null; text: string };



export type ZaloStatus = ChannelStatus;

/** Tiến độ đồng bộ tin cũ của một kênh Zalo. */
export type HistorySync = {
  state: "idle" | "running" | "done" | "error";
  step?: string;
  startedAt?: number;
  finishedAt?: number;
  fetched?: number;
  added?: number;
  conversations?: number;
  groups?: number;
  groupsFailed?: number;
  /** Giải thích kết quả cho người xem (vd. Zalo không trả tin cũ nào). */
  note?: string;
  error?: string;
};

export type ZaloGroup = { groupId: string; name: string; avatar: string; members: number };

export type ZaloPerson = {
  uid: string;
  name: string;
  zaloName: string;
  avatar: string;
  phone: string | null;
  isFriend: boolean;
};



type ChannelRow = { id: number; name: string; credentials: string | null; zalo_uid: string | null; active: number };

/** Một kênh = một tài khoản Zalo đang kết nối. */
/** Tóm tắt một lô tin cũ cho nhật ký: số tin, số hội thoại, khoảng thời gian. */
function describeBatch(msgs: Message[], type: ThreadType) {
  const kind = type === ThreadType.User ? "cá nhân" : "nhóm";
  if (!msgs.length) return `0 tin ${kind}`;
  const ts = msgs.map((m) => Number(m.data.ts)).filter(Boolean);
  const t = (v: number) => new Date(v + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
  const threads = new Set(msgs.map((m) => m.threadId)).size;
  return `${msgs.length} tin ${kind} / ${threads} hội thoại, từ ${t(Math.min(...ts))} đến ${t(Math.max(...ts))}`;
}

export class ChannelSession implements ChannelAdapter {
  readonly platform = "zalo" as const;
  readonly capabilities: Capabilities = {
    stickers: true,
    reactions: true,
    undo: true,
    forward: true,
    quote: true,
    files: true,
    contacts: true,
  };
  private api: API | null = null;
  private qrActions: { abort: () => unknown } | null = null;
  private qrCancelled = false;
  private status: ZaloStatus;
  private profileFetchQueue = new Set<string>();
  private friendsCache: { at: number; list: ZaloPerson[] } | null = null;
  private groupsCache: { at: number; list: ZaloGroup[] } | null = null;
  private lookupTimes: number[] = [];
  /** Đang đồng bộ tin cũ: lô "old_messages" chuyển cho syncHistory thay vì lưu thẳng. */
  private oldMsgWaiter: ((msgs: Message[], type: ThreadType) => void) | null = null;
  private profileChain: Promise<void> = Promise.resolve();
  private pendingAutoSync = false;
  history: HistorySync = { state: "idle" };

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: this.channelName(), platform: "zalo", state: "disconnected", updatedAt: Date.now() };
  }

  private row() {
    return get<ChannelRow>("SELECT id, name, credentials, zalo_uid, active FROM channels WHERE id = ?", this.channelId);
  }

  private channelName() {
    return this.row()?.name ?? `Kênh ${this.channelId}`;
  }

  getStatus(): ZaloStatus {
    return this.status;
  }

  get ownId() {
    return this.status.account?.id;
  }

  get connected() {
    return !!this.api && this.status.state === "connected";
  }

  private setStatus(patch: Partial<ZaloStatus>, replace = false) {
    const base = { channelId: this.channelId, channelName: this.channelName(), platform: "zalo" as const };
    this.status = replace
      ? ({ ...base, ...patch, updatedAt: Date.now() } as ZaloStatus)
      : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }

  /** Tên kênh đổi trong cài đặt → cập nhật trạng thái đang hiển thị. */
  refreshName() {
    this.setStatus({});
  }

  /** Nhật ký hoạt động của kênh (ghi vào data/logs, xem ở Cài đặt › Nhật ký hoặc GET /api/logs?q=zalo%23<id>). */
  private log(msg: string, ...rest: unknown[]) {
    console.info(`[zalo#${this.channelId}] ${msg}`, ...rest);
  }

  private newClient() {
    return new Zalo({ selfListen: true, checkUpdate: false, logging: false });
  }

  private saveCredentials(creds: Credentials) {
    run("UPDATE channels SET credentials = ? WHERE id = ?", JSON.stringify({ ...creds, savedAt: Date.now() }), this.channelId);
  }

  private initializing = false;

  /** Khởi động: đăng nhập lại bằng cookie đã lưu (nếu có). Đang kết nối thì bỏ qua. */
  async init() {
    const row = this.row();
    if (!row?.credentials || !row.active) return;
    if (this.initializing || this.connected || this.status.state === "qr" || this.status.state === "scanned") return;
    this.initializing = true;
    try {
      await this.initInner(row.credentials);
    } finally {
      this.initializing = false;
    }
  }

  private async initInner(credentials: string) {
    this.setStatus({ state: "connecting" }, true);
    this.log("Đăng nhập lại bằng phiên đã lưu…");
    try {
      const api = await this.newClient().login(JSON.parse(credentials));
      await this.attach(api);
    } catch (e) {
      console.error(`[zalo#${this.channelId}] Đăng nhập lại bằng cookie thất bại:`, e);
      this.setStatus({ state: "error", error: "Phiên Zalo đã hết hạn, vui lòng quét lại mã QR." }, true);
    }
  }

  /** Bắt đầu đăng nhập bằng QR. Ảnh QR được đẩy lên giao diện qua sự kiện zalo.status. */
  async startQRLogin() {
    if (this.status.state === "qr" || this.status.state === "scanned") return;
    await this.logout(false);
    this.qrCancelled = false;
    this.setStatus({ state: "connecting" }, true);
    let creds: Credentials | null = null;
    try {
      const api = await this.newClient().loginQR({}, (event) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            this.log("Tạo mã QR đăng nhập");
            this.qrActions = event.actions;
            this.setStatus({ state: "qr", qrImage: `data:image/png;base64,${event.data.image}` }, true);
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            this.log("Mã QR hết hạn");
            this.qrActions = event.actions;
            this.setStatus({ state: "error", error: "Mã QR đã hết hạn. Bấm tạo mã mới." }, true);
            event.actions.abort();
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            this.log(`Đã quét QR: ${event.data.display_name}`);
            this.setStatus({
              state: "scanned",
              scannedBy: { name: event.data.display_name, avatar: event.data.avatar },
            });
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            this.log("Đăng nhập QR bị từ chối trên điện thoại");
            this.setStatus({ state: "error", error: "Đăng nhập bị từ chối trên điện thoại." }, true);
            event.actions.abort();
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            creds = { cookie: event.data.cookie, imei: event.data.imei, userAgent: event.data.userAgent };
            this.setStatus({ state: "connecting" });
            break;
        }
      });
      this.qrActions = null;

      // Một tài khoản Zalo chỉ gắn vào một kênh, tránh 2 kênh tranh nhau một phiên.
      const ownId = api.getOwnId();
      const dup = get<{ name: string }>("SELECT name FROM channels WHERE zalo_uid = ? AND id != ? AND deleted_at IS NULL", ownId, this.channelId);
      if (dup) {
        try {
          api.listener.stop();
        } catch {
          /* ignore */
        }
        this.setStatus({ state: "error", error: `Tài khoản Zalo này đã kết nối ở kênh "${dup.name}".` }, true);
        return;
      }
      if (creds) this.saveCredentials(creds);
      // Tài khoản vừa gắn: kéo luôn tin cũ Zalo còn giữ để nhân viên biết mà chat tiếp.
      this.pendingAutoSync = true;
      await this.attach(api);
      logEvent(null, null, "zalo.login", { method: "qr", channel: this.channelId });
    } catch (e: any) {
      this.qrActions = null;
      if (!this.qrCancelled && this.status.state !== "error") {
        this.setStatus({ state: "error", error: e?.message ?? "Đăng nhập QR thất bại" }, true);
      }
    }
  }

  cancelQR() {
    this.qrCancelled = true;
    this.qrActions?.abort();
    this.qrActions = null;
    this.setStatus({ state: "disconnected" }, true);
  }

  async logout(clearCredentials = true) {
    try {
      this.api?.listener.stop();
    } catch {
      /* ignore */
    }
    if (this.api) this.log(clearCredentials ? "Đăng xuất, xóa phiên đã lưu" : "Ngắt phiên hiện tại");
    this.api = null;
    this.friendsCache = null;
    if (clearCredentials) {
      run("UPDATE channels SET credentials = NULL WHERE id = ?", this.channelId);
      this.setStatus({ state: "disconnected" }, true);
      logEvent(null, null, "zalo.logout", { channel: this.channelId });
    }
  }

  private async attach(api: API) {
    // Phiên cũ (nếu còn) phải dừng hẳn trước khi gắn phiên mới, tránh 2 phiên cùng tài khoản đá nhau.
    if (this.api && this.api !== api) {
      try {
        this.api.listener.stop();
      } catch {
        /* ignore */
      }
    }
    this.api = api;
    const ownId = api.getOwnId();
    let name = ownId;
    this.log(`Đăng nhập thành công, tài khoản ${ownId}`);
    let avatar = "";
    try {
      const info = await api.fetchAccountInfo();
      name = info.profile.displayName || info.profile.zaloName || ownId;
      avatar = info.profile.avatar;
    } catch {
      /* không bắt buộc */
    }
    run("UPDATE channels SET zalo_uid = ?, zalo_name = ?, avatar = ? WHERE id = ?", ownId, name, avatar, this.channelId);

    // Lưu lại cookie mới nhất để lần khởi động sau không phải quét QR.
    try {
      const ctx = api.getContext();
      this.saveCredentials({
        imei: ctx.imei,
        userAgent: ctx.userAgent,
        cookie: api.getCookie().toJSON()?.cookies ?? [],
      } as Credentials);
    } catch (e) {
      console.warn(`[zalo#${this.channelId}] Không lưu được cookie:`, e);
    }

    const { listener } = api;
    listener.on("connected", () => {
      this.log(`Đã kết nối nhận tin (${name})`);
      this.setStatus({ state: "connected", account: { id: ownId, name, avatar }, error: undefined, qrImage: undefined });
      if (this.pendingAutoSync) {
        this.pendingAutoSync = false;
        void this.syncHistory(90, "tự động sau khi quét QR").catch((e) => console.warn(`[zalo#${this.channelId}] Đồng bộ tin cũ lỗi:`, e?.message ?? e));
      } else if (this.history.state !== "running") {
        // Đồng bộ các tin gần đây mà Zalo còn giữ (bù tin lúc mất kết nối).
        listener.requestOldMessages(ThreadType.User);
        listener.requestOldMessages(ThreadType.Group);
      }
    });
    listener.on("message", (m) => this.handleMessage(m, false));
    listener.on("old_messages", (msgs, type) => {
      if (this.oldMsgWaiter) return this.oldMsgWaiter(msgs, type);
      this.log(`Zalo gửi bù ${describeBatch(msgs, type)}`);
      msgs.forEach((m) => this.handleMessage(m, true));
    });
    listener.on("reaction", (r) => this.handleReaction(r));
    // Khách đang soạn tin (Zalo báo khoảng vài giây một lần khi khách gõ)
    listener.on("typing", (t: any) => {
      if (t?.isSelf) return;
      bus.emit("zalo.typing", { channelId: this.channelId, threadId: String(t.threadId), uid: String(t.data?.uid ?? "") });
    });
    listener.on("delivered_messages", (list: any[]) => {
      for (const d of list ?? []) {
        if (d?.isSelf) continue;
        markReceipt(this.channelId, String(d.threadId), [String(d.data?.msgId ?? ""), String(d.data?.realMsgId ?? "")], "delivered");
      }
    });
    listener.on("seen_messages", (list: any[]) => {
      for (const s of list ?? []) {
        if (s?.isSelf) continue;
        const isGroup = s.type === ThreadType.Group;
        markReceipt(
          this.channelId,
          String(s.threadId),
          [String(s.data?.msgId ?? ""), String(s.data?.realMsgId ?? "")],
          "seen",
          isGroup ? (s.data?.seenUids ?? []).length : undefined,
        );
      }
    });
    // Lời mời kết bạn mới / được chấp nhận → báo giao diện
    listener.on("friend_event", (ev: any) => {
      try {
        if (ev?.isSelf) return;
        if (ev.type === 2) bus.emit("zalo.friend", { channelId: this.channelId, type: "request", uid: String(ev.data?.fromUid ?? ev.threadId ?? "") });
        else if (ev.type === 0) {
          this.friendsCache = null;
          bus.emit("zalo.friend", { channelId: this.channelId, type: "added", uid: String(ev.threadId ?? "") });
        }
      } catch (e) {
        console.warn(`[zalo#${this.channelId}] friend_event lỗi:`, e);
      }
    });
    listener.on("old_reactions", (list) => list.forEach((r) => this.handleReaction(r)));
    listener.on("undo", (u) => {
      const id = String(u.data.content?.globalMsgId ?? "");
      if (id) markUndone(this.channelId, u.threadId, id);
    });
    listener.on("error", (e) => console.error(`[zalo#${this.channelId}] listener error:`, e));
    listener.on("closed", (code, reason) => {
      console.warn(`[zalo#${this.channelId}] listener closed:`, code, reason);
      const msg =
        code === 3000
          ? "Tài khoản đang mở Zalo Web/PC ở nơi khác nên bị ngắt. Đóng phiên đó rồi bấm Kết nối lại."
          : `Mất kết nối Zalo (${code}). Bấm Kết nối lại.`;
      this.setStatus({ state: "error", error: msg });
    });
    listener.start({ retryOnClose: true });
    this.setStatus({ state: "connecting", account: { id: ownId, name, avatar } });
  }

  private handleMessage(m: Message, isHistory: boolean, quiet = false) {
    try {
      const d = m.data;
      const isGroup = m.type === ThreadType.Group;
      const source: Source = m.isSelf ? (isHistory ? "history" : "phone") : "customer";
      const saved = saveMessage({
        quiet,
        channelId: this.channelId,
        threadId: m.threadId,
        conversationType: isGroup ? 1 : 0,
        zaloMsgId: String(d.msgId),
        cliMsgId: d.cliMsgId ? String(d.cliMsgId) : null,
        direction: m.isSelf ? "out" : "in",
        senderUid: d.uidFrom === "0" ? this.ownId ?? d.uidFrom : d.uidFrom,
        senderName: d.dName,
        source,
        msgType: d.msgType,
        content: d.content,
        ts: Number(d.ts) || Date.now(),
        isHistory,
        quote: d.quote
          ? {
              msg: d.quote.msg ?? "",
              fromD: d.quote.fromD ?? "",
              globalMsgId: String(d.quote.globalMsgId ?? ""),
              ownerId: String(d.quote.ownerId ?? ""),
            }
          : null,
      });
      this.ensureProfile(m.threadId, isGroup);
      return saved;
    } catch (e) {
      console.error(`[zalo#${this.channelId}] Lỗi lưu tin nhắn:`, e);
      return null;
    }
  }

  // ───────────── Đồng bộ tin cũ ─────────────

  /**
   * Gọi API lịch sử nhóm trên đám mây của Zalo (group_cloud_message › /api/cm/getrecentv2 | getoldv2),
   * đúng như chat.zalo.me. zca-js chưa có sẵn nên gắn thêm bằng api.custom.
   */
  private groupCloud(api: API, groupId: string, globalMsgId: string, old: boolean, count = 50): Promise<any> {
    const a = api as any;
    if (typeof a.__groupCloud !== "function") {
      a.custom("__groupCloud", async ({ ctx, utils, props }: any) => {
        const base = a.zpwServiceMap?.group_cloud_message?.[0];
        if (!base) throw new Error("Zalo không cấp địa chỉ lịch sử nhóm (group_cloud_message)");
        const params = utils.encodeAES(
          JSON.stringify({ groupId: props.groupId, globalMsgId: props.globalMsgId, count: props.count, msgIds: [], imei: ctx.imei, src: -1 }),
        );
        if (!params) throw new Error("Không mã hóa được tham số");
        const url = utils.makeURL(utils.makeURL(`${base}/api/cm/${props.old ? "getoldv2" : "getrecentv2"}`), { params });
        const res = await utils.request(url, { method: "GET" });
        return utils.resolve(res, (result: any) => {
          let d = result.data;
          // Mã người dùng là số lớn: đổi sang chuỗi trước khi đọc JSON để không mất chữ số
          if (typeof d === "string") d = JSON.parse(d.replace(/"(uidFrom|uidTo|uid|ownerId)":(-?\d+)/g, '"$1":"$2"'));
          return d;
        });
      });
    }
    return a.__groupCloud({ groupId, globalMsgId, old, count });
  }

  /** Xin một lô tin cũ (cá nhân hoặc nhóm) qua kết nối Zalo; hết 20 giây không có trả lời thì null. */
  private requestOld(api: API, type: ThreadType, lastId: string | null) {
    return new Promise<Message[] | null>((resolve) => {
      const timer = setTimeout(() => {
        this.oldMsgWaiter = null;
        resolve(null);
      }, 20_000);
      this.oldMsgWaiter = (msgs, t) => {
        if (t !== type) return msgs.forEach((m) => this.handleMessage(m, true));
        clearTimeout(timer);
        this.oldMsgWaiter = null;
        resolve(msgs);
      };
      api.listener.requestOldMessages(type, lastId);
    });
  }

  /**
   * Kéo tin cũ Zalo còn giữ trên máy chủ (Zalo không cho lấy toàn bộ lịch sử trên điện thoại):
   * lật dần từng lô tin cá nhân + nhóm, rồi thử lấy thêm lịch sử từng nhóm. Tin đã có thì bỏ qua;
   * không bắn webhook / cảnh báo cho tin cũ. Mọi bước ghi vào nhật ký để kiểm tra khi có sự cố.
   */
  async syncHistory(days = 90, trigger = "bấm tay") {
    if (this.history.state === "running") throw new Error("Kênh đang đồng bộ tin cũ, đợi xong lượt này.");
    const api = this.requireApi();
    const cutoff = Date.now() - days * 86_400_000;
    const st: HistorySync = { state: "running", startedAt: Date.now(), step: "Tin nhắn cá nhân", fetched: 0, added: 0, conversations: 0, groups: 0, groupsFailed: 0 };
    this.history = st;
    this.log(`Đồng bộ tin cũ: bắt đầu (${trigger}, tối đa ${days} ngày)`);
    const touched = new Set<string>();
    const save = (m: Message) => {
      st.fetched!++;
      const r = this.handleMessage(m, true, true);
      if (r?.isNew) {
        st.added!++;
        touched.add(r.conversation.id);
        st.conversations = touched.size;
      }
      return !!r?.isNew;
    };
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      for (const type of [ThreadType.User, ThreadType.Group]) {
        const label = type === ThreadType.User ? "Tin cá nhân" : "Tin nhóm";
        st.step = type === ThreadType.User ? "Tin nhắn cá nhân" : "Tin nhắn nhóm";
        // Giống Zalo Web lúc mới đăng nhập: xin lô mới nhất, rồi lùi dần bằng mã tin cũ nhất của lô trước.
        const seen = new Set<string>();
        const asked = new Set<string>();
        let lastId: string | null = null;
        for (let page = 1; page <= 80 && this.api === api; page++) {
          let batch = await this.requestOld(api, type, lastId);
          if (page === 1 && !batch?.length) {
            // Vừa kết nối, Zalo có khi chưa sẵn sàng: đợi chút rồi xin lại một lần
            this.log(`${label} lô 1: ${batch ? "trống" : "không có trả lời sau 20 giây"}, thử lại sau 5 giây`);
            await pause(5000);
            batch = await this.requestOld(api, type, lastId);
          }
          if (!batch) {
            this.log(`${label} lô ${page}: không có trả lời sau 20 giây, dừng`);
            break;
          }
          if (!batch.length) {
            this.log(`${label} lô ${page}: Zalo trả 0 tin, hết tin cũ`);
            break;
          }
          let oldest: Message | null = null;
          let added = 0;
          for (const m of batch) {
            if (!oldest || Number(m.data.ts) < Number(oldest.data.ts)) oldest = m;
            const id = String(m.data.msgId);
            if (seen.has(id)) continue;
            seen.add(id);
            if (save(m)) added++;
          }
          this.log(`${label} lô ${page}: ${describeBatch(batch, type)}, thêm mới ${added}`);
          // Zalo trả tin theo chiều xuôi (từ lúc thiết bị được gắn → mới nhất): xin tiếp từ tin mới nhất của lô
          const newest = batch.reduce((a, m) => (Number(m.data.ts) > Number(a.data.ts) ? m : a), batch[0]);
          const next = [newest, batch[batch.length - 1], batch[0]]
            .map((m) => String(m?.data.msgId ?? m?.data.cliMsgId ?? ""))
            .find((id) => id && !asked.has(id));
          if (!next) {
            this.log(`${label}: Zalo trả lại đúng các lô đã có, dừng`);
            break;
          }
          asked.add(next);
          lastId = next;
          await pause(700);
        }
      }

      st.step = "Lịch sử từng nhóm";
      const groups = Object.keys((await api.getAllGroups()).gridVerMap ?? {}).slice(0, 300);
      this.log(`Lịch sử từng nhóm: ${groups.length} nhóm`);
      let ok = 0;
      let firstError = "";
      let groupAdded = 0;
      for (const gid of groups) {
        if (this.api !== api) break;
        try {
          // Lịch sử nhóm trên đám mây của Zalo (chat.zalo.me cũng tải từ đây, không cần điện thoại):
          // lô mới nhất trước, rồi lùi dần bằng mã tin cũ nhất, tối đa 20 lô × 50 tin mỗi nhóm.
          let cursor = "0";
          let old = false;
          const asked = new Set<string>();
          let got = 0;
          let firstKeys = "";
          for (let page = 1; page <= 20 && this.api === api; page++) {
            const r = await this.groupCloud(api, gid, cursor, old);
            if (page === 1) firstKeys = Object.keys(r ?? {}).join(",");
            const msgs = (r?.groupMsgs ?? []).map((raw: any) => new GroupMessage(api.getOwnId(), raw) as Message);
            let oldest: Message | null = null;
            for (const m of msgs) {
              if (!oldest || Number(m.data.ts) < Number(oldest.data.ts)) oldest = m;
              if (Number(m.data.ts) >= cutoff && save(m)) groupAdded++;
            }
            got += msgs.length;
            if (!msgs.length || !oldest || Number(oldest.data.ts) < cutoff || r?.hasMore === 0 || r?.hasMore === false) break;
            const next = String(r?.lastMsgId || oldest.data.msgId);
            if (!next || asked.has(next)) break;
            asked.add(next);
            cursor = next;
            old = true;
            await pause(400);
          }
          if (ok < 3) this.log(`Lịch sử nhóm ${gid}: Zalo trả ${got} tin (dữ liệu: ${firstKeys})`);
          ok++;
          st.groups = ok;
        } catch (e: any) {
          st.groupsFailed!++;
          firstError ||= `${e?.message ?? String(e)}${e?.code != null ? ` [mã ${e.code}]` : ""}`;
          // Zalo đổi / khóa API này thì nhóm nào cũng lỗi: dừng sớm, khỏi gọi dồn dập
          if (!ok && st.groupsFailed! >= 3) {
            this.log(`Lịch sử từng nhóm: Zalo không cho dùng (${firstError}), bỏ qua bước này`);
            break;
          }
        }
        await pause(500);
      }
      this.log(`Lịch sử từng nhóm: ${ok} nhóm lấy được, thêm mới ${groupAdded} tin; ${st.groupsFailed} nhóm lỗi${firstError ? ` (lỗi đầu: ${firstError})` : ""}`);
      if (!st.fetched)
        st.note = "Zalo không trả tin cũ nào. Zalo chỉ giữ tin trên máy chủ kể từ lúc tài khoản được gắn vào app; tin trước đó chỉ còn trên điện thoại.";
      Object.assign(st, { state: "done", step: undefined, finishedAt: Date.now() });
    } catch (e: any) {
      Object.assign(st, { state: "error", error: e?.message ?? String(e), finishedAt: Date.now() });
      console.warn(`[zalo#${this.channelId}] Đồng bộ tin cũ lỗi:`, e);
    } finally {
      this.oldMsgWaiter = null;
      for (const id of touched) {
        const conv = getConversation(id);
        if (conv) bus.emit("conversation.updated", conv);
      }
      this.log(
        `Đồng bộ tin cũ: ${st.state === "done" ? "xong" : "dừng do lỗi"} sau ${Math.round(((st.finishedAt ?? Date.now()) - st.startedAt!) / 1000)} giây — đọc ${st.fetched} tin, thêm mới ${st.added} tin vào ${st.conversations} hội thoại, nhóm ${st.groups} (lỗi ${st.groupsFailed})`,
      );
      logEvent(null, null, "zalo.history_synced", {
        channel: this.channelId,
        trigger,
        fetched: st.fetched,
        added: st.added,
        conversations: st.conversations,
        groups: st.groups,
        groupsFailed: st.groupsFailed,
        state: st.state,
      });
    }
    return st;
  }

  /** Khách (hoặc shop trên điện thoại) thả cảm xúc vào tin nhắn. */
  private handleReaction(r: Reaction) {
    try {
      const convId = conversationKey(this.channelId, r.threadId);
      const reactor = r.isSelf
        ? { uid: `shop:${this.channelId}`, name: this.status.account?.name ?? "Shop" }
        : { uid: r.data.uidFrom, name: r.data.dName ?? null };
      for (const target of r.data.content?.rMsg ?? []) {
        const msg = findMessageByZaloId(convId, String(target.gMsgID));
        if (msg) setReaction(msg.id, reactor, String(r.data.content.rIcon ?? ""));
      }
    } catch (e) {
      console.warn(`[zalo#${this.channelId}] Lỗi lưu cảm xúc:`, e);
    }
  }

  /** Lấy tên + ảnh đại diện khách/nhóm một lần cho hội thoại mới. */
  private ensureProfile(threadId: string, isGroup: boolean) {
    const id = conversationKey(this.channelId, threadId);
    const conv = getConversation(id);
    if (!this.api || !conv || (conv.avatar && conv.name) || this.profileFetchQueue.has(threadId)) return;
    this.profileFetchQueue.add(threadId);
    const api = this.api;
    // Lần lượt từng người, cách nhau một chút: đồng bộ tin cũ có thể gặp hàng trăm khách mới cùng lúc.
    this.profileChain = this.profileChain.then(async () => {
      try {
        if (isGroup) {
          const r = await api.getGroupInfo(threadId);
          const g = r.gridInfoMap?.[threadId];
          if (g) updateConversationProfile(id, { name: g.name, avatar: g.fullAvt || g.avt });
        } else {
          const r = await api.getUserInfo(threadId);
          const u = r.changed_profiles?.[threadId] ?? (r.changed_profiles?.[`${threadId}_0`] as any);
          if (u) updateConversationProfile(id, { name: u.displayName || u.zaloName, avatar: u.avatar });
        }
      } catch (e) {
        console.warn(`[zalo#${this.channelId}] Không lấy được thông tin`, threadId, e);
      }
      await new Promise((r) => setTimeout(r, 250));
    });
  }

  // ───────────── Tìm người dùng Zalo ─────────────

  private requireApi() {
    if (!this.api || this.status.state !== "connected") throw new Error(`Kênh "${this.channelName()}" chưa kết nối Zalo`);
    return this.api;
  }

  /**
   * Zalo giới hạn số lần tra số điện thoại; tra quá nhiều có thể bị khóa tính năng hoặc khóa tài khoản.
   * Giới hạn mềm 60 lần/giờ cho mỗi tài khoản.
   */
  private checkLookupQuota() {
    const hourAgo = Date.now() - 3600_000;
    this.lookupTimes = this.lookupTimes.filter((t) => t > hourAgo);
    if (this.lookupTimes.length >= 60) {
      throw new Error("Đã tra số điện thoại quá 60 lần trong 1 giờ. Đợi một lúc để tránh Zalo khóa tài khoản.");
    }
    this.lookupTimes.push(Date.now());
  }

  /** Danh sách bạn bè của tài khoản Zalo (lưu tạm 10 phút). */
  async friends(refresh = false): Promise<ZaloPerson[]> {
    const api = this.requireApi();
    if (!refresh && this.friendsCache && Date.now() - this.friendsCache.at < 10 * 60_000) return this.friendsCache.list;
    const list = (await api.getAllFriends()).map((u) => ({
      uid: u.userId,
      name: u.displayName || u.zaloName,
      zaloName: u.zaloName,
      avatar: u.avatar,
      phone: u.phoneNumber || null,
      isFriend: true,
    }));
    this.friendsCache = { at: Date.now(), list };
    return list;
  }

  /** Tất cả nhóm Zalo tài khoản đang tham gia (lưu tạm 10 phút). */
  async groups(refresh = false): Promise<ZaloGroup[]> {
    const api = this.requireApi();
    if (!refresh && this.groupsCache && Date.now() - this.groupsCache.at < 10 * 60_000) return this.groupsCache.list;
    const ids = Object.keys((await api.getAllGroups()).gridVerMap ?? {});
    const list: ZaloGroup[] = [];
    // Lấy thông tin theo từng đợt để không gọi quá dài
    for (let i = 0; i < ids.length; i += 50) {
      const r = await api.getGroupInfo(ids.slice(i, i + 50));
      for (const [id, g] of Object.entries(r.gridInfoMap ?? {})) {
        list.push({ groupId: id, name: g.name || `Nhóm ${id}`, avatar: g.avt || g.fullAvt || "", members: g.totalMember ?? 0 });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    this.groupsCache = { at: Date.now(), list };
    return list;
  }

  /** Thành viên một nhóm Zalo (tên, ảnh, trưởng / phó nhóm). */
  async groupMembers(groupId: string) {
    const api = this.requireApi();
    const info = (await api.getGroupInfo(groupId)).gridInfoMap?.[groupId] as any;
    if (!info) throw new Error("Không đọc được thông tin nhóm");
    const ids: string[] = (info.memVerList ?? []).map((v: string) => String(v).split("_")[0]).filter(Boolean);
    const admins = new Set<string>([String(info.creatorId ?? ""), ...((info.adminIds ?? []) as string[]).map(String)]);
    const members: { uid: string; name: string; avatar: string; role: "owner" | "admin" | "member" }[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await api.getGroupMembersInfo(ids.slice(i, i + 50));
      for (const id of ids.slice(i, i + 50)) {
        const p = (r.profiles ?? {})[id] ?? (r.profiles ?? {})[`${id}_0`];
        members.push({
          uid: id,
          name: p?.displayName || p?.zaloName || id,
          avatar: p?.avatar ?? "",
          role: id === String(info.creatorId) ? "owner" : admins.has(id) ? "admin" : "member",
        });
      }
    }
    const order = { owner: 0, admin: 1, member: 2 };
    members.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "vi"));
    return { name: info.name as string, total: info.totalMember ?? members.length, members, selfId: this.ownId };
  }

  /** Thêm người vào nhóm Zalo. Trả danh sách người không thêm được (họ chặn được thêm vào nhóm…). */
  async addToGroup(groupId: string, uids: string[]) {
    const r = await this.requireApi().addUserToGroup(uids, groupId);
    this.groupsCache = null;
    return { failed: (r.errorMembers ?? []).map(String) };
  }

  /** Lời mời kết bạn đang chờ mình xác nhận. */
  async friendRequests() {
    const api = this.requireApi();
    const r = await api.getFriendRecommendations();
    return (r.recommItems ?? [])
      .map((i) => i.dataInfo)
      .filter((d) => d && d.recommType === 2)
      .map((d) => ({
        uid: d.userId,
        name: d.displayName || d.zaloName,
        avatar: d.avatar,
        phone: d.phoneNumber || null,
        message: d.recommInfo?.message ?? "",
        time: d.recommTime || null,
      }));
  }

  async acceptFriend(uid: string) {
    await this.requireApi().acceptFriendRequest(uid);
    this.friendsCache = null;
  }

  async rejectFriend(uid: string) {
    await this.requireApi().rejectFriendRequest(uid);
  }

  /** Trạng thái kết bạn với một người: đã là bạn / mình đã gửi lời mời / họ đã gửi lời mời. */
  async friendStatus(uid: string) {
    const s = await this.requireApi().getFriendRequestStatus(uid);
    return { isFriend: !!s.is_friend, requested: !!s.is_requested, requesting: !!s.is_requesting };
  }

  async sendFriendRequest(uid: string, message: string) {
    await this.requireApi().sendFriendRequest(message.slice(0, 150) || "Xin chào, mình kết bạn nhé", uid);
  }

  async undoFriendRequest(uid: string) {
    await this.requireApi().undoFriendRequest(uid);
  }

  /** Tạo nhóm Zalo với các thành viên (uid). Trả id nhóm. */
  async createGroup(name: string, members: string[]) {
    const r = await this.requireApi().createGroup({ name, members });
    if (!r?.groupId) throw new Error("Zalo không tạo được nhóm");
    this.groupsCache = null;
    return { groupId: String(r.groupId), failed: r.errorMembers ?? [] };
  }

  /** Tra người dùng theo số điện thoại (0xxx, 84xxx hoặc +84xxx). Không tìm thấy → null. */
  async findByPhone(phone: string): Promise<ZaloPerson | null> {
    const api = this.requireApi();
    this.checkLookupQuota();
    // Số chưa đăng ký Zalo hoặc người dùng tắt "cho tìm qua số điện thoại": thư viện trả về rỗng (mã 216).
    const u = await api.findUser(phone);
    if (!u?.uid) return null;
    return {
      uid: u.uid,
      name: u.display_name || u.zalo_name,
      zaloName: u.zalo_name,
      avatar: u.avatar,
      phone,
      isFriend: !!this.friendsCache?.list.some((f) => f.uid === u.uid),
    };
  }

  // ───────────── Sticker, cảm xúc, thu hồi, chuyển tiếp ─────────────

  /** Tìm sticker theo từ khóa (giống ô tìm sticker của Zalo). */
  async searchStickers(keyword: string): Promise<StickerInfo[]> {
    const api = this.requireApi();
    const ids = (await api.getStickers(keyword)).slice(0, 48);
    return this.stickerDetails(ids);
  }

  async stickerDetails(ids: number[]): Promise<StickerInfo[]> {
    if (!ids.length) return [];
    const api = this.requireApi();
    const details = await api.getStickersDetail(ids);
    return details.map((d) => ({
      id: d.id,
      cateId: d.cateId,
      type: d.type,
      url: d.stickerWebpUrl || d.stickerUrl || null,
      text: d.text ?? "",
    }));
  }

  async sendSticker(opts: {
    threadId: string;
    isGroup: boolean;
    sticker: { id: number; cateId: number; type: number };
    agentId: number | null;
    source: Source;
  }) {
    const api = this.requireApi();
    const type = opts.isGroup ? ThreadType.Group : ThreadType.User;
    const res = await api.sendSticker({ id: opts.sticker.id, cateId: opts.sticker.cateId, type: opts.sticker.type }, opts.threadId, type);
    return saveMessage({
      channelId: this.channelId,
      threadId: opts.threadId,
      conversationType: type,
      zaloMsgId: String(res.msgId),
      direction: "out",
      senderUid: this.ownId,
      senderName: this.status.account?.name,
      agentId: opts.agentId,
      source: opts.source,
      msgType: "chat.sticker",
      content: { id: opts.sticker.id, catId: opts.sticker.cateId, type: opts.sticker.type },
      ts: Date.now(),
    }).message;
  }

  async react(opts: { threadId: string; isGroup: boolean; message: StoredMessage; icon: string }) {
    const api = this.requireApi();
    if (!opts.message.zalo_msg_id || !opts.message.cli_msg_id) {
      throw new Error("Tin này chưa đồng bộ đủ mã với Zalo, chưa thả cảm xúc được. Thử lại sau vài giây.");
    }
    await api.addReaction(opts.icon as any, {
      data: { msgId: opts.message.zalo_msg_id, cliMsgId: opts.message.cli_msg_id },
      threadId: opts.threadId,
      type: opts.isGroup ? ThreadType.Group : ThreadType.User,
    });
  }

  async undo(opts: { threadId: string; isGroup: boolean; message: StoredMessage }) {
    const api = this.requireApi();
    if (!opts.message.zalo_msg_id || !opts.message.cli_msg_id) {
      throw new Error("Tin này chưa đồng bộ đủ mã với Zalo, chưa thu hồi được. Thử lại sau vài giây.");
    }
    await api.undo(
      { msgId: opts.message.zalo_msg_id, cliMsgId: opts.message.cli_msg_id },
      opts.threadId,
      opts.isGroup ? ThreadType.Group : ThreadType.User,
    );
    markUndone(this.channelId, opts.threadId, opts.message.zalo_msg_id);
  }

  /** Chuyển tiếp nội dung chữ sang hội thoại khác trong cùng kênh. */
  async forward(opts: { text: string; targets: { threadId: string; isGroup: boolean }[]; agentId: number | null; source: Source }) {
    const api = this.requireApi();
    const results: { threadId: string; ok: boolean; error?: string }[] = [];
    for (const t of opts.targets) {
      const type = t.isGroup ? ThreadType.Group : ThreadType.User;
      try {
        const r = await api.forwardMessage({ message: opts.text }, [t.threadId], type);
        const ok = r.success?.[0];
        if (!ok) throw new Error(r.fail?.[0]?.error_code ?? "Zalo từ chối");
        saveMessage({
          channelId: this.channelId,
          threadId: t.threadId,
          conversationType: type,
          zaloMsgId: String(ok.msgId),
          direction: "out",
          senderUid: this.ownId,
          senderName: this.status.account?.name,
          agentId: opts.agentId,
          source: opts.source,
          msgType: "webchat",
          content: opts.text,
          ts: Date.now(),
        });
        results.push({ threadId: t.threadId, ok: true });
      } catch (e: any) {
        results.push({ threadId: t.threadId, ok: false, error: e?.message ?? String(e) });
      }
    }
    return results;
  }

  /** Giao diện chung cho mọi nền tảng */
  sendMessage(opts: SendOptions) {
    return this.send({
      threadId: opts.conversation.thread_id,
      isGroup: opts.conversation.type === 1,
      text: opts.text,
      attachments: opts.attachments,
      agentId: opts.agentId,
      source: opts.source,
      quote: opts.quote,
      mentions: opts.mentions,
    });
  }

  /** Gửi tin nhắn và ghi nhận nhân viên đã gửi (để thống kê + training). */
  async send(opts: {
    threadId: string;
    isGroup: boolean;
    text?: string;
    attachments?: OutgoingAttachment[];
    agentId: number | null;
    source: Source;
    /** Trả lời (trích dẫn) một tin đã lưu */
    quote?: StoredMessage | null;
    /** Nhắc tên trong nhóm */
    mentions?: { pos: number; len: number; uid: string }[];
  }) {
    const api = this.requireApi();
    const type = opts.isGroup ? ThreadType.Group : ThreadType.User;
    const q = opts.quote;
    const res = await api.sendMessage(
      {
        quote:
          q && q.zalo_msg_id && q.cli_msg_id
            ? {
                content: (q.raw ?? q.text ?? "") as any,
                msgType: q.msg_type ?? "webchat",
                propertyExt: undefined,
                uidFrom: q.sender_uid ?? "",
                msgId: q.zalo_msg_id,
                cliMsgId: q.cli_msg_id,
                ts: String(q.ts),
                ttl: 0,
              }
            : undefined,
        msg: opts.text ?? "",
        mentions: opts.isGroup && opts.mentions?.length ? opts.mentions : undefined,
        attachments: opts.attachments?.length
          ? opts.attachments.map((a) => ({
              data: a.data,
              filename: a.filename as `${string}.${string}`,
              metadata: { totalSize: a.size, width: a.width, height: a.height },
            }))
          : undefined,
      },
      opts.threadId,
      type,
    );
    const quote: MessageQuote | null = q
      ? { msg: q.text ?? "", fromD: q.sender_name ?? "", globalMsgId: q.zalo_msg_id ?? "", ownerId: q.sender_uid ?? "" }
      : null;
    const common = {
      channelId: this.channelId,
      threadId: opts.threadId,
      conversationType: type,
      direction: "out" as const,
      senderUid: this.ownId,
      senderName: this.status.account?.name,
      agentId: opts.agentId,
      source: opts.source,
      ts: Date.now(),
    };
    const saved = [];
    if (res.message) {
      saved.push(
        saveMessage({ ...common, zaloMsgId: String(res.message.msgId), msgType: "webchat", content: opts.text ?? "", quote }).message,
      );
    }
    for (const [i, a] of (res.attachment ?? []).entries()) {
      const file = opts.attachments?.[i];
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file?.filename ?? "");
      saved.push(
        saveMessage({
          ...common,
          zaloMsgId: String(a.msgId),
          msgType: isImage ? "chat.photo" : "share.file",
          content: { title: file?.filename ?? "", href: file?.localUrl ?? "", thumb: isImage ? file?.localUrl ?? "" : "" },
        }).message,
      );
    }
    return saved;
  }
}

/** Quản lý tất cả kênh chat (Zalo, Facebook, TikTok, TikTok Shop). */
class ChannelManager {
  private sessions = new Map<number, ChannelAdapter>();

  session(channelId: number): ChannelAdapter {
    let s = this.sessions.get(channelId);
    if (!s) {
      const row = get<{ platform: Platform }>("SELECT platform FROM channels WHERE id = ?", channelId);
      if (!row) throw new Error("Kênh không tồn tại");
      s =
        row.platform === "facebook"
          ? new MetaSession(channelId)
          : row.platform === "tiktok"
            ? new TikTokSession(channelId)
            : row.platform === "tiktok_shop"
              ? new TikTokShopSession(channelId)
              : row.platform === "zalo_oa"
                ? new ZaloOaSession(channelId)
                : new ChannelSession(channelId);
      this.sessions.set(channelId, s);
    }
    return s;
  }

  /** Kênh Zalo (cho các tính năng riêng của Zalo: QR, sticker, cảm xúc, bạn bè…). */
  zaloSession(channelId: number): ChannelSession {
    const s = this.session(channelId);
    if (!(s instanceof ChannelSession)) throw new Error("Tính năng này chỉ có ở kênh Zalo");
    return s;
  }

  /** Tìm kênh theo id tài khoản bên nền tảng (page id, open_id, shop id) — dùng cho webhook. */
  byExternal(platform: Platform, externalId: string) {
    const row = get<{ id: number }>("SELECT id FROM channels WHERE platform = ? AND external_id = ? AND active = 1", platform, externalId);
    return row ? this.session(row.id) : null;
  }

  async initAll() {
    const rows = all<{ id: number }>("SELECT id FROM channels WHERE active = 1 AND credentials IS NOT NULL");
    for (const r of rows) {
      try {
        await this.session(r.id).init();
      } catch (e) {
        console.error(`[channels] Khởi động kênh #${r.id} lỗi:`, e);
      }
    }
  }

  statuses(): ChannelStatus[] {
    return all<{ id: number }>("SELECT id FROM channels WHERE active = 1 ORDER BY id").map((r) => this.session(r.id).getStatus());
  }

  /** Một kênh Zalo bất kỳ đang kết nối (để tra thông tin dùng chung như ảnh sticker). */
  anyConnected() {
    for (const r of all<{ id: number }>("SELECT id FROM channels WHERE active = 1 AND platform = 'zalo' ORDER BY id")) {
      const s = this.session(r.id);
      if (s instanceof ChannelSession && s.connected) return s;
    }
    return null;
  }

  /** Còn kênh nào đang kết nối không (dùng cho /healthz). */
  summary() {
    const list = this.statuses();
    return { total: list.length, connected: list.filter((s) => s.state === "connected").length };
  }

  async remove(channelId: number) {
    await this.sessions.get(channelId)?.logout(true);
    this.sessions.delete(channelId);
  }
}

/** Tên cũ "zalo" giữ lại: thực chất là bộ quản lý mọi kênh chat. */
export const zalo = new ChannelManager();
export const channels = zalo;
