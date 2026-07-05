package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/cache"
	"github.com/starai/api/internal/config"
	"github.com/starai/api/internal/db"
	"github.com/starai/api/internal/handler"
	"github.com/starai/api/internal/mailer"
	"github.com/starai/api/internal/queue"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
	"github.com/starai/api/internal/storage"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	qClient, err := queue.NewClient(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer qClient.Close()

	cacheClient, err := cache.New(cfg.RedisURL)
	if err != nil {
		log.Fatalf("cache: %v", err)
	}
	defer cacheClient.Close()

	billingSvc := billing.New(pool)
	authSvc := service.NewAuthService(pool, billingSvc, cfg.JWTSecret)
	walletSvc := service.NewWalletService(pool, billingSvc)
	modelSvc := service.NewModelService(pool)
	rtClient := runtime.NewClient(cfg.NewAPIBaseURL, cfg.NewAPIToken, cfg.NewAPITimeoutSec, cfg.NewAPIStreamTimeoutSec)
	opsSvc := service.NewOpsService(pool, billingSvc, cfg.AdminJWT)
	chatSvc := service.NewChatService(pool, modelSvc, billingSvc, rtClient, opsSvc)
	taskSvc := service.NewTaskService(pool, modelSvc, billingSvc, qClient, opsSvc)
	worksSvc := service.NewWorksService(pool)
	adminSvc := service.NewAdminService(pool, billingSvc, cfg.AdminJWT)
	paymentSvc := service.NewPaymentService(pool, billingSvc)
	gallerySvc := service.NewGalleryService(pool)
	agentSvc := service.NewAgentService(pool, billingSvc, qClient)
	homeSvc := service.NewHomeService(pool)
	presetSvc := service.NewPresetService(pool)
	assetSvc := service.NewAssetService(pool)
	roleTplSvc := service.NewRoleTemplateService(pool)
	oauthSvc := service.NewOAuthService(pool, billingSvc, authSvc, cacheClient)
	captchaSvc := service.NewCaptchaService(cacheClient)
	mailerSvc := mailer.New(pool)
	emailOTPSvc := service.NewEmailOTPService(authSvc, captchaSvc, cacheClient, mailerSvc)

	storageCfg := storage.LoadConfig(ctx, pool, storage.Config{
		Provider:  "minio",
		Endpoint:  cfg.MinioEndpoint,
		AccessKey: cfg.MinioAccessKey,
		SecretKey: cfg.MinioSecretKey,
		Bucket:    cfg.MinioBucket,
		PublicURL: cfg.MinioPublicURL,
		UseSSL:    cfg.MinioUseSSL,
	})
	cfg.MinioEndpoint = storageCfg.Endpoint
	cfg.MinioAccessKey = storageCfg.AccessKey
	cfg.MinioSecretKey = storageCfg.SecretKey
	cfg.MinioBucket = storageCfg.Bucket
	cfg.MinioPublicURL = storageCfg.PublicURL
	cfg.MinioUseSSL = storageCfg.UseSSL

	var storageClient storage.Store
	var localRoot string
	localPublicURL, localPublicErr := configuredLocalStoragePublicURL(cfg)
	if storageCfg.Provider == "local" {
		if localPublicErr != nil {
			err = localPublicErr
		} else {
			storageClient, localRoot, err = newLocalStore(localPublicURL)
		}
		if err != nil {
			log.Printf("warning: local storage unavailable, uploads disabled: %v", err)
		}
	} else {
		storageClient, err = storage.New(storageCfg.Endpoint, storageCfg.AccessKey, storageCfg.SecretKey, storageCfg.Bucket, storageCfg.PublicURL, storageCfg.UseSSL)
		if err != nil {
			log.Printf("warning: object storage unavailable, falling back to local uploads: %v", err)
			if localPublicErr != nil {
				err = localPublicErr
			} else {
				storageClient, localRoot, err = newLocalStore(localPublicURL)
			}
			if err != nil {
				log.Printf("warning: local storage unavailable, uploads disabled: %v", err)
				storageClient = nil
			}
		}
	}
	startExpiredWorksCleaner(ctx, worksSvc, storageClient)

	h := handler.New(cfg, authSvc, walletSvc, modelSvc, chatSvc, taskSvc, worksSvc, adminSvc, billingSvc, paymentSvc, opsSvc, gallerySvc, agentSvc, cacheClient, storageClient, homeSvc, presetSvc, assetSvc, roleTplSvc, oauthSvc, captchaSvc, emailOTPSvc)

	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000", "http://localhost:3001"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))
	if localRoot == "" {
		if localPublicErr == nil {
			_, root, err := newLocalStore(localPublicURL)
			if err == nil {
				localRoot = root
			}
		}
	}
	if localRoot != "" {
		r.Static("/uploads-local", localRoot)
	}
	h.RegisterRoutes(r)

	port := cfg.APIPort
	if port == "" {
		port = "8080"
	}
	log.Printf("StarAI API listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

func portBaseURL(port string) string {
	if port == "" {
		port = "8080"
	}
	return "http://localhost:" + port
}

func configuredLocalStoragePublicURL(cfg *config.Config) (string, error) {
	if v := strings.TrimRight(strings.TrimSpace(cfg.LocalStoragePublicURL), "/"); v != "" {
		return v, nil
	}
	if v := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"); v != "" {
		return v + "/uploads-local", nil
	}
	if strings.EqualFold(strings.TrimSpace(cfg.AppEnv), "production") {
		return "", fmt.Errorf("production local storage requires LOCAL_STORAGE_PUBLIC_URL or BASE_URL")
	}
	return portBaseURL(cfg.APIPort) + "/uploads-local", nil
}

func newLocalStore(publicURL string) (storage.Store, string, error) {
	client, err := storage.NewLocal("", publicURL)
	if err != nil {
		return nil, "", err
	}
	return client, client.Root(), nil
}

func startExpiredWorksCleaner(ctx context.Context, worksSvc *service.WorksService, storageClient storage.Store) {
	run := func() {
		n, err := worksSvc.CleanupExpired(ctx, storageClient, 500)
		if err != nil {
			log.Printf("expired works cleanup failed: %v", err)
			return
		}
		if n > 0 {
			log.Printf("expired works cleanup removed %d items", n)
		}
	}
	go func() {
		run()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
