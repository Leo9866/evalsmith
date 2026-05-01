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

WORKDIR /src/workers/trace-consumer
COPY workers/trace-consumer/go.mod workers/trace-consumer/go.sum ./
RUN go-mod-download github.com/bytedance/sonic@v1.9.1
RUN go-mod-download
COPY workers/trace-consumer ./
RUN mkdir -p /out && \
    target_arch="${TARGETARCH:-$(go env GOARCH)}" && \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${target_arch}" go build -o /out/trace-consumer ./cmd/consumer

FROM --platform=$TARGETPLATFORM ${ALPINE_BASE_IMAGE}

RUN apk add --no-cache ca-certificates
COPY --from=builder /out/trace-consumer /usr/local/bin/trace-consumer
ENTRYPOINT ["trace-consumer"]
