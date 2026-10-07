FROM golang:1.26-alpine@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS builder
RUN apk add --no-cache git ca-certificates
# Código oficial fixado; as antigas imagens Community não são pressupostas disponíveis.
RUN CGO_ENABLED=0 go install github.com/minio/minio@7aac2a2c5b7c882e68c1ce017d8256be2feea27f

FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
RUN apk add --no-cache ca-certificates curl && addgroup -g 10001 minio && adduser -D -u 10001 -G minio minio && mkdir /data && chown minio:minio /data
COPY --from=builder /go/bin/minio /usr/local/bin/minio
USER 10001:10001
EXPOSE 9000 9001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD curl --fail --silent http://127.0.0.1:9000/minio/health/live || exit 1
ENTRYPOINT ["minio"]
