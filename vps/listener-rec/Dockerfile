# listener-rec: records each live room as a hidden listener (server arrival clock).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
COPY main.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /listener-rec . && cp go.mod go.sum /

FROM alpine:3.20.3
RUN apk add --no-cache ffmpeg ca-certificates tzdata && adduser -D -u 1000 rec
COPY --from=build /listener-rec /usr/local/bin/listener-rec
COPY --from=build /go.mod /go.sum /usr/share/listener-rec/
USER 1000
ENTRYPOINT ["/usr/local/bin/listener-rec"]
