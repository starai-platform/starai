package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/cache"
	"github.com/starai/api/internal/util"
)

// OAuthService implements Google / GitHub one-click login.
// Provider credentials are configured in system_configs by admins.
type OAuthService struct {
	db      *pgxpool.Pool
	billing *billing.Service
	auth    *AuthService
	cache   *cache.Client
	http    *http.Client
}

func NewOAuthService(db *pgxpool.Pool, billingSvc *billing.Service, auth *AuthService, cacheClient *cache.Client) *OAuthService {
	return &OAuthService{
		db:      db,
		billing: billingSvc,
		auth:    auth,
		cache:   cacheClient,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

type oauthProviderConfig struct {
	Enabled      bool
	ClientID     string
	ClientSecret string
}

type oauthIdentity struct {
	ID     string
	Email  string
	Name   string
	Avatar string
}

func (s *OAuthService) configValue(ctx context.Context, key string, out interface{}) bool {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key=$1`, key).Scan(&raw); err != nil {
		return false
	}
	return json.Unmarshal(raw, out) == nil
}

func (s *OAuthService) configString(ctx context.Context, key string) string {
	var v string
	s.configValue(ctx, key, &v)
	return v
}

func (s *OAuthService) configBool(ctx context.Context, key string) bool {
	var v bool
	s.configValue(ctx, key, &v)
	return v
}

func (s *OAuthService) providerConfig(ctx context.Context, provider string) (*oauthProviderConfig, error) {
	if provider != "google" && provider != "github" {
		return nil, errors.New("不支持的登录方式")
	}
	cfg := &oauthProviderConfig{
		Enabled:      s.configBool(ctx, "oauth_"+provider+"_enabled"),
		ClientID:     strings.TrimSpace(s.configString(ctx, "oauth_"+provider+"_client_id")),
		ClientSecret: strings.TrimSpace(s.configString(ctx, "oauth_"+provider+"_client_secret")),
	}
	if !cfg.Enabled || cfg.ClientID == "" || cfg.ClientSecret == "" {
		return nil, errors.New("该登录方式未启用")
	}
	return cfg, nil
}

// EnabledProviders reports which one-click providers are usable.
func (s *OAuthService) EnabledProviders(ctx context.Context) map[string]bool {
	out := map[string]bool{}
	for _, p := range []string{"google", "github"} {
		_, err := s.providerConfig(ctx, p)
		out[p] = err == nil
	}
	return out
}

// SiteBaseURL returns the public web frontend URL for post-login redirects.
func (s *OAuthService) SiteBaseURL(ctx context.Context) string {
	v := strings.TrimRight(strings.TrimSpace(s.configString(ctx, "site_base_url")), "/")
	if v == "" {
		v = "http://localhost:3000"
	}
	return v
}

// AuthorizeURL builds the provider authorize URL and stores a CSRF state in Redis.
func (s *OAuthService) AuthorizeURL(ctx context.Context, provider, redirectURI, referralCode string) (string, error) {
	cfg, err := s.providerConfig(ctx, provider)
	if err != nil {
		return "", err
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	state := hex.EncodeToString(buf)
	stateValue := provider + "|" + strings.TrimSpace(referralCode)
	if err := s.cache.SetTemp(ctx, "oauth:state:"+state, stateValue, 10*time.Minute); err != nil {
		return "", err
	}

	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	switch provider {
	case "google":
		q.Set("response_type", "code")
		q.Set("scope", "openid email profile")
		return "https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode(), nil
	default: // github
		q.Set("scope", "read:user user:email")
		return "https://github.com/login/oauth/authorize?" + q.Encode(), nil
	}
}

// HandleCallback exchanges the code, finds or creates the user and issues a JWT.
func (s *OAuthService) HandleCallback(ctx context.Context, provider, code, state, redirectURI string) (*AuthResult, error) {
	if code == "" || state == "" {
		return nil, errors.New("授权参数缺失")
	}
	stored, ok := s.cache.GetDelTemp(ctx, "oauth:state:"+state)
	parts := strings.SplitN(stored, "|", 2)
	storedProvider := ""
	referralCode := ""
	if len(parts) > 0 {
		storedProvider = parts[0]
	}
	if len(parts) > 1 {
		referralCode = parts[1]
	}
	if !ok || storedProvider != provider {
		return nil, errors.New("授权状态已失效，请重新登录")
	}
	cfg, err := s.providerConfig(ctx, provider)
	if err != nil {
		return nil, err
	}

	var ident *oauthIdentity
	switch provider {
	case "google":
		ident, err = s.fetchGoogleIdentity(ctx, cfg, code, redirectURI)
	default:
		ident, err = s.fetchGithubIdentity(ctx, cfg, code, redirectURI)
	}
	if err != nil {
		return nil, err
	}
	return s.loginOrRegister(ctx, provider, ident, referralCode)
}

func (s *OAuthService) loginOrRegister(ctx context.Context, provider string, ident *oauthIdentity, referralCode string) (*AuthResult, error) {
	var userID int64
	var publicID, nickname, level, memberLevel, userReferralCode, locale, status string
	var memberLevelID int64
	var referrerID *int64
	var referrerPublic *string
	var avatar *string
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.user_level,
		       COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id,
		       u.locale, u.status
		FROM auth_identities a JOIN users u ON u.id = a.user_id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE a.provider=$1 AND a.identifier=$2`, provider, ident.ID,
	).Scan(&userID, &publicID, &nickname, &avatar, &level, &memberLevelID, &memberLevel, &userReferralCode, &referrerID, &referrerPublic, &locale, &status)
	if err == nil {
		if status != "active" {
			return nil, errors.New("账号已被冻结或封禁")
		}
		return s.auth.issueToken(userID, publicID, nickname, avatar, level, memberLevel, memberLevelID, userReferralCode, referrerID, referrerPublic, locale)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// First login with this provider account: create user + wallet.
	nickname = ident.Name
	if nickname == "" {
		nickname = ident.Email
	}
	if nickname == "" {
		nickname = provider + "_" + ident.ID
	}
	publicID = util.NewPublicID("usr")
	userReferralCode, err = s.auth.NewReferralCode(ctx)
	if err != nil {
		return nil, err
	}
	referrerID, err = s.auth.ResolveReferrer(ctx, referralCode)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var avatarVal *string
	if ident.Avatar != "" {
		avatarVal = &ident.Avatar
	}
	err = tx.QueryRow(ctx,
		`INSERT INTO users (public_id, nickname, avatar_url, referral_code, referrer_id, member_level_id, user_level)
		 VALUES ($1,$2,$3,$4,$5,(SELECT id FROM member_levels WHERE is_default=true LIMIT 1),'normal') RETURNING id, member_level_id`,
		publicID, nickname, avatarVal, userReferralCode, referrerID,
	).Scan(&userID, &memberLevelID)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx,
		`INSERT INTO auth_identities (user_id, provider, identifier, verified) VALUES ($1,$2,$3,true)`,
		userID, provider, ident.ID); err != nil {
		return nil, err
	}
	// Also bind email identity for display/dedup when provider returns one and it is unclaimed.
	if ident.Email != "" {
		var taken int
		if e := s.db.QueryRow(ctx, `SELECT 1 FROM auth_identities WHERE provider='email' AND identifier=$1`, ident.Email).Scan(&taken); errors.Is(e, pgx.ErrNoRows) {
			if _, err = tx.Exec(ctx,
				`INSERT INTO auth_identities (user_id, provider, identifier, verified) VALUES ($1,'email',$2,true)`,
				userID, ident.Email); err != nil {
				return nil, err
			}
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wallets (user_id) VALUES ($1)`, userID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.auth.GrantSignupBonus(ctx, userID)
	return s.auth.issueToken(userID, publicID, nickname, avatarVal, "normal", "普通会员", memberLevelID, userReferralCode, referrerID, nil, "zh-CN")
}

func (s *OAuthService) fetchGoogleIdentity(ctx context.Context, cfg *oauthProviderConfig, code, redirectURI string) (*oauthIdentity, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := s.postForm(ctx, "https://oauth2.googleapis.com/token", form, nil, &tokenResp); err != nil {
		return nil, fmt.Errorf("google 换取令牌失败: %w", err)
	}
	if tokenResp.AccessToken == "" {
		return nil, errors.New("google 未返回访问令牌")
	}

	var info struct {
		Sub     string `json:"sub"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := s.getJSON(ctx, "https://www.googleapis.com/oauth2/v3/userinfo", tokenResp.AccessToken, &info); err != nil {
		return nil, fmt.Errorf("google 获取用户信息失败: %w", err)
	}
	if info.Sub == "" {
		return nil, errors.New("google 用户信息无效")
	}
	return &oauthIdentity{ID: info.Sub, Email: info.Email, Name: info.Name, Avatar: info.Picture}, nil
}

func (s *OAuthService) fetchGithubIdentity(ctx context.Context, cfg *oauthProviderConfig, code, redirectURI string) (*oauthIdentity, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("redirect_uri", redirectURI)

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	headers := map[string]string{"Accept": "application/json"}
	if err := s.postForm(ctx, "https://github.com/login/oauth/access_token", form, headers, &tokenResp); err != nil {
		return nil, fmt.Errorf("github 换取令牌失败: %w", err)
	}
	if tokenResp.AccessToken == "" {
		return nil, errors.New("github 未返回访问令牌")
	}

	var user struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		Email     string `json:"email"`
	}
	if err := s.getJSON(ctx, "https://api.github.com/user", tokenResp.AccessToken, &user); err != nil {
		return nil, fmt.Errorf("github 获取用户信息失败: %w", err)
	}
	if user.ID == 0 {
		return nil, errors.New("github 用户信息无效")
	}
	email := user.Email
	if email == "" {
		var emails []struct {
			Email    string `json:"email"`
			Primary  bool   `json:"primary"`
			Verified bool   `json:"verified"`
		}
		if err := s.getJSON(ctx, "https://api.github.com/user/emails", tokenResp.AccessToken, &emails); err == nil {
			for _, e := range emails {
				if e.Primary && e.Verified {
					email = e.Email
					break
				}
			}
		}
	}
	name := user.Name
	if name == "" {
		name = user.Login
	}
	return &oauthIdentity{ID: fmt.Sprintf("%d", user.ID), Email: email, Name: name, Avatar: user.AvatarURL}, nil
}

func (s *OAuthService) postForm(ctx context.Context, endpoint string, form url.Values, headers map[string]string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return s.doJSON(req, out)
}

func (s *OAuthService) getJSON(ctx context.Context, endpoint, accessToken string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	return s.doJSON(req, out)
}

func (s *OAuthService) doJSON(req *http.Request, out interface{}) error {
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	return json.Unmarshal(body, out)
}
