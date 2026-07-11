package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestExtractTokenUsesHeaderOrCookieButNotQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name   string
		header string
		cookie string
		query  string
		want   string
	}{
		{name: "bearer", header: "Bearer header-token", want: "header-token"},
		{name: "cookie", cookie: "cookie-token", want: "cookie-token"},
		{name: "header wins", header: "Bearer header-token", cookie: "cookie-token", want: "header-token"},
		{name: "query rejected", query: "?token=query-token", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			req := httptest.NewRequest(http.MethodGet, "/"+tt.query, nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			if tt.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "starai_session", Value: tt.cookie})
			}
			c.Request = req
			if got := extractToken(c, "starai_session"); got != tt.want {
				t.Fatalf("token=%q, want %q", got, tt.want)
			}
		})
	}
}

func TestRequireAdminRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name string
		role string
		want int
	}{
		{name: "super admin allowed", role: "super_admin", want: http.StatusNoContent},
		{name: "operator forbidden", role: "operator", want: http.StatusForbidden},
		{name: "missing role forbidden", role: "", want: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			r.GET("/", func(c *gin.Context) {
				if tt.role != "" {
					c.Set("admin_role", tt.role)
				}
				c.Next()
			}, RequireAdminRole("super_admin"), func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
			if w.Code != tt.want {
				t.Fatalf("status=%d, want %d", w.Code, tt.want)
			}
		})
	}
}
