/// <reference types="vite/client" />

/** Thông tin bản build, do vite.config.ts gắn vào lúc build. */
declare const __APP_BUILD__: { version: string; buildId: string; builtAt: string; commit: string }
