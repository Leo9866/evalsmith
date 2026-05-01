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

WORKDIR /src/services/dataset-service
COPY services/dataset-service/go.mod services/dataset-service/go.sum ./
RUN go-mod-download github.com/bytedance/sonic@v1.9.1
RUN go-mod-download
COPY services/dataset-service ./
RUN mkdir -p /out && \
    target_arch="${TARGETARCH:-$(go env GOARCH)}" && \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${target_arch}" go build -o /out/dataset-service ./cmd/server

FROM --platform=$TARGETPLATFORM ${ALPINE_BASE_IMAGE}

RUN apk add --no-cache ca-certificates
COPY --from=builder /out/dataset-service /usr/local/bin/dataset-service
EXPOSE 8003
ENTRYPOINT ["dataset-service"]
