# StarAI 宝塔面板单域名部署教程

本文档适用于：

- 一台 Linux 服务器
- 宝塔面板
- Docker Compose
- 单个主域名访问前台、后台和 API
- 可选 Cloudflare / R2 / S3 存储

最终访问路径：

```text
https://yourdomain.com                 用户前台
https://yourdomain.com/admin           管理后台
https://yourdomain.com/api/*           用户 API
https://yourdomain.com/admin/api/*     管理后台 API
https://yourdomain.com/v1/*            OpenAI 兼容 API
https://yourdomain.com/admin-assets/*  管理后台静态资源
```

## 1. 部署架构

宝塔只负责域名、HTTPS、Nginx 反向代理、日志和计划任务。业务服务全部由 Docker Compose 管理：

| 服务 | 说明 | 本机端口 |
| --- | --- | --- |
| `web` | 用户前台 Next.js | `127.0.0.1:3000` |
| `admin` | 管理后台 Next.js | `127.0.0.1:3001` |
| `api` | Go API 服务 | `127.0.0.1:8080` |
| `worker` | 异步任务 Worker | 无外部端口 |
| `postgres` | PostgreSQL | Docker 内部 |
| `redis` | Redis / Asynq 队列 | Docker 内部 |

单域名部署的关键是区分路径：

```text
/                         转发到 web
/_next/static/*           转发到 web 静态资源
/admin*                   转发到 admin
/admin-assets/_next/*     转发到 admin 静态资源
/api/*                    转发到 api
/admin/api/*              转发到 api
/v1/*                     转发到 api
/uploads-local/*          转发到 api 本地上传兜底路径
```

不要把后台静态资源也放到 `/_next/*`，否则会和前台 Next.js 静态资源冲突。

## 2. 服务器准备

推荐最低配置：

```text
4 核 CPU / 8GB 内存 / 40GB NVMe / 20Mbps+
```

宝塔面板安装：

- Nginx
- Docker
- Docker Compose

不建议用宝塔单独安装 PostgreSQL、Redis、Node.js 或 Go 来跑 StarAI 业务服务，避免运行环境分散。

低配服务器建议额外添加 4GB swap：

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. 上传代码

推荐路径固定为：

```text
/www/wwwroot/starai
```

通过 Git 拉取：

```bash
cd /www/wwwroot
git clone <your-repo-url> starai
cd starai
```

如果使用压缩包上传，也请解压到 `/www/wwwroot/starai`。

## 4. 配置生产环境变量

在项目根目录创建生产环境配置：

```bash
cd /www/wwwroot/starai
cp .env.example .env.production
```

`.env.example` 是生产部署模板，适合宝塔 / Docker Compose 一键部署。`.env.local` 只用于本地开发，不要复制到生产服务器使用，否则前端可能会把 API 地址构建成 `localhost:8080`，导致线上浏览器无法登录或请求接口。

编辑 `.env.production`，参考下面配置：

```env
# PostgreSQL
POSTGRES_USER=starai
POSTGRES_PASSWORD=change_this_to_a_strong_password
POSTGRES_DB=starai
DATABASE_URL=postgres://starai:change_this_to_a_strong_password@postgres:5432/starai?sslmode=disable

# Redis
REDIS_URL=redis://redis:6379/0
REDIS_MAXMEMORY=1gb

# JWT
JWT_SECRET=replace_with_a_long_random_secret
ADMIN_JWT_SECRET=replace_with_another_long_random_secret
JWT_EXPIRE_HOURS=72

# API
APP_ENV=production
API_PORT=8080
BASE_URL=https://yourdomain.com
LOCAL_STORAGE_PUBLIC_URL=https://yourdomain.com/uploads-local

# Frontend
NEXT_PUBLIC_API_URL=https://yourdomain.com

# Admin Next.js static assets.
# Must match the Nginx /admin-assets/_next/ rule.
ADMIN_ASSET_PREFIX=/admin-assets

# R2 / S3 compatible storage.
# Production is recommended to use object storage instead of local uploads.
MINIO_ENDPOINT=<accountid>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY=your_r2_access_key
MINIO_SECRET_KEY=your_r2_secret_key
MINIO_BUCKET=starai-works
MINIO_PUBLIC_URL=https://cdn.yourdomain.com
MINIO_USE_SSL=true

# Model gateway
NEW_API_BASE_URL=https://your-model-gateway.example.com
NEW_API_TOKEN=your_model_gateway_token
NEW_API_TIMEOUT_SECONDS=300
NEW_API_STREAM_TIMEOUT_SECONDS=600
```

注意：

- `NEXT_PUBLIC_API_URL` 填主域名即可，Nginx 会把 `/api/*` 和 `/admin/api/*` 转发给 API。
- `BASE_URL` 用于服务端生成公开链接，生产环境必须是 HTTPS 域名。
- `LOCAL_STORAGE_PUBLIC_URL` 是本地上传兜底路径。生产环境建议主要使用 R2/S3。
- `ADMIN_ASSET_PREFIX=/admin-assets` 必须和 Nginx 配置一致，修改后必须重新构建 `admin`。
- 后台 API 文档里的 `Base URL` 推荐填写 `https://yourdomain.com`，用户最终调用示例是 `https://yourdomain.com/v1/chat/completions`。
- 首次部署前必须把 `yourdomain.com`、`change_this_to_a_strong_password`、`replace_with_*`、对象存储和模型网关占位值全部替换成真实值。部署脚本会在 `APP_ENV=production` 时主动拦截这些占位配置。

## 5. 首次部署

推荐统一使用项目脚本部署：

```bash
cd /www/wwwroot/starai
bash scripts/deploy-prod.sh
```

脚本会自动执行：

1. 检查 `.env.production` 和 Docker Compose 配置。
2. 启动 PostgreSQL / Redis。
3. 按顺序构建 `api -> worker -> web -> admin`，降低低配 VPS 的内存压力。
4. 执行数据库迁移。
5. 启动或更新应用服务。
6. 输出服务状态和前端 `BUILD_ID`。
7. 清理悬空镜像和限制 Docker BuildKit 缓存。

查看服务状态：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml ps
```

查看日志：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f worker
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f web
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f admin
```

如果脚本没有执行权限：

```bash
chmod +x scripts/deploy-prod.sh
./scripts/deploy-prod.sh
```

## 6. 导入运营配置包（可选）

如果你已经在旧环境配置好了模型、智能体、系统配置、角色模板、API 文档、会员等级、公告、首页卡片等，希望新服务器首次部署后直接继承这些配置，可以使用配置包。

导出配置包：

```bash
cd /www/wwwroot/starai
bash scripts/export-settings-pack.sh
```

Windows 本地开发环境可用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-settings-pack.ps1
```

导出文件位置：

```text
backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz
```

把配置包上传到新服务器项目目录后，首次部署时导入：

```bash
cd /www/wwwroot/starai
IMPORT_SETTINGS_PACK=1 SETTINGS_PACK=backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz bash scripts/deploy-prod.sh
```

注意：

- 配置包可能包含模型、存储、SMTP、OAuth、支付等敏感配置，不要提交到 GitHub。
- 日常代码更新不要加 `IMPORT_SETTINGS_PACK=1`，否则会覆盖后台后续修改的配置。
- 默认不导出管理员账号。确实需要导出管理员账号时：

```bash
INCLUDE_ADMIN_ACCOUNTS=1 bash scripts/export-settings-pack.sh
```

也可以迁移完成后手动导入：

```bash
CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz
```

更多说明见 [settings-pack.md](./settings-pack.md)。

## 7. 宝塔 Nginx 配置

在宝塔中新建网站：

```text
域名：yourdomain.com
根目录：/www/wwwroot/starai
SSL：申请并开启 HTTPS
```

然后进入该网站的 Nginx 配置，使用下面完整配置。替换域名和证书路径后保存，保存前先执行 `nginx -t` 检查。

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location ^~ /.well-known/acme-challenge/ {
        root /www/wwwroot/starai;
        allow all;
    }

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    root /www/wwwroot/starai;
    index index.html;

    ssl_certificate     /www/server/panel/vhost/cert/yourdomain.com/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/yourdomain.com/privkey.pem;

    client_max_body_size 100m;

    access_log /www/wwwlogs/yourdomain.com.log;
    error_log  /www/wwwlogs/yourdomain.com.error.log;

    location ^~ /.well-known/acme-challenge/ {
        root /www/wwwroot/starai;
        allow all;
    }

    location ~* /\.(git|svn|hg|env|user.ini|htaccess|htpasswd) {
        return 404;
    }

    location ~* /(node_modules|runtime|\.next|\.nuxt|\.cache|\.turbo|\.idea|\.vscode)/ {
        return 404;
    }

    location ~* \.(sql|bak|old|tmp|log|lock|yml|yaml|toml|mod|sum)$ {
        return 404;
    }

    # Admin API must be before /admin.
    location ^~ /admin/api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location ^~ /v1/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }

    location ^~ /uploads-local/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # Admin static assets. This avoids conflict with frontend /_next/static.
    location ^~ /admin-assets/_next/ {
        rewrite ^/admin-assets/_next/(.*)$ /_next/$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ^~ /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ^~ /admin {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }
}
```

检查并重载：

```bash
nginx -t
/etc/init.d/nginx reload
```

## 8. Cloudflare / CDN 建议

如果主域名接入 Cloudflare：

- `yourdomain.com` 可以开启代理云朵。
- 不要给 HTML 页面设置全站缓存。
- API 路径不要缓存。
- R2 文件建议使用单独域名，例如 `cdn.yourdomain.com`。

不要缓存：

```text
/
/app*
/auth*
/api/*
/admin/api/*
/admin*
/admin-assets/*
```

可以缓存：

```text
/_next/static/*
/admin-assets/_next/static/*
cdn.yourdomain.com/*
```

更新后如需清理 CDN，优先清理：

```text
/
/app*
/admin*
/admin-assets/*
```

## 9. 日常更新

推荐统一执行：

```bash
cd /www/wwwroot/starai
git pull
bash scripts/deploy-prod.sh
```

低配 VPS 不要直接执行：

```bash
docker compose up -d --build
```

因为它容易同时构建 API、Worker、Web、Admin，导致 CPU 和内存被打满。`scripts/deploy-prod.sh` 默认会：

- `COMPOSE_PARALLEL_LIMIT=1`
- 按服务顺序构建
- 构建前停止本次要更新的旧容器以释放内存
- 限制 Docker BuildKit 缓存

只更新前台和后台：

```bash
BUILD_SERVICES="web admin" bash scripts/deploy-prod.sh
```

只更新前台：

```bash
BUILD_SERVICES="web" bash scripts/deploy-prod.sh
```

只更新后台：

```bash
BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

只更新 API / Worker：

```bash
BUILD_SERVICES="api worker" bash scripts/deploy-prod.sh
```

强制无缓存构建：

```bash
NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
NO_CACHE_SERVICES="web" BUILD_SERVICES="web" bash scripts/deploy-prod.sh
```

服务器资源充足且希望构建时不停旧容器：

```bash
STOP_SERVICES_BEFORE_BUILD=0 bash scripts/deploy-prod.sh
```

指定 `BUILD_SERVICES` 且不包含 `api` 时，脚本默认跳过数据库迁移。确实需要强制迁移：

```bash
RUN_MIGRATIONS=1 BUILD_SERVICES="web admin" bash scripts/deploy-prod.sh
```

## 10. 备份

创建备份目录：

```bash
mkdir -p /www/backup/starai
```

宝塔计划任务每天执行：

```bash
cd /www/wwwroot/starai
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U ${POSTGRES_USER:-starai} ${POSTGRES_DB:-starai} \
  | gzip > /www/backup/starai/starai_$(date +%F).sql.gz
find /www/backup/starai -type f -name "*.sql.gz" -mtime +14 -delete
```

建议再把 `/www/backup/starai` 同步到 R2 或另一台服务器。完整备份恢复可参考 [full-backup-restore.md](./full-backup-restore.md)。

## 11. Docker 磁盘维护

查看 Docker 占用：

```bash
docker system df
docker system df -v
```

生成维护报告，不删除内容：

```bash
cd /www/wwwroot/starai
bash scripts/docker-disk-maintenance.sh report
```

安全清理：

```bash
bash scripts/docker-disk-maintenance.sh safe-clean
```

安全清理只会处理：

- 悬空镜像
- 超过 7 天的已停止容器
- 超过缓存上限的 BuildKit 构建缓存

它不会执行 `docker volume prune`，不会删除 PostgreSQL、Redis、MinIO 数据卷，也不会删除 `data/uploads` 和 `backups`。

宝塔计划任务建议每周执行一次：

```bash
cd /www/wwwroot/starai && BUILD_CACHE_KEEP_STORAGE=4GB bash scripts/docker-disk-maintenance.sh safe-clean >> /www/wwwlogs/starai-docker-clean.log 2>&1
```

如果确认存在大量长期未使用镜像，可执行深度清理：

```bash
bash scripts/docker-disk-maintenance.sh deep-clean
```

## 12. 更新后仍看到旧页面

前台和后台都是 Next.js 应用。`/_next/static/*` 和 `/admin-assets/_next/static/*` 可以长缓存，但页面入口 HTML 不能缓存。

检查响应头：

```bash
curl -I https://yourdomain.com/
curl -I https://yourdomain.com/app
curl -I https://yourdomain.com/admin/login
```

应看到类似：

```text
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
```

检查本机服务是否已经是新页面：

```bash
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3001/admin/login
curl -I https://yourdomain.com/
curl -I https://yourdomain.com/admin/login
```

判断方式：

- `127.0.0.1` 是新页面，域名是旧页面：问题在 Nginx / CDN / 浏览器缓存。
- `127.0.0.1` 也是旧页面：对应服务镜像没有成功重建。

后台页面仍旧时，强制重建后台：

```bash
NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

前台页面仍旧时，强制重建前台：

```bash
NO_CACHE_SERVICES="web" BUILD_SERVICES="web" bash scripts/deploy-prod.sh
```

确认前端 `BUILD_ID`：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml exec -T admin \
  sh -lc 'cat /app/apps/admin/.next/BUILD_ID'

docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml exec -T web \
  sh -lc 'cat /app/apps/web/.next/BUILD_ID'
```

再次部署后 `BUILD_ID` 应该变化。如果没有变化，说明没有构建出新的前端镜像。

## 13. 常见问题

### 后台页面能打开，但样式或 JS 404

检查：

- `.env.production` 是否有 `ADMIN_ASSET_PREFIX=/admin-assets`
- Nginx 是否配置了 `/admin-assets/_next/`
- 修改 `ADMIN_ASSET_PREFIX` 后是否重新构建 `admin`

修复：

```bash
NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

### 前台请求 API 失败

检查：

- `NEXT_PUBLIC_API_URL=https://yourdomain.com`
- Nginx `/api/` 是否转发到 `127.0.0.1:8080`
- API 日志是否正常

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs --tail=100 api
```

### 管理后台 API 请求失败

检查：

- Nginx `/admin/api/` 是否放在 `/admin` 规则前面。
- `/admin/api/` 是否转发到 `127.0.0.1:8080`。

### 上传失败

检查：

- Nginx `client_max_body_size 100m`
- R2/S3 配置是否正确
- `MINIO_PUBLIC_URL` 是否可公开访问
- 本地兜底路径 `/uploads-local/` 是否转发到 API

### 生成任务一直排队

检查：

- Worker 日志
- Redis 是否正常
- 模型网关是否可用

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs --tail=100 worker
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml ps
```

### 构建 Web/Admin 报 `No such built-in module: node:sqlite`

原因通常是旧构建缓存或旧镜像使用了过低 Node 版本。项目 Dockerfile 已使用 `node:22-alpine` 并固定 `pnpm@11.7.0`。

处理：

```bash
cd /www/wwwroot/starai
git pull
docker builder prune -f
bash scripts/deploy-prod.sh
```

### 构建 API/Worker 拉取 Go 镜像失败

如果出现 `golang:1.25-alpine ... failed to resolve source metadata`，通常是 Docker 镜像源缓存异常或网络问题。

处理：

```bash
cd /www/wwwroot/starai
git pull
docker builder prune -f
docker pull golang:1.25-alpine
docker pull node:22-alpine
docker pull alpine:3.20
bash scripts/deploy-prod.sh
```

如果 `docker pull golang:1.25-alpine` 仍失败，优先检查宝塔 Docker 镜像加速源。某些第三方镜像源可能缓存损坏，可临时切回 Docker Hub 官方源或更换可用镜像源后重试。
