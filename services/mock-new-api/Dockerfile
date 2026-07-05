FROM golang:1.25-alpine AS builder
WORKDIR /app
ENV GOPROXY=https://goproxy.cn,direct
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /mock ./cmd/mock

FROM alpine:3.20
COPY --from=builder /mock /mock
EXPOSE 3002
CMD ["/mock"]
