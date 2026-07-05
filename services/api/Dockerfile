FROM golang:1.25-alpine AS builder
WORKDIR /app
ENV GOPROXY=https://goproxy.cn,direct
ENV GOMAXPROCS=2
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -p=2 -o /api ./cmd/api
RUN CGO_ENABLED=0 go build -p=2 -o /migrate ./cmd/migrate

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /api /api
COPY --from=builder /migrate /migrate
EXPOSE 8080
CMD ["/api"]
