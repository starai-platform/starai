package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/starai/api/internal/cache"
	"github.com/starai/api/internal/mailer"
	"github.com/starai/api/internal/util"
	"golang.org/x/crypto/bcrypt"
)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type EmailOTPService struct {
	auth    *AuthService
	captcha *CaptchaService
	cache   *cache.Client
	mailer  *mailer.Service
}

func NewEmailOTPService(auth *AuthService, captcha *CaptchaService, cacheClient *cache.Client, mailerSvc *mailer.Service) *EmailOTPService {
	return &EmailOTPService{auth: auth, captcha: captcha, cache: cacheClient, mailer: mailerSvc}
}

type SendEmailCodeResult struct {
	Sent      bool   `json:"sent"`
	DebugCode string `json:"debug_code,omitempty"`
	Message   string `json:"message"`
}

func (s *EmailOTPService) SendCode(ctx context.Context, email, captchaID, captchaCode string, captchaRequired bool) (*SendEmailCodeResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if !emailRe.MatchString(email) {
		return nil, errors.New("邮箱格式不正确")
	}
	if captchaRequired && !s.captcha.Verify(ctx, captchaID, captchaCode) {
		return nil, errors.New("图形验证码错误或已过期")
	}
	// Rate limit: 60s between sends per email.
	if v, ok := s.cache.GetTemp(ctx, "email_otp_cooldown:"+email); ok && v != "" {
		return nil, errors.New("发送过于频繁，请稍后再试")
	}
	code := randomDigits(6)
	if err := s.cache.SetTemp(ctx, "email_otp:"+email, code, 10*time.Minute); err != nil {
		return nil, err
	}
	_ = s.cache.SetTemp(ctx, "email_otp_cooldown:"+email, "1", 60*time.Second)

	mailCfg := s.mailer.LoadConfig(ctx)
	debug := s.mailer.IsDebugOTP(ctx) || os.Getenv("EMAIL_OTP_DEBUG") == "true" || os.Getenv("APP_ENV") == "development"
	res := &SendEmailCodeResult{Sent: true, Message: "验证码已发送，请查收邮箱"}

	if mailCfg.Enabled {
		siteName := s.siteName(ctx)
		subject := fmt.Sprintf("%s 登录验证码", siteName)
		body := fmt.Sprintf("您好！\n\n您的登录验证码是：%s\n有效期 10 分钟，请勿泄露给他人。\n\n— %s", code, siteName)
		if err := s.mailer.Send(ctx, mailCfg, email, subject, body); err != nil {
			log.Printf("[email_otp] mail send failed provider=%s to=%s err=%v", mailCfg.Provider, email, err)
			if !debug {
				return nil, fmt.Errorf("邮件发送失败：%v", err)
			}
		}
	} else if !debug {
		return nil, errors.New("邮件服务未启用，请在后台「系统配置」中配置 SMTP 或 Resend，或开启「验证码调试模式」")
	}

	log.Printf("[email_otp] to=%s code=%s provider=%s enabled=%v debug=%v", email, code, mailCfg.Provider, mailCfg.Enabled, debug)
	if debug {
		res.DebugCode = code
		if !mailCfg.Enabled {
			res.Message = "验证码已生成（调试模式，邮件服务未启用）"
		}
	}
	return res, nil
}

func (s *EmailOTPService) siteName(ctx context.Context) string {
	var raw []byte
	if err := s.auth.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='site_name'`).Scan(&raw); err != nil {
		return "StarAI"
	}
	var name string
	if json.Unmarshal(raw, &name) != nil || name == "" {
		return "StarAI"
	}
	return name
}

type EmailVerifyResult struct {
	AuthResult
	NeedsSetPassword bool `json:"needs_set_password"`
	IsNewUser        bool `json:"is_new_user"`
}

func (s *EmailOTPService) VerifyAndLogin(ctx context.Context, email, code, referralCode string) (*EmailVerifyResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	code = strings.TrimSpace(code)
	if !emailRe.MatchString(email) || len(code) != 6 {
		return nil, errors.New("邮箱或验证码格式不正确")
	}
	stored, ok := s.cache.GetTemp(ctx, "email_otp:"+email)
	if !ok || stored != code {
		return nil, errors.New("验证码错误或已过期")
	}
	s.cache.DelTemp(ctx, "email_otp:"+email)

	var userID int64
	var publicID, nickname, level, memberLevel, userReferralCode, locale, status string
	var memberLevelID int64
	var referrerID *int64
	var referrerPublic *string
	var avatar *string
	var hash *string
	err := s.auth.db.QueryRow(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.user_level,
		       COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.public_id,
		       u.locale, u.status, a.credential_hash
		FROM auth_identities a JOIN users u ON u.id = a.user_id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE a.provider='email' AND a.identifier=$1`, email,
	).Scan(&userID, &publicID, &nickname, &avatar, &level, &memberLevelID, &memberLevel, &userReferralCode, &referrerID, &referrerPublic, &locale, &status, &hash)
	if err == nil {
		if status != "active" {
			return nil, errors.New("账号已被冻结或封禁")
		}
		auth, err := s.auth.issueToken(userID, publicID, nickname, avatar, level, memberLevel, memberLevelID, userReferralCode, referrerID, referrerPublic, locale)
		if err != nil {
			return nil, err
		}
		needsPwd := hash == nil || *hash == ""
		return &EmailVerifyResult{AuthResult: *auth, NeedsSetPassword: needsPwd, IsNewUser: false}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// First-time email login = auto register with random nickname + avatar.
	nickname, avatarURL := randomUserProfile()
	publicID = util.NewPublicID("usr")
	userReferralCode, err = s.auth.NewReferralCode(ctx)
	if err != nil {
		return nil, err
	}
	referrerID, err = s.auth.ResolveReferrer(ctx, referralCode)
	if err != nil {
		return nil, err
	}
	tx, err := s.auth.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx,
		`INSERT INTO users (public_id, nickname, avatar_url, referral_code, referrer_id, member_level_id, user_level)
		 VALUES ($1,$2,$3,$4,$5,(SELECT id FROM member_levels WHERE is_default=true LIMIT 1),'normal') RETURNING id, member_level_id`,
		publicID, nickname, avatarURL, userReferralCode, referrerID,
	).Scan(&userID, &memberLevelID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO auth_identities (user_id, provider, identifier, verified) VALUES ($1,'email',$2,true)`,
		userID, email)
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
	s.auth.GrantSignupBonus(ctx, userID)
	auth, err := s.auth.issueToken(userID, publicID, nickname, &avatarURL, "normal", "普通会员", memberLevelID, userReferralCode, referrerID, nil, "zh-CN")
	if err != nil {
		return nil, err
	}
	return &EmailVerifyResult{AuthResult: *auth, NeedsSetPassword: true, IsNewUser: true}, nil
}

func randomDigits(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		d, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteString(fmt.Sprintf("%d", d.Int64()))
	}
	return b.String()
}

var nickAdjs = []string{"星光", "晨曦", "云端", "灵感", "智慧", "幻想", "量子", "星云", "极光", "流星"}
var nickNouns = []string{"旅人", "探索者", "创作者", "梦想家", "行者", "玩家", "访客", "旅者"}

func randomUserProfile() (nickname, avatarURL string) {
	a, _ := rand.Int(rand.Reader, big.NewInt(int64(len(nickAdjs))))
	n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(nickNouns))))
	suffix, _ := rand.Int(rand.Reader, big.NewInt(10000))
	seed, _ := rand.Int(rand.Reader, big.NewInt(1<<31))
	nickname = fmt.Sprintf("%s%s%04d", nickAdjs[a.Int64()], nickNouns[n.Int64()], suffix.Int64())
	avatarURL = fmt.Sprintf("https://api.dicebear.com/7.x/avataaars/svg?seed=%d", seed.Int64())
	return nickname, avatarURL
}

// SetInitialPassword sets password for OTP-only accounts (no old password required).
func (s *AuthService) SetInitialPassword(ctx context.Context, userID int64, password string) error {
	if len(password) < 6 {
		return errors.New("密码至少 6 位")
	}
	var hash *string
	err := s.db.QueryRow(ctx,
		`SELECT credential_hash FROM auth_identities WHERE user_id=$1 AND provider='email'`, userID,
	).Scan(&hash)
	if err != nil {
		return errors.New("该账号未绑定邮箱")
	}
	if hash != nil && *hash != "" {
		return errors.New("密码已设置，请使用修改密码功能")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return err
	}
	h := string(newHash)
	_, err = s.db.Exec(ctx,
		`UPDATE auth_identities SET credential_hash=$1 WHERE user_id=$2 AND provider='email'`,
		h, userID)
	return err
}
