import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { userFromToken, type AuthUser } from "./auth.js";
import { bus } from "./bus.js";
import { zalo } from "./zalo.js";
import { config } from "./config.js";

type Presence = { userId: number; name: string; viewing: string | null; typing: boolean };

export function setupRealtime(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: config.corsOrigins.length ? config.corsOrigins : true },
  });
  const presence = new Map<string, Presence>(); // socket.id → trạng thái

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
    io.to("agents").emit("presence", { online: [...online.values()], byConversation });
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
    socket.emit("zalo:status", zalo.getStatus());
    broadcastPresence();

    socket.on("view", (conversationId: string | null) => {
      const p = presence.get(socket.id);
      if (!p) return;
      p.viewing = conversationId || null;
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
      broadcastPresence();
    });
  });

  bus.on("message.created", (message, conversation) => io.to("agents").emit("message:new", { message, conversation }));
  bus.on("message.updated", (message, conversation) =>
    io.to("agents").emit("message:update", { message, conversation }),
  );
  bus.on("conversation.updated", (conversation) => io.to("agents").emit("conversation:update", conversation));
  bus.on("zalo.status", (status) => io.to("agents").emit("zalo:status", status));

  return io;
}
