package middleware

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/starai/api/internal/util"
)

// TokenBlacklist checks whether a token has been revoked (e.g. via logout).
type TokenBlacklist interface {
	IsBlacklisted(ctx context.Context, token string) bool
}

type UserClaims struct {
	UserID   int64  `json:"user_id"`
	PublicID string `json:"public_id"`
	jwt.RegisteredClaims
}

type AdminClaims struct {
	AdminID int64  `json:"admin_id"`
	Email   string `json:"email"`
	Role    string `json:"role"`
	jwt.RegisteredClaims
}

func UserAuth(secret string, blacklist TokenBlacklist) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			util.Unauthorized(c, "未登录")
			c.Abort()
			return
		}
		if blacklist != nil && blacklist.IsBlacklisted(c.Request.Context(), token) {
			util.Unauthorized(c, "登录已失效")
			c.Abort()
			return
		}
		claims := &UserClaims{}
		parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !parsed.Valid {
			util.Unauthorized(c, "登录已过期")
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("public_id", claims.PublicID)
		c.Next()
	}
}

func AdminAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			util.Unauthorized(c, "未登录")
			c.Abort()
			return
		}
		claims := &AdminClaims{}
		parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !parsed.Valid {
			util.Unauthorized(c, "登录已过期")
			c.Abort()
			return
		}
		c.Set("admin_id", claims.AdminID)
		c.Set("admin_email", claims.Email)
		c.Set("admin_role", claims.Role)
		c.Next()
	}
}

func extractToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return c.Query("token")
}
