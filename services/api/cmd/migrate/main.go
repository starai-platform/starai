package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	_ = godotenv.Load("../../.env.local", "../../.env", ".env.local", ".env")
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://starai:starai@localhost:5432/starai?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	action := "up"
	if len(os.Args) > 1 {
		action = os.Args[1]
	}

	migrationsDir := findMigrationsDir()
	ensureSchemaMigrations(ctx, pool)
	if action == "up" {
		for _, f := range listMigrations(migrationsDir, ".up.sql", false) {
			name := filepath.Base(f)
			checksum, err := fileChecksum(f)
			if err != nil {
				log.Fatalf("checksum %s: %v", f, err)
			}
			if isApplied(ctx, pool, name, checksum) {
				fmt.Printf("skip %s (already applied)\n", name)
				continue
			}
			if err := applyMigration(pool, f, name, checksum); err != nil {
				log.Fatalf("exec %s: %v", f, err)
			}
			fmt.Printf("applied %s\n", name)
		}
		if err := seedCredentials(pool); err != nil {
			log.Fatalf("seed development credentials: %v", err)
		}
		fmt.Println("Migrations applied successfully")
		return
	}

	// down: rollback applied migrations in reverse order (only those recorded)
	applied, err := listApplied(ctx, pool)
	if err != nil {
		log.Fatal(err)
	}
	for i := len(applied) - 1; i >= 0; i-- {
		upName := applied[i]
		downName := strings.ReplaceAll(upName, ".up.sql", ".down.sql")
		downPath := filepath.Join(migrationsDir, downName)
		if _, err := os.Stat(downPath); err != nil {
			fmt.Printf("skip %s (missing down file)\n", downName)
			unmarkApplied(ctx, pool, upName)
			continue
		}
		if err := rollbackMigration(pool, downPath, upName); err != nil {
			log.Fatalf("exec %s: %v", downPath, err)
		}
		fmt.Printf("rolled back %s\n", downName)
	}
	fmt.Println("Migrations rolled back")
}

func listMigrations(dir, suffix string, reverse bool) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Fatalf("read migrations dir: %v", err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), suffix) {
			continue
		}
		files = append(files, filepath.Join(dir, e.Name()))
	}
	sort.Strings(files)
	if reverse {
		for i, j := 0, len(files)-1; i < j; i, j = i+1, j-1 {
			files[i], files[j] = files[j], files[i]
		}
	}
	return files
}

func findMigrationsDir() string {
	candidates := []string{
		"infra/migrations",
		"../../infra/migrations",
		"../../../infra/migrations",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "infra/migrations"
}

func applyMigration(pool *pgxpool.Pool, path, filename, checksum string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, string(data)); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)`, filename, checksum); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func rollbackMigration(pool *pgxpool.Pool, path, filename string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, string(data)); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM schema_migrations WHERE filename=$1`, filename); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func fileChecksum(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func ensureSchemaMigrations(ctx context.Context, pool *pgxpool.Pool) {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			checksum TEXT,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`)
	if err != nil {
		log.Fatalf("ensure schema_migrations: %v", err)
	}
}

func isApplied(ctx context.Context, pool *pgxpool.Pool, filename, checksum string) bool {
	var stored *string
	if err := pool.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE filename=$1`, filename).Scan(&stored); err != nil {
		return false
	}
	if stored == nil || *stored == "" {
		if _, err := pool.Exec(ctx, `UPDATE schema_migrations SET checksum=$1 WHERE filename=$2 AND checksum IS NULL`, checksum, filename); err != nil {
			log.Fatalf("backfill migration checksum %s: %v", filename, err)
		}
		return true
	}
	if *stored != checksum {
		log.Fatalf("migration %s changed after being applied; create a new migration instead", filename)
	}
	return true
}

func unmarkApplied(ctx context.Context, pool *pgxpool.Pool, filename string) {
	_, err := pool.Exec(ctx, `DELETE FROM schema_migrations WHERE filename=$1`, filename)
	if err != nil {
		log.Fatalf("unmark applied %s: %v", filename, err)
	}
}

func listApplied(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT filename FROM schema_migrations ORDER BY filename ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

func seedCredentials(pool *pgxpool.Pool) error {
	ctx := context.Background()
	adminHash, err := bcrypt.GenerateFromPassword([]byte("admin123"), 10)
	if err != nil {
		return err
	}
	demoHash, err := bcrypt.GenerateFromPassword([]byte("demo123"), 10)
	if err != nil {
		return err
	}
	cardHash := sha256.Sum256([]byte("STARAI-DEMO-1000"))
	cardHex := hex.EncodeToString(cardHash[:])
	const placeholderHash = "$2a$10$placeholder_will_be_updated_by_migrate"

	if _, err = pool.Exec(ctx, `UPDATE admin_users SET password_hash=$1 WHERE email='admin@starai.local' AND password_hash=$2`, string(adminHash), placeholderHash); err != nil {
		return err
	}
	if _, err = pool.Exec(ctx, `UPDATE auth_identities SET credential_hash=$1 WHERE provider='email' AND identifier='demo@starai.local' AND credential_hash=$2`, string(demoHash), placeholderHash); err != nil {
		return err
	}
	if _, err = pool.Exec(ctx, `UPDATE recharge_cards SET code_hash=$1 WHERE batch_id=1 AND code_hash='placeholder_card_hash'`, cardHex); err != nil {
		return err
	}
	return nil
}
