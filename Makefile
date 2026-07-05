.PHONY: migrate-up migrate-down dev-api dev-worker dev-mock docker-up docker-down

migrate-up:
	cd services/api && go run ./cmd/migrate up

migrate-down:
	cd services/api && go run ./cmd/migrate down

dev-api:
	cd services/api && go run ./cmd/api

dev-worker:
	cd services/worker && go run ./cmd/worker

dev-mock:
	cd services/mock-new-api && go run ./cmd/mock

docker-up:
	docker compose -f infra/docker/docker-compose.yml up -d

docker-down:
	docker compose -f infra/docker/docker-compose.yml down
