ARG GOLANG_BASE_IMAGE=golang:1.24-alpine
ARG ALPINE_BASE_IMAGE=alpine:3.21
ARG BUILDPLATFORM
ARG TARGETPLATFORM

FROM --platform=$BUILDPLATFORM ${GOLANG_BASE_IMAGE} AS builder

ARG GOPROXY=https://proxy.golang.org,direct
ARG TARGETOS=linux
ARG TARGETARCH

ENV GOPROXY=${GOPROXY} \
    GODEBUG=http2client=0

COPY scripts/docker-go-mod-download.sh /usr/local/bin/go-mod-download
RUN chmod +x /usr/local/bin/go-mod-download

WORKDIR /src/services/auth-service
COPY services/auth-service/go.mod services/auth-service/go.sum ./
RUN go-mod-download github.com/bytedance/sonic@v1.9.1
RUN go-mod-download
COPY services/auth-service ./
RUN mkdir -p /out && \
    target_arch="${TARGETARCH:-$(go env GOARCH)}" && \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${target_arch}" go build -o /out/auth-service ./cmd/server

FROM --platform=$TARGETPLATFORM ${ALPINE_BASE_IMAGE}

RUN apk add --no-cache ca-certificates
COPY --from=builder /out/auth-service /usr/local/bin/auth-service
EXPOSE 8004
ENTRYPOINT ["auth-service"]
