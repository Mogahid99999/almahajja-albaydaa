# syntax=docker/dockerfile:1
# almahajja-media-worker — build:  docker build -t almahajja-media-worker:dev vps/media-worker

# ---- deps: dev + prod dependencies -------------------------------------------
FROM node:22.23.3-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: compile TypeScript, then drop dev dependencies -------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---- test (opt-in): the full suite on Linux, incl. the file-symlink escape
#      cases Windows cannot create:  docker build --target test vps/media-worker
FROM deps AS test
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY test ./test
RUN npx tsc --noEmit && npx vitest run

# ---- runtime: node + ffmpeg, non-root ----------------------------------------
FROM node:22.23.3-alpine AS runtime
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production \
    PORT=8080 \
    TMP_DIR=/tmp/media-worker
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
# `node` (uid 1000) ships with the base image; it only needs to write TMP_DIR.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/index.js"]
