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
