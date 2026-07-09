package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/middleware"
	"github.com/starai/api/internal/util"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrUserExists = errors.New("user already exists")

type AuthService struct {
	db        *pgxpool.Pool
	billing   *billing.Service
	jwtSecret string
}

func NewAuthService(db *pgxpool.Pool, billing *billing.Service, jwtSecret string) *AuthService {
	return &AuthService{db: db, billing: billing, jwtSecret: jwtSecret}
}

type AuthResult struct {
	Token string      `json:"token"`
	User  UserProfile `json:"user"`
}

type UserProfile struct {
	PublicID       string  `json:"public_id"`
	Email          string  `json:"email,omitempty"`
	AuthProvider   string  `json:"auth_provider,omitempty"`
	Nickname       string  `json:"nickname"`
	Avatar         *string `json:"avatar_url,omitempty"`
	Level          string  `json:"user_level"`
	MemberLevelID  int64   `json:"member_level_id,omitempty"`
	MemberLevel    string  `json:"member_level,omitempty"`
	ReferralCode   string  `json:"referral_code,omitempty"`
	ReferrerID     *int64  `json:"referrer_id,omitempty"`
	ReferrerPublic *string `json:"referrer_public_id,omitempty"`
	Locale         string  `json:"locale"`
}

func (s *AuthService) Register(ctx context.Context, email, password, nickname, referralCode string) (*AuthResult, error) {
	var exists int
	err := s.db.QueryRow(ctx, `SELECT 1 FROM auth_identities WHERE provider='email' AND identifier=$1`, email).Scan(&exists)
	if err == nil {
		return nil, ErrUserExists
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	if nickname == "" {
		nickname = email
	}
	publicID := util.NewPublicID("usr")
	referral, err := s.NewReferralCode(ctx)
	if err != nil {
		return nil, err
	}
	referrerID, err := s.ResolveReferrer(ctx, referralCode)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var userID, memberLevelID int64
	err = tx.QueryRow(ctx,
		`INSERT INTO users (public_id, nickname, referral_code, referrer_id, member_level_id, user_level)
		 VALUES ($1,$2,$3,$4,(SELECT id FROM member_levels WHERE is_default=true LIMIT 1),'normal') RETURNING id, member_level_id`,
		publicID, nickname, referral, referrerID,
	).Scan(&userID, &memberLevelID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO auth_identities (user_id, provider, identifier, credential_hash, verified) VALUES ($1,'email',$2,$3,true)`,
		userID, email, string(hash))
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wallets (user_id) VALUES ($1)`, userID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.GrantSignupBonus(ctx, userID)
	return s.issueToken(userID, publicID, nickname, nil, "normal", "普通会员", memberLevelID, referral, referrerID, nil, "zh-CN")
}

// GrantSignupBonus credits the configured signup bonus (system_configs.signup_bonus) to a new user.
func (s *AuthService) GrantSignupBonus(ctx context.Context, userID int64) {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='signup_bonus'`).Scan(&raw); err != nil {
		return
	}
	var bonus float64
	if json.Unmarshal(raw, &bonus) != nil || bonus <= 0 {
		return
	}
	s.billing.Credit(ctx, userID, bonus, "signup_bonus", "user", fmt.Sprintf("%d", userID), "注册赠送算力")
}

func (s *AuthService) LoginPassword(ctx context.Context, email, password string) (*AuthResult, error) {
	var userID int64
	var publicID, nickname, level, memberLevel, referralCode, locale string
	var memberLevelID int64
	var referrerID *int64
	var referrerPublic *string
	var avatar *string
	var hashPtr *string
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.user_level,
		       COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id,
		       u.locale, a.credential_hash
		FROM auth_identities a JOIN users u ON u.id = a.user_id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE a.provider='email' AND a.identifier=$1 AND u.status='active'`, email,
	).Scan(&userID, &publicID, &nickname, &avatar, &level, &memberLevelID, &memberLevel, &referralCode, &referrerID, &referrerPublic, &locale, &hashPtr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if hashPtr == nil || *hashPtr == "" {
		return nil, errors.New("该账号尚未设置密码，请使用邮箱验证码登录")
	}
	hash := *hashPtr
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return s.issueToken(userID, publicID, nickname, avatar, level, memberLevel, memberLevelID, referralCode, referrerID, referrerPublic, locale)
}

func (s *AuthService) issueToken(userID int64, publicID, nickname string, avatar *string, level, memberLevel string, memberLevelID int64, referralCode string, referrerID *int64, referrerPublic *string, locale string) (*AuthResult, error) {
	claims := middleware.UserClaims{
		UserID:   userID,
		PublicID: publicID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return nil, err
	}
	return &AuthResult{
		Token: signed,
		User: UserProfile{
			PublicID:       publicID,
			Nickname:       nickname,
			Avatar:         avatar,
			Level:          level,
			MemberLevelID:  memberLevelID,
			MemberLevel:    memberLevel,
			ReferralCode:   referralCode,
			ReferrerID:     referrerID,
			ReferrerPublic: referrerPublic,
			Locale:         locale,
		},
	}, nil
}

func (s *AuthService) NewReferralCode(ctx context.Context) (string, error) {
	const (
		minCode     = 100000
		codeSpan    = 900000
		maxAttempts = 20
	)
	for i := 0; i < maxAttempts; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(codeSpan))
		if err != nil {
			return "", err
		}
		code := fmt.Sprintf("%06d", n.Int64()+minCode)
		var exists int
		err = s.db.QueryRow(ctx, `SELECT 1 FROM users WHERE referral_code=$1`, code).Scan(&exists)
		if errors.Is(err, pgx.ErrNoRows) {
			return code, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("生成随机推荐码失败，请重试")
}

func (s *AuthService) ResolveReferrer(ctx context.Context, referralCode string) (*int64, error) {
	code := strings.TrimSpace(referralCode)
	if code == "" {
		return nil, nil
	}
	var id int64
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code=$1 AND status='active'`, code).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("推荐码无效")
		}
		return nil, err
	}
	return &id, nil
}

type UpdateProfileInput struct {
	Nickname *string `json:"nickname"`
	Avatar   *string `json:"avatar_url"`
	Locale   *string `json:"locale"`
}

func (s *AuthService) UpdateProfile(ctx context.Context, userID int64, input UpdateProfileInput) (*UserProfile, error) {
	if input.Nickname != nil {
		s.db.Exec(ctx, `UPDATE users SET nickname=$1, updated_at=now() WHERE id=$2`, *input.Nickname, userID)
	}
	if input.Avatar != nil {
		s.db.Exec(ctx, `UPDATE users SET avatar_url=$1, updated_at=now() WHERE id=$2`, *input.Avatar, userID)
	}
	if input.Locale != nil {
		s.db.Exec(ctx, `UPDATE users SET locale=$1, updated_at=now() WHERE id=$2`, *input.Locale, userID)
	}
	return s.GetMe(ctx, userID)
}

func (s *AuthService) ChangePassword(ctx context.Context, userID int64, oldPassword, newPassword string) error {
	if len(newPassword) < 6 {
		return errors.New("新密码至少 6 位")
	}
	var hash string
	err := s.db.QueryRow(ctx,
		`SELECT credential_hash FROM auth_identities WHERE user_id=$1 AND provider='email'`, userID,
	).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("该账号未设置密码")
		}
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(oldPassword)) != nil {
		return errors.New("原密码错误")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 10)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx,
		`UPDATE auth_identities SET credential_hash=$1 WHERE user_id=$2 AND provider='email'`,
		string(newHash), userID)
	return err
}

func (s *AuthService) GetMe(ctx context.Context, userID int64) (*UserProfile, error) {
	var p UserProfile
	var avatar *string
	err := s.db.QueryRow(ctx,
		`SELECT u.public_id, u.nickname, u.avatar_url, u.user_level,
		        COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id, u.locale
		 FROM users u
		 LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		 LEFT JOIN users ru ON ru.id = u.referrer_id
		 WHERE u.id=$1`, userID,
	).Scan(&p.PublicID, &p.Nickname, &avatar, &p.Level, &p.MemberLevelID, &p.MemberLevel, &p.ReferralCode, &p.ReferrerID, &p.ReferrerPublic, &p.Locale)
	if err != nil {
		return nil, err
	}
	p.Avatar = avatar

	rows, err := s.db.Query(ctx, `SELECT provider, identifier FROM auth_identities WHERE user_id=$1 ORDER BY provider`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := map[string]bool{}
	for rows.Next() {
		var provider, identifier string
		if err := rows.Scan(&provider, &identifier); err != nil {
			return nil, err
		}
		providers[provider] = true
		if provider == "email" && p.Email == "" {
			p.Email = identifier
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	switch {
	case providers["google"]:
		p.AuthProvider = "google"
	case providers["github"]:
		p.AuthProvider = "github"
	default:
		p.AuthProvider = "email"
	}
	return &p, nil
}

type AdminAuthResult struct {
	Token string `json:"token"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *AuthService) AdminLogin(ctx context.Context, email, password, adminJWT string) (*AdminAuthResult, error) {
	var adminID, roleID int64
	var hash, roleName string
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.password_hash, a.role_id, r.name
		FROM admin_users a JOIN admin_roles r ON r.id = a.role_id
		WHERE a.email=$1 AND a.status='active'`, email,
	).Scan(&adminID, &hash, &roleID, &roleName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	claims := middleware.AdminClaims{
		AdminID: adminID,
		Email:   email,
		Role:    roleName,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(adminJWT))
	if err != nil {
		return nil, err
	}
	return &AdminAuthResult{Token: signed, Email: email, Role: roleName}, nil
}
