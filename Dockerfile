FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server server
COPY web web
RUN npm --prefix web run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:24-slim
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data WEB_DIST=/app/web/dist TZ=Asia/Ho_Chi_Minh
WORKDIR /app/server
# package.json gốc giữ số phiên bản app (server/src/version.ts đọc ../package.json)
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
COPY --from=build /app/web/dist /app/web/dist
# Script tự cập nhật trên NAS đi kèm bản build: NAS tự lấy bản mới của script này
COPY deploy/nas/cap-nhat.sh /app/deploy/cap-nhat.sh
VOLUME /app/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
