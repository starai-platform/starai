package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
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
	"github.com/starai/api/internal/middleware"
	"github.com/starai/api/internal/queue"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
	"github.com/starai/api/internal/storage"
)

func main() {
	_ = godotenv.Load("../../.env.local", "../../.env", ".env.local", ".env")
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
	modelSvc := service.NewModelService(pool, cfg.ModelRouteCipherKey)
	contentI18nSvc := service.NewContentI18nService(pool)
	rtClient := runtime.NewClient(cfg.NewAPIBaseURL, cfg.NewAPIToken, cfg.NewAPITimeoutSec, cfg.NewAPIStreamTimeoutSec)
	opsSvc := service.NewOpsService(pool, billingSvc, cfg.AdminJWT)
	chatSvc := service.NewChatService(pool, modelSvc, billingSvc, rtClient, opsSvc)
	taskSvc := service.NewTaskService(pool, modelSvc, billingSvc, qClient, opsSvc)
	worksSvc := service.NewWorksService(pool)
	adminSvc := service.NewAdminService(pool, billingSvc, cfg.AdminJWT)
	paymentSvc := service.NewPaymentService(pool, billingSvc)
	gallerySvc := service.NewGalleryService(pool)
	homeSvc := service.NewHomeService(pool)
	presetSvc := service.NewPresetService(pool)
	assetSvc := service.NewAssetService(pool)
	canvasSvc := service.NewCanvasService(pool)
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
	agentSvc := service.NewAgentService(pool, billingSvc, qClient, storageClient)
	startBillingReconciler(ctx, opsSvc, billingSvc, agentSvc)
	if count, syncErr := contentI18nSvc.SyncCatalog(ctx, modelSvc, agentSvc); syncErr != nil {
		log.Printf("warning: dynamic content translation catalog sync failed: %v", syncErr)
	} else {
		log.Printf("dynamic content translation catalog synced: %d entities", count)
	}

	h := handler.New(cfg, authSvc, walletSvc, modelSvc, chatSvc, taskSvc, worksSvc, adminSvc, billingSvc, paymentSvc, opsSvc, gallerySvc, agentSvc, cacheClient, storageClient, homeSvc, presetSvc, assetSvc, roleTplSvc, oauthSvc, captchaSvc, emailOTPSvc, contentI18nSvc, canvasSvc)

	r := gin.New()
	trustedProxies := []string{}
	for _, proxy := range strings.Split(cfg.TrustedProxies, ",") {
		if proxy = strings.TrimSpace(proxy); proxy != "" {
			trustedProxies = append(trustedProxies, proxy)
		}
	}
	if err := r.SetTrustedProxies(trustedProxies); err != nil {
		log.Fatalf("trusted proxies: %v", err)
	}
	r.Use(gin.Recovery())
	r.Use(middleware.RequestID(), middleware.RequestLog(), middleware.Metrics())
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Locale", "Accept-Language", "X-API-Key", "Anthropic-Version", "X-Goog-Api-Key"},
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
		r.Use(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/uploads-local/") {
				c.Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
			}
			c.Next()
		})
		r.Static("/uploads-local", localRoot)
	}
	h.RegisterRoutes(r)
	h.StartContentTranslationBackfill()

	port := cfg.APIPort
	if port == "" {
		port = "8080"
	}
	log.Printf("StarAI API listening on :%s", port)
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if err := server.ListenAndServe(); err != nil {
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

func startBillingReconciler(ctx context.Context, opsSvc *service.OpsService, billingSvc *billing.Service, agentSvc *service.AgentService) {
	run := func() {
		result, err := opsSvc.ReconcileFrozenBalances(ctx)
		if err != nil {
			log.Printf("billing reconciliation failed: %v", err)
		} else if result.ReleasedChatFreezes+result.FailedTasks+result.FailedWorkflows+result.FailedStuckWorkflows+result.FailedOrphanedTasks+result.FailedOrphanedWorkflows+result.SettledTerminalFreezes > 0 {
			log.Printf("billing reconciliation released chats=%d failed tasks=%d failed workflows=%d failed stuck workflows=%d failed orphaned tasks=%d failed orphaned workflows=%d settled terminal freezes=%d", result.ReleasedChatFreezes, result.FailedTasks, result.FailedWorkflows, result.FailedStuckWorkflows, result.FailedOrphanedTasks, result.FailedOrphanedWorkflows, result.SettledTerminalFreezes)
		}
		if completed, completeErr := agentSvc.AutoCompleteExpiredProductReviews(ctx, 100); completeErr != nil {
			log.Printf("product review auto-completion failed: %v", completeErr)
		} else if completed > 0 {
			log.Printf("product review auto-completion queued=%d", completed)
		}
		if rewarded, rewardErr := billingSvc.ReconcileReferralRewards(ctx, 100); rewardErr != nil {
			log.Printf("referral reward reconciliation failed: %v", rewardErr)
		} else if rewarded > 0 {
			log.Printf("referral reward reconciliation processed=%d", rewarded)
		}
		if mismatches, auditErr := billingSvc.CountLedgerMismatches(ctx); auditErr != nil {
			log.Printf("wallet ledger audit failed: %v", auditErr)
		} else if mismatches > 0 {
			log.Printf("warning: wallet ledger mismatches=%d", mismatches)
		}
	}
	go func() {
		run()
		ticker := time.NewTicker(5 * time.Minute)
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
