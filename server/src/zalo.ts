import { Zalo, ThreadType, LoginQRCallbackEventType, type API, type Credentials, type Message, type Reaction } from "zca-js";
import { all, get, logEvent, run } from "./db.js";
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

export type StickerInfo = { id: number; cateId: number; type: number; url: string | null; text: string };

/** Tin nhắn đã lưu, dùng để trả lời / thả cảm xúc / thu hồi trên Zalo. */
export type StoredMessage = {
  zalo_msg_id: string | null;
  cli_msg_id: string | null;
  msg_type: string | null;
  sender_uid: string | null;
  sender_name: string | null;
  text: string | null;
  raw: any;
  ts: number;
};

export type ZaloStatus = {
  channelId: number;
  channelName: string;
  state: "disconnected" | "qr" | "scanned" | "connecting" | "connected" | "error";
  qrImage?: string; // data URL ảnh QR
  scannedBy?: { name: string; avatar: string };
  account?: { id: string; name: string; avatar: string };
  error?: string;
  updatedAt: number;
};

export type ZaloPerson = {
  uid: string;
  name: string;
  zaloName: string;
  avatar: string;
  phone: string | null;
  isFriend: boolean;
};

export type OutgoingAttachment = {
  data: Buffer;
  filename: string;
  size: number;
  width?: number;
  height?: number;
  /** Đường dẫn bản lưu trên server để hiển thị lại trong lịch sử chat. */
  localUrl?: string;
};

type ChannelRow = { id: number; name: string; credentials: string | null; zalo_uid: string | null; active: number };

/** Một kênh = một tài khoản Zalo đang kết nối. */
class ChannelSession {
  private api: API | null = null;
  private qrActions: { abort: () => unknown } | null = null;
  private qrCancelled = false;
  private status: ZaloStatus;
  private profileFetchQueue = new Set<string>();
  private friendsCache: { at: number; list: ZaloPerson[] } | null = null;
  private lookupTimes: number[] = [];

  constructor(readonly channelId: number) {
    this.status = { channelId, channelName: this.channelName(), state: "disconnected", updatedAt: Date.now() };
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
    const base = { channelId: this.channelId, channelName: this.channelName() };
    this.status = replace
      ? ({ ...base, ...patch, updatedAt: Date.now() } as ZaloStatus)
      : { ...this.status, ...base, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }

  /** Tên kênh đổi trong cài đặt → cập nhật trạng thái đang hiển thị. */
  refreshName() {
    this.setStatus({});
  }

  private newClient() {
    return new Zalo({ selfListen: true, checkUpdate: false, logging: false });
  }

  private saveCredentials(creds: Credentials) {
    run("UPDATE channels SET credentials = ? WHERE id = ?", JSON.stringify({ ...creds, savedAt: Date.now() }), this.channelId);
  }

  /** Khởi động: đăng nhập lại bằng cookie đã lưu (nếu có). */
  async init() {
    const row = this.row();
    if (!row?.credentials || !row.active) return;
    this.setStatus({ state: "connecting" }, true);
    try {
      const api = await this.newClient().login(JSON.parse(row.credentials));
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
            this.qrActions = event.actions;
            this.setStatus({ state: "qr", qrImage: `data:image/png;base64,${event.data.image}` }, true);
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            this.qrActions = event.actions;
            this.setStatus({ state: "error", error: "Mã QR đã hết hạn. Bấm tạo mã mới." }, true);
            event.actions.abort();
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            this.setStatus({
              state: "scanned",
              scannedBy: { name: event.data.display_name, avatar: event.data.avatar },
            });
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
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
      const dup = get<{ name: string }>("SELECT name FROM channels WHERE zalo_uid = ? AND id != ?", ownId, this.channelId);
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
    this.api = null;
    this.friendsCache = null;
    if (clearCredentials) {
      run("UPDATE channels SET credentials = NULL WHERE id = ?", this.channelId);
      this.setStatus({ state: "disconnected" }, true);
      logEvent(null, null, "zalo.logout", { channel: this.channelId });
    }
  }

  private async attach(api: API) {
    this.api = api;
    const ownId = api.getOwnId();
    let name = ownId;
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
      this.setStatus({ state: "connected", account: { id: ownId, name, avatar }, error: undefined, qrImage: undefined });
      // Đồng bộ các tin gần đây mà Zalo còn giữ.
      listener.requestOldMessages(ThreadType.User);
      listener.requestOldMessages(ThreadType.Group);
    });
    listener.on("message", (m) => this.handleMessage(m, false));
    listener.on("old_messages", (msgs) => msgs.forEach((m) => this.handleMessage(m, true)));
    listener.on("reaction", (r) => this.handleReaction(r));
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

  private handleMessage(m: Message, isHistory: boolean) {
    try {
      const d = m.data;
      const isGroup = m.type === ThreadType.Group;
      const source: Source = m.isSelf ? (isHistory ? "history" : "phone") : "customer";
      saveMessage({
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
    } catch (e) {
      console.error(`[zalo#${this.channelId}] Lỗi lưu tin nhắn:`, e);
    }
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
    (async () => {
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
    })();
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

/** Quản lý tất cả kênh Zalo. */
class ZaloManager {
  private sessions = new Map<number, ChannelSession>();

  session(channelId: number) {
    let s = this.sessions.get(channelId);
    if (!s) {
      if (!get("SELECT 1 FROM channels WHERE id = ?", channelId)) throw new Error("Kênh không tồn tại");
      s = new ChannelSession(channelId);
      this.sessions.set(channelId, s);
    }
    return s;
  }

  async initAll() {
    const rows = all<{ id: number }>("SELECT id FROM channels WHERE active = 1 AND credentials IS NOT NULL");
    for (const r of rows) await this.session(r.id).init();
  }

  statuses(): ZaloStatus[] {
    return all<{ id: number }>("SELECT id FROM channels WHERE active = 1 ORDER BY id").map((r) => this.session(r.id).getStatus());
  }

  /** Một kênh bất kỳ đang kết nối (để tra thông tin dùng chung như ảnh sticker). */
  anyConnected() {
    for (const r of all<{ id: number }>("SELECT id FROM channels WHERE active = 1 ORDER BY id")) {
      const s = this.session(r.id);
      if (s.connected) return s;
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

export const zalo = new ZaloManager();
