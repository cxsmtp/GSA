# Production image (VPS with Docker).
# Node 26 (current release, fewest known CVEs): built-in SQLite, no native modules to compile.
FROM node:26.10.0-alpine3.24 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
# tini forwards SIGTERM so in-flight payments finish; package managers removed from the runtime.
RUN apk upgrade --no-cache && apk add --no-cache tini=0.19.0-r3 \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data TZ=Asia/Kolkata \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app && mkdir -p /data && chown app:app /data && chmod 700 /data
COPY --from=builder /app/.next/standalone ./
USER app
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
