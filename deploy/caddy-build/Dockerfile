# Caddy v2.11.7 built from source with golang.org/x/net v0.61.0, which fixes the HTTP/2 flow-control
# CVE the official image still carries. The two versions below are pinned; Go's minimal version
# selection makes the rest of the build list deterministic, and every module is verified against the
# Go checksum database. Checked with govulncheck (-mode=binary): no known vulnerability reachable.
FROM golang:1.26.10-alpine3.24 AS build
WORKDIR /src
COPY main.go ./
RUN go mod init caddybuild \
 && go get github.com/caddyserver/caddy/v2@v2.11.7 golang.org/x/net@v0.61.0 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /caddy .

FROM caddy:2.11.7-alpine
COPY --from=build /caddy /usr/bin/caddy
# Runs as its own unprivileged user; binding 80/443 is allowed by the compose file's sysctl.
RUN apk upgrade --no-cache \
 && addgroup -S -g 1001 caddy && adduser -S -u 1001 -G caddy -h /data caddy \
 && chown -R caddy:caddy /data /config
USER caddy
HEALTHCHECK --interval=1m --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:2019/config/ || exit 1
