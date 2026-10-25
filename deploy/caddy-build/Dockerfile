# Caddy built from source with patched dependencies (golang.org/x/net v0.61.0 fixes the HTTP/2
# flow-control CVE that the official 2.11.7 image still carries). go.mod/go.sum pin every module.
FROM golang:1.26.10-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /caddy .

FROM caddy:2.11.7-alpine
RUN apk upgrade --no-cache
COPY --from=build /caddy /usr/bin/caddy
