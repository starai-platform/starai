package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Client wraps a MinIO/S3-compatible object store for user uploads.
type Client struct {
	mc        *minio.Client
	bucket    string
	publicURL string
}

// New connects to MinIO, ensures the bucket exists and is publicly readable.
func New(endpoint, accessKey, secretKey, bucket, publicURL string, useSSL bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := mc.BucketExists(ctx, bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := mc.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
	}

	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, bucket)
	_ = mc.SetBucketPolicy(ctx, bucket, policy)

	if publicURL == "" {
		scheme := "http"
		if useSSL {
			scheme = "https"
		}
		publicURL = fmt.Sprintf("%s://%s", scheme, endpoint)
	}

	return &Client{mc: mc, bucket: bucket, publicURL: publicURL}, nil
}

// Upload stores an object and returns its public URL.
func (c *Client) Upload(ctx context.Context, objectName, contentType string, r io.Reader, size int64) (string, error) {
	_, err := c.mc.PutObject(ctx, c.bucket, objectName, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s", c.publicURL, c.bucket, objectName), nil
}

// ReadAll reads an object from storage, bounded by maxBytes.
func (c *Client) ReadAll(ctx context.Context, objectName string, maxBytes int64) ([]byte, error) {
	obj, err := c.mc.GetObject(ctx, c.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	return io.ReadAll(io.LimitReader(obj, maxBytes+1))
}

// Delete removes an object from storage.
func (c *Client) Delete(ctx context.Context, objectName string) error {
	return c.mc.RemoveObject(ctx, c.bucket, objectName, minio.RemoveObjectOptions{})
}

func (c *Client) ObjectKeyFromURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	publicBase, _ := url.Parse(strings.TrimRight(c.publicURL, "/"))
	path := strings.TrimPrefix(u.Path, "/")
	if publicBase != nil && publicBase.Host != "" && strings.EqualFold(u.Host, publicBase.Host) {
		basePath := strings.Trim(strings.TrimPrefix(publicBase.Path, "/"), "/")
		if basePath != "" {
			path = strings.TrimPrefix(path, basePath+"/")
		}
		path = strings.TrimPrefix(path, c.bucket+"/")
		return strings.TrimPrefix(path, "/")
	}
	if strings.HasPrefix(path, c.bucket+"/") {
		return strings.TrimPrefix(path, c.bucket+"/")
	}
	return ""
}

func (c *Client) PublicURL(objectName string) string {
	return fmt.Sprintf("%s/%s/%s", c.publicURL, c.bucket, strings.TrimLeft(objectName, "/"))
}
