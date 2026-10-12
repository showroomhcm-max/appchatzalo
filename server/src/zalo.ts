import { Zalo, ThreadType, LoginQRCallbackEventType, type API, type Credentials, type Message } from "zca-js";
import { getSetting, setSetting, logEvent } from "./db.js";
import { bus } from "./bus.js";
import { saveMessage, markUndone, updateConversationProfile, getConversation, type Source } from "./store.js";

export type ZaloStatus = {
  state: "disconnected" | "qr" | "scanned" | "connecting" | "connected" | "error";
  qrImage?: string; // data URL ảnh QR
  scannedBy?: { name: string; avatar: string };
  account?: { id: string; name: string; avatar: string };
  error?: string;
  updatedAt: number;
};

type SavedCredentials = Credentials & { savedAt: number };

const CRED_KEY = "zalo.credentials";

export type OutgoingAttachment = {
  data: Buffer;
  filename: string;
  size: number;
  width?: number;
  height?: number;
  /** Đường dẫn bản lưu trên server để hiển thị lại trong lịch sử chat. */
  localUrl?: string;
};

class ZaloService {
  private api: API | null = null;
  private qrActions: { abort: () => unknown } | null = null;
  private qrCancelled = false;
  private status: ZaloStatus = { state: "disconnected", updatedAt: Date.now() };
  private profileFetchQueue = new Set<string>();

  getStatus(): ZaloStatus {
    return this.status;
  }

  get ownId() {
    return this.status.account?.id;
  }

  private setStatus(patch: Partial<ZaloStatus>, replace = false) {
    this.status = replace
      ? ({ ...patch, updatedAt: Date.now() } as ZaloStatus)
      : { ...this.status, ...patch, updatedAt: Date.now() };
    bus.emit("zalo.status", this.status);
  }

  private newClient() {
    return new Zalo({ selfListen: true, checkUpdate: false, logging: false });
  }

  /** Khởi động: đăng nhập lại bằng cookie đã lưu (nếu có). */
  async init() {
    const creds = getSetting<SavedCredentials>(CRED_KEY);
    if (!creds) return;
    this.setStatus({ state: "connecting" }, true);
    try {
      const api = await this.newClient().login(creds);
      await this.attach(api);
    } catch (e) {
      console.error("[zalo] Đăng nhập lại bằng cookie thất bại:", e);
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
      if (creds) setSetting(CRED_KEY, { ...(creds as Credentials), savedAt: Date.now() });
      await this.attach(api);
      logEvent(null, null, "zalo.login", { method: "qr" });
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
    if (clearCredentials) {
      setSetting(CRED_KEY, null);
      this.setStatus({ state: "disconnected" }, true);
      logEvent(null, null, "zalo.logout");
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

    // Lưu lại cookie mới nhất để lần khởi động sau không phải quét QR.
    try {
      const ctx = api.getContext();
      setSetting(CRED_KEY, {
        imei: ctx.imei,
        userAgent: ctx.userAgent,
        cookie: api.getCookie().toJSON()?.cookies ?? [],
        savedAt: Date.now(),
      });
    } catch (e) {
      console.warn("[zalo] Không lưu được cookie:", e);
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
    listener.on("undo", (u) => {
      const id = String(u.data.content?.globalMsgId ?? "");
      if (id) markUndone(id);
    });
    listener.on("error", (e) => console.error("[zalo] listener error:", e));
    listener.on("closed", (code, reason) => {
      console.warn("[zalo] listener closed:", code, reason);
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
      const direction = m.isSelf ? "out" : "in";
      let source: Source = m.isSelf ? (isHistory ? "history" : "phone") : "customer";
      saveMessage({
        conversationId: m.threadId,
        conversationType: isGroup ? 1 : 0,
        zaloMsgId: String(d.msgId),
        cliMsgId: d.cliMsgId ? String(d.cliMsgId) : null,
        direction,
        senderUid: d.uidFrom === "0" ? this.ownId ?? d.uidFrom : d.uidFrom,
        senderName: d.dName,
        source,
        msgType: d.msgType,
        content: d.content,
        ts: Number(d.ts) || Date.now(),
        isHistory,
      });
      this.ensureProfile(m.threadId, isGroup);
    } catch (e) {
      console.error("[zalo] Lỗi lưu tin nhắn:", e);
    }
  }

  /** Lấy tên + ảnh đại diện khách/nhóm một lần cho hội thoại mới. */
  private ensureProfile(threadId: string, isGroup: boolean) {
    const conv = getConversation(threadId);
    if (!this.api || !conv || (conv.avatar && conv.name) || this.profileFetchQueue.has(threadId)) return;
    this.profileFetchQueue.add(threadId);
    const api = this.api;
    (async () => {
      try {
        if (isGroup) {
          const r = await api.getGroupInfo(threadId);
          const g = r.gridInfoMap?.[threadId];
          if (g) updateConversationProfile(threadId, { name: g.name, avatar: g.fullAvt || g.avt });
        } else {
          const r = await api.getUserInfo(threadId);
          const u = r.changed_profiles?.[threadId] ?? (r.changed_profiles?.[`${threadId}_0`] as any);
          if (u) updateConversationProfile(threadId, { name: u.displayName || u.zaloName, avatar: u.avatar });
        }
      } catch (e) {
        console.warn("[zalo] Không lấy được thông tin", threadId, e);
      }
    })();
  }

  /** Gửi tin nhắn và ghi nhận nhân viên đã gửi (để thống kê + training). */
  async send(opts: {
    conversationId: string;
    text?: string;
    attachments?: OutgoingAttachment[];
    agentId: number | null;
    source: Source;
  }) {
    if (!this.api || this.status.state !== "connected") throw new Error("Zalo chưa kết nối");
    const conv = getConversation(opts.conversationId);
    const type = conv?.type === 1 ? ThreadType.Group : ThreadType.User;
    const res = await this.api.sendMessage(
      {
        msg: opts.text ?? "",
        attachments: opts.attachments?.length ? opts.attachments.map((a) => ({
          data: a.data,
          filename: a.filename as `${string}.${string}`,
          metadata: { totalSize: a.size, width: a.width, height: a.height },
        })) : undefined,
      },
      opts.conversationId,
      type,
    );
    const saved = [];
    const ts = Date.now();
    if (res.message) {
      saved.push(
        saveMessage({
          conversationId: opts.conversationId,
          conversationType: type,
          zaloMsgId: String(res.message.msgId),
          direction: "out",
          senderUid: this.ownId,
          senderName: this.status.account?.name,
          agentId: opts.agentId,
          source: opts.source,
          msgType: "webchat",
          content: opts.text ?? "",
          ts,
        }).message,
      );
    }
    for (const [i, a] of (res.attachment ?? []).entries()) {
      const file = opts.attachments?.[i];
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file?.filename ?? "");
      saved.push(
        saveMessage({
          conversationId: opts.conversationId,
          conversationType: type,
          zaloMsgId: String(a.msgId),
          direction: "out",
          senderUid: this.ownId,
          senderName: this.status.account?.name,
          agentId: opts.agentId,
          source: opts.source,
          msgType: isImage ? "chat.photo" : "share.file",
          content: { title: file?.filename ?? "", href: file?.localUrl ?? "", thumb: isImage ? file?.localUrl ?? "" : "" },
          ts,
        }).message,
      );
    }
    return saved;
  }
}

export const zalo = new ZaloService();
