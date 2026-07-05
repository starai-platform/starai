package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	_ = godotenv.Load()
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
			if isApplied(ctx, pool, name) {
				fmt.Printf("skip %s (already applied)\n", name)
				continue
			}
			if err := runSQLFile(pool, f); err != nil {
				if isAlreadyAppliedErr(err) {
					fmt.Printf("skip %s (detected already applied)\n", name)
					markApplied(ctx, pool, name)
					continue
				}
				log.Fatalf("exec %s: %v", f, err)
			}
			markApplied(ctx, pool, name)
			fmt.Printf("applied %s\n", name)
		}
		seedCredentials(pool)
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
		if err := runSQLFile(pool, downPath); err != nil {
			log.Fatalf("exec %s: %v", downPath, err)
		}
		unmarkApplied(ctx, pool, upName)
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

func runSQLFile(pool *pgxpool.Pool, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	_, err = pool.Exec(context.Background(), string(data))
	return err
}

func isAlreadyAppliedErr(err error) bool {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "42P07": // relation already exists
			return true
		case "42710": // duplicate_object
			return true
		case "42701": // duplicate_column
			return true
		}
	}
	msg := err.Error()
	return strings.Contains(msg, "already exists") || strings.Contains(msg, "duplicate")
}

func ensureSchemaMigrations(ctx context.Context, pool *pgxpool.Pool) {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	if err != nil {
		log.Fatalf("ensure schema_migrations: %v", err)
	}
}

func isApplied(ctx context.Context, pool *pgxpool.Pool, filename string) bool {
	var ok bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1)`, filename).Scan(&ok); err != nil {
		return false
	}
	return ok
}

func markApplied(ctx context.Context, pool *pgxpool.Pool, filename string) {
	_, err := pool.Exec(ctx, `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, filename)
	if err != nil {
		log.Fatalf("mark applied %s: %v", filename, err)
	}
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

func seedCredentials(pool *pgxpool.Pool) {
	ctx := context.Background()
	adminHash, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 10)
	demoHash, _ := bcrypt.GenerateFromPassword([]byte("demo123"), 10)
	cardHash := sha256.Sum256([]byte("STARAI-DEMO-1000"))
	cardHex := hex.EncodeToString(cardHash[:])

	pool.Exec(ctx, `UPDATE admin_users SET password_hash=$1 WHERE email='admin@starai.local'`, string(adminHash))
	pool.Exec(ctx, `UPDATE auth_identities SET credential_hash=$1 WHERE identifier='demo@starai.local'`, string(demoHash))
	pool.Exec(ctx, `UPDATE recharge_cards SET code_hash=$1 WHERE batch_id=1 AND code_hash='placeholder_card_hash'`, cardHex)
}
