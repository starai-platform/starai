package storage

import (
	"context"
	"io"
)

type Store interface {
	Upload(ctx context.Context, objectName, contentType string, r io.Reader, size int64) (string, error)
}
