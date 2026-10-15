import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { userFromToken, type AuthUser } from "./auth.js";
import { allowLan, isLoopback } from "./security.js";
import { getConversation } from "./store.js";
import { bus } from "./bus.js";
import { zalo } from "./zalo.js";
import { config } from "./config.js";
import { canSeeConversation, canUseChannel, scopeOf, type Scope } from "./access.js";

type Presence = { userId: number; name: string; viewing: string | null; typing: boolean };

export function setupRealtime(server: HttpServer) {
  const io = new Server(server, {
    // Chỉ giao diện cùng tên miền (hoặc CORS_ORIGINS) được mở kết nối realtime
    cors: config.corsOrigins.length ? { origin: config.corsOrigins } : undefined,
    allowRequest: (req, cb) => cb(null, allowLan() || isLoopback(req.socket.remoteAddress)),
  });
  const presence = new Map<string, Presence>(); // socket.id → trạng thái

  // Phạm vi nhìn thấy của từng kết nối, tính lại tối đa mỗi 30 giây hoặc khi cài đặt thay đổi.
  const scopes = new Map<string, { at: number; scope: Scope }>();
  function scopeFor(socket: Socket) {
    const cached = scopes.get(socket.id);
    if (cached && Date.now() - cached.at < 30_000) return cached.scope;
    const scope = scopeOf(socket.data.user as AuthUser);
    scopes.set(socket.id, { at: Date.now(), scope });
    return scope;
  }

  /** Chỉ gửi sự kiện của hội thoại cho người được xem hội thoại đó (theo bộ phận). */
  function emitForConversation(event: string, conversation: any, payload: unknown) {
    for (const socket of io.of("/").sockets.values()) {
      if (canSeeConversation(scopeFor(socket), conversation)) socket.emit(event, payload);
    }
  }

  function broadcastPresence() {
    const online = new Map<number, { userId: number; name: string }>();
    const byConversation: Record<string, { userId: number; name: string; typing: boolean }[]> = {};
    for (const p of presence.values()) {
      online.set(p.userId, { userId: p.userId, name: p.name });
      if (!p.viewing) continue;
      const list = (byConversation[p.viewing] ??= []);
      const existing = list.find((x) => x.userId === p.userId);
      if (existing) existing.typing ||= p.typing;
      else list.push({ userId: p.userId, name: p.name, typing: p.typing });
    }
    const convCache = new Map<string, ReturnType<typeof getConversation>>();
    const convOf = (id: string) => {
      if (!convCache.has(id)) convCache.set(id, getConversation(id));
      return convCache.get(id);
    };
    for (const socket of io.of("/").sockets.values()) {
      const scope = scopeFor(socket);
      const visible: typeof byConversation = {};
      for (const [id, viewers] of Object.entries(byConversation)) {
        const conv = convOf(id);
        if (conv && canSeeConversation(scope, conv)) visible[id] = viewers;
      }
      socket.emit("presence", { online: [...online.values()], byConversation: visible });
    }
  }

  io.use((socket, next) => {
    const user = userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join("agents");
    presence.set(socket.id, { userId: user.id, name: user.display_name, viewing: null, typing: false });
    const scope = scopeFor(socket);
    for (const s of zalo.statuses()) if (canUseChannel(scope, s.channelId)) socket.emit("zalo:status", s);
    broadcastPresence();

    socket.on("view", (conversationId: string | null) => {
      const p = presence.get(socket.id);
      if (!p) return;
      // Chỉ ghi nhận hội thoại người này được xem
      const id = typeof conversationId === "string" && conversationId.length <= 120 ? conversationId : null;
      const conv = id ? getConversation(id) : null;
      p.viewing = conv && canSeeConversation(scopeFor(socket), conv) ? id : null;
      p.typing = false;
      broadcastPresence();
    });
    socket.on("typing", (typing: boolean) => {
      const p = presence.get(socket.id);
      if (!p || p.typing === !!typing) return;
      p.typing = !!typing;
      broadcastPresence();
    });
    socket.on("disconnect", () => {
      presence.delete(socket.id);
      scopes.delete(socket.id);
      broadcastPresence();
    });
  });

  bus.on("message.created", (message, conversation) => emitForConversation("message:new", conversation, { message, conversation }));
  bus.on("message.updated", (message, conversation) =>
    emitForConversation("message:update", conversation, { message, conversation }),
  );
  bus.on("conversation.updated", (conversation, change) => {
    if (change?.type === "department") {
      // Hội thoại chuyển bộ phận: người không còn được xem nhận "removed" để gỡ khỏi danh sách.
      for (const socket of io.of("/").sockets.values()) {
        socket.emit(canSeeConversation(scopeFor(socket), conversation) ? "conversation:update" : "conversation:removed",
          canSeeConversation(scopeFor(socket), conversation) ? conversation : { id: conversation.id });
      }
      return;
    }
    emitForConversation("conversation:update", conversation, conversation);
  });
  bus.on("zalo.status", (status) => {
    for (const socket of io.of("/").sockets.values()) {
      if (canUseChannel(scopeFor(socket), status.channelId)) socket.emit("zalo:status", status);
    }
  });
  // Cảnh báo / đơn hàng: báo giao diện tải lại (dữ liệu tải qua API theo đúng phạm vi người xem)
  bus.on("alerts.changed", () => io.to("agents").emit("alerts:changed"));
  bus.on("monitor.flagged", () => io.to("agents").emit("monitor:changed"));
  bus.on("zalo.typing", (ev) => {
    const conv = getConversation(`${ev.channelId}_${ev.threadId}`);
    if (conv) emitForConversation("customer:typing", conv, { conversation_id: conv.id, uid: ev.uid });
  });
  bus.on("zalo.friend", (ev) => {
    for (const socket of io.of("/").sockets.values()) {
      if (canUseChannel(scopeFor(socket), ev.channelId)) socket.emit("zalo:friend", ev);
    }
  });
  bus.on("alert.created", () => io.to("agents").emit("alerts:changed"));
  bus.on("order.updated", (order) => {
    if (order?.conversation_id) io.to("agents").emit("orders:changed", { conversation_id: order.conversation_id });
  });
  bus.on("settings.changed", (what) => {
    scopes.clear();
    io.to("agents").emit("settings:changed", what);
  });

  return io;
}
