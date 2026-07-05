package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/redis/go-redis/v9"
)

type Client struct {
	rdb *redis.Client
}

func New(redisURL string) (*Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &Client{rdb: redis.NewClient(opt)}, nil
}

func tokenKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "blacklist:token:" + hex.EncodeToString(sum[:])
}

// BlacklistToken stores the token (hashed) until it would naturally expire.
func (c *Client) BlacklistToken(ctx context.Context, token string, ttl time.Duration) error {
	if c == nil || c.rdb == nil {
		return nil
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	return c.rdb.Set(ctx, tokenKey(token), "1", ttl).Err()
}

func (c *Client) IsBlacklisted(ctx context.Context, token string) bool {
	if c == nil || c.rdb == nil {
		return false
	}
	n, err := c.rdb.Exists(ctx, tokenKey(token)).Result()
	return err == nil && n > 0
}

// SetTemp stores a short-lived value (e.g. OAuth state).
func (c *Client) SetTemp(ctx context.Context, key, value string, ttl time.Duration) error {
	if c == nil || c.rdb == nil {
		return nil
	}
	return c.rdb.Set(ctx, key, value, ttl).Err()
}

// GetTemp reads a short-lived value without deleting it.
func (c *Client) GetTemp(ctx context.Context, key string) (string, bool) {
	if c == nil || c.rdb == nil {
		return "", false
	}
	v, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		return "", false
	}
	return v, true
}

func (c *Client) DelTemp(ctx context.Context, key string) {
	if c == nil || c.rdb == nil {
		return
	}
	c.rdb.Del(ctx, key)
}

// GetDelTemp reads and deletes a short-lived value atomically.
func (c *Client) GetDelTemp(ctx context.Context, key string) (string, bool) {
	if c == nil || c.rdb == nil {
		return "", false
	}
	v, err := c.rdb.GetDel(ctx, key).Result()
	if err != nil {
		return "", false
	}
	return v, true
}

func (c *Client) Close() error {
	if c == nil || c.rdb == nil {
		return nil
	}
	return c.rdb.Close()
}
