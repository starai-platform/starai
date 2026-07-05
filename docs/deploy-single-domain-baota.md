# StarAI 单域名宝塔部署文档

本文档适用于“一台服务器 + 宝塔面板 + Docker Compose + Cloudflare R2/CDN”的部署方式。

目标访问方式：

```text
https://yourdomain.com             用户前台
https://yourdomain.com/admin       管理后台
https://yourdomain.com/api         用户 API
https://yourdomain.com/admin/api   管理 API
https://yourdomain.com/admin-assets/_next/*  管理后台静态资源
```

## 1. 推荐架构

宝塔只负责：

- 域名解析后的站点入口
- HTTPS/SSL
- Nginx 反向代理
- 服务器监控和计划任务

业务服务全部由 Docker Compose 管理：

- `web`: 用户前台 Next.js，监听 `127.0.0.1:3000`
- `admin`: 管理后台 Next.js，监听 `127.0.0.1:3001`
- `api`: Go API，监听 `127.0.0.1:8080`
- `worker`: 异步任务 Worker
- `postgres`: PostgreSQL
- `redis`: Redis/Asynq 队列

图片、视频和用户上传素材使用 R2/S3，不建议生产长期使用本地 `/uploads-local`。

## 2. 服务器准备

推荐单机配置：

```text
4 核 8G / 100G NVMe / 20Mbps+
```

宝塔安装：

- Nginx
- Docker
- Docker Compose

不要用宝塔单独安装 PostgreSQL/Redis/Node/Go 来跑业务服务，避免维护分散。

## 3. 上传代码

```bash
cd /www/wwwroot
git clone <your-repo-url> starai
cd starai
```

如果是上传压缩包，解压后的目录也建议固定为：

```text
/www/wwwroot/starai
```

## 4. 配置生产环境变量

在项目根目录创建：

```bash
cp .env.example .env.production
```

按下面示例修改 `.env.production`：

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
NEXT_PUBLIC_API_URL=https://yourdomain.com

# Admin static assets on the same domain.
# Do not change unless you also change Nginx.
ADMIN_ASSET_PREFIX=/admin-assets

# R2 / S3 compatible storage
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

- `NEXT_PUBLIC_API_URL` 使用同一个主域名即可，因为 Nginx 会把 `/api` 和 `/admin/api` 转发给 API。
- `APP_ENV=production` 时，如果使用本地存储，必须配置 `LOCAL_STORAGE_PUBLIC_URL` 或 `BASE_URL`，否则系统不会再静默生成 `localhost` 上传地址。
- 本地开发环境使用 `APP_ENV=development`、`BASE_URL=`、`LOCAL_STORAGE_PUBLIC_URL=http://localhost:8080/uploads-local`。
- 如果使用 R2 自定义域名，`MINIO_PUBLIC_URL` 建议填 CDN/R2 公网域名，例如 `https://cdn.yourdomain.com`。

## 5. 启动服务

推荐使用项目内置部署脚本。首次部署、迁移、重新部署都用同一条命令：

```bash
cd /www/wwwroot/starai
bash scripts/deploy-prod.sh
```

脚本会自动执行：

1. 检查 `.env.production` 和 Compose 配置。
2. 启动 PostgreSQL / Redis。
3. 构建 API / Worker / Web / Admin 镜像。
4. 执行数据库迁移。
5. 启动或更新全部应用服务。
6. 清理悬空镜像。

### 5.1 导入真实运营配置包

项目迁移或新服务器首次安装时，如果你希望部署完成后直接拥有当前真实后台配置，包括：

- 模型管理里的真实模型
- 工作流 / 智能体配置
- 多模型卡片和渠道预设
- 角色模板
- API 文档
- 系统配置
- 会员等级、公告、首页卡片、灵感广场标签

同时不带用户、钱包、订单、任务、我的作品、素材、提现、操作日志等业务历史数据，可以使用“配置包”。

在已经配置好的旧服务器或本地环境导出：

```bash
cd /www/wwwroot/starai
bash scripts/export-settings-pack.sh
```

如果是在 Windows 本地开发环境，且平时用 `scripts/dev.ps1` 启动，可以执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-settings-pack.ps1
```

导出文件会生成在：

```text
backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz
```

这个配置包只适合私下保存或上传到新服务器，不要提交到 GitHub。它会包含 `system_configs`，可能带有存储、SMTP、OAuth、支付、模型接入等敏感配置。

把配置包放到新服务器项目目录后，首次部署可一条命令完成迁移和真实配置导入：

```bash
cd /www/wwwroot/starai
IMPORT_SETTINGS_PACK=1 SETTINGS_PACK=backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz bash scripts/deploy-prod.sh
```

导入会替换迁移脚本里的演示填充数据。适合全新数据库或本地重装环境使用。

注意：

- 正式运营中的服务器日常更新代码，不要加 `IMPORT_SETTINGS_PACK=1`，否则会覆盖后台后来新增或修改的配置。
- 配置包默认不包含后台管理员账号。新服务器仍使用迁移默认管理员账号，登录后请第一时间修改密码或新增管理员。
- 如果确实希望配置包包含后台管理员账号，导出时可执行：

```bash
INCLUDE_ADMIN_ACCOUNTS=1 bash scripts/export-settings-pack.sh
```

除非是完全可信的自用环境，否则不建议把管理员账号一起打包。

只想手动导入配置包，也可以在迁移完成后单独执行：

```bash
CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh backups/settings/starai-settings-YYYYMMDD-HHMMSS.tar.gz
```

以后更新代码时优先使用：

```bash
cd /www/wwwroot/starai
git pull
bash scripts/deploy-prod.sh
```

### 5.2 低配置 VPS 更新注意事项

4 核 8G 这类单机部署不要直接执行 `docker compose up -d --build`。这个命令容易让 Docker 同时构建 `api / worker / web / admin`，Next.js 构建会和 Go 编译抢 CPU、内存，严重时 VPS 会卡死。

推荐始终使用项目脚本：

```bash
cd /www/wwwroot/starai
git pull
bash scripts/deploy-prod.sh
```

脚本默认会：

- `COMPOSE_PARALLEL_LIMIT=1`，限制 Docker Compose 并发。
- 逐个构建 `api -> worker -> web -> admin`。
- Next.js 构建限制 Node 内存，Go 构建限制编译并发。

如果只更新前台或后台，可只构建指定服务：

```bash
BUILD_SERVICES="web admin" bash scripts/deploy-prod.sh
```

部署脚本默认先停止本次要更新的旧容器，再逐个构建新镜像，释放内存，适合 4 核 8G 低配 VPS。这个过程会有短暂不可用。

如果服务器资源充足，并且希望构建时不停旧容器，可执行：

```bash
STOP_SERVICES_BEFORE_BUILD=0 bash scripts/deploy-prod.sh
```

只更新用户前台：

```bash
BUILD_SERVICES="web" bash scripts/deploy-prod.sh
```

只更新管理后台：

```bash
BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

如果确认代码已更新，但页面仍然像旧版本，可只对对应服务做无缓存构建：

```bash
NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
NO_CACHE_SERVICES="web" BUILD_SERVICES="web" bash scripts/deploy-prod.sh
```

脚本完成后会输出 `web/admin` 的容器 ID、镜像 ID 和 Next `BUILD_ID`。再次部署后 `BUILD_ID` 应该变化；如果不变，说明没有真正构建出新前端镜像。

部署脚本还会自动：

- 清理已经失去标签的旧镜像。
- 将 Docker BuildKit 构建缓存限制在默认 4GB 以内。
- 输出部署后的 Docker 磁盘占用。

可通过环境变量修改缓存上限：

```bash
BUILD_CACHE_KEEP_STORAGE=6GB bash scripts/deploy-prod.sh
```

不建议关闭缓存限制。如果临时需要保留全部构建缓存：

```bash
PRUNE_BUILD_CACHE=0 bash scripts/deploy-prod.sh
```

指定 `BUILD_SERVICES` 且不包含 `api` 时，脚本默认跳过数据库迁移。确实需要强制迁移可执行：

```bash
RUN_MIGRATIONS=1 BUILD_SERVICES="web admin" bash scripts/deploy-prod.sh
```

如果服务器仍然 OOM，先加 4G swap：

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 5.4 Docker 磁盘分析与安全清理

先只生成报告，不执行删除：

```bash
cd /www/wwwroot/starai
bash scripts/docker-disk-maintenance.sh report
```

日常推荐使用安全清理：

```bash
bash scripts/docker-disk-maintenance.sh safe-clean
```

它只会清理：

- 悬空镜像。
- 超过 7 天的已停止容器。
- 超过缓存上限的 BuildKit 构建缓存。

它不会执行 `docker volume prune`，不会删除 PostgreSQL、Redis、MinIO 数据卷，也不会删除 `data/uploads` 和 `backups`。

确认服务器存在大量长期未使用镜像时，可以执行：

```bash
bash scripts/docker-disk-maintenance.sh deep-clean
```

建议在宝塔计划任务中每周执行一次：

```bash
cd /www/wwwroot/starai && BUILD_CACHE_KEEP_STORAGE=4GB bash scripts/docker-disk-maintenance.sh safe-clean >> /www/wwwlogs/starai-docker-clean.log 2>&1
```

注意：`docker image ls` 显示的 SIZE 会重复计算共享层。判断真实占用时，应重点查看：

```bash
docker system df
docker system df -v
```

其中 `RECLAIMABLE` 和每个镜像的 `UNIQUE SIZE` 更接近真实可释放空间。

如果服务器提示脚本没有执行权限，可执行：

### 5.3 更新后仍看到旧页面

前台和后台都是 Next.js 应用。`/_next/static/*` 这类带 hash 的静态资源可以长缓存，但页面入口 HTML 不能缓存，否则部署后会出现“几分钟后才变过来”的情况。

项目已对这些页面入口设置 `no-store`：

- 前台：`/`、`/app/*`、`/auth/*`
- 后台：`/admin`、`/admin/*`

部署后可检查响应头：

```bash
curl -I https://yourdomain.com/
curl -I https://yourdomain.com/app
curl -I https://yourdomain.com/admin/login
```

应看到类似：

```text
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
```

后台 `/admin/*` 已配置为动态渲染。正常情况下，下面命令不应再看到 `x-nextjs-prerender: 1`：

```bash
curl -I http://127.0.0.1:3001/admin/system-config
curl -I https://yourdomain.com/admin/system-config
```

如果仍然看到 `x-nextjs-prerender: 1`，说明服务器上的 `admin` 镜像还不是最新代码，执行：

```bash
NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

如果使用 Cloudflare/CDN，更新后清理这些路径：

```text
/
/app*
/admin*
/admin-assets/*
```

不要对 HTML 页面设置 CDN 全站缓存。可以缓存的主要是：

```text
/_next/static/*
/admin-assets/_next/static/*
图片、CSS、JS 等带版本号或 hash 的静态资源
```

如果代码文件已更新但页面仍旧，按顺序排查：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml ps
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs --tail=80 web
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs --tail=80 admin
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3001/admin/login
```

本机 `127.0.0.1` 已是新页面、域名还是旧页面时，问题在 Nginx/CDN/浏览器缓存；本机也是旧页面时，重新构建对应服务：

```bash
BUILD_SERVICES="web" bash scripts/deploy-prod.sh
BUILD_SERVICES="admin" bash scripts/deploy-prod.sh
```

后台页面更新不生效时，可进一步确认容器内是否已经是新代码：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml exec -T admin \
  sh -lc 'cat /app/apps/admin/.next/BUILD_ID && grep -R "你修改后的关键文字" -n /app/apps/admin/src/app/admin/login/page.tsx || true'

curl -I http://127.0.0.1:3001/admin/login
curl -I https://yourdomain.com/admin/login
```

- 容器内找不到新文字：镜像构建没有吃到新代码，执行 `NO_CACHE_SERVICES="admin" BUILD_SERVICES="admin" bash scripts/deploy-prod.sh`。
- `127.0.0.1:3001` 是新页面，但域名是旧页面：问题在 Nginx/CDN/浏览器缓存。
- 容器内有新文字、`BUILD_ID` 已变化，但浏览器仍旧：清 CDN `/admin*`、`/admin-assets/*`，并使用无痕窗口或强刷验证。

如果服务器提示脚本没有执行权限，可执行：

```bash
chmod +x scripts/deploy-prod.sh
./scripts/deploy-prod.sh
```

手动命令如下，仅用于排查或临时操作。

在项目根目录执行：

```bash
bash scripts/deploy-prod.sh
```

查看状态：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml ps
```

初始化或升级数据库：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml --profile tools run --rm migrate
```

查看日志：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f worker
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f web
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs -f admin
```

## 6. 宝塔 Nginx 反向代理

宝塔中新建一个网站：

```text
域名：yourdomain.com
根目录：随意，例如 /www/wwwroot/starai-public
SSL：申请并开启 HTTPS
```

然后在该网站的 Nginx 配置中加入下面规则。

必须放在 `location /` 前面：

```nginx
client_max_body_size 100m;

proxy_connect_timeout 60s;
proxy_send_timeout 600s;
proxy_read_timeout 600s;

# 管理后台 API，必须放在 /admin 前面
location ^~ /admin/api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 用户 API
location ^~ /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 本地上传兜底路径。生产建议主要使用 R2。
location ^~ /uploads-local/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 管理后台静态资源，避免和前台 /_next 冲突
location ^~ /admin-assets/_next/ {
    rewrite ^/admin-assets/_next/(.*)$ /_next/$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 管理后台页面
location ^~ /admin/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header CDN-Cache-Control "no-store" always;
    add_header Cloudflare-CDN-Cache-Control "no-store" always;
}

# /admin 后台入口
location = /admin {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header CDN-Cache-Control "no-store" always;
    add_header Cloudflare-CDN-Cache-Control "no-store" always;
}

location = /admin/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header CDN-Cache-Control "no-store" always;
    add_header Cloudflare-CDN-Cache-Control "no-store" always;
}

# 前台 Next.js 静态资源
location ^~ /_next/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 用户前台
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header CDN-Cache-Control "no-store" always;
    add_header Cloudflare-CDN-Cache-Control "no-store" always;
}
```

保存后在宝塔里重载 Nginx。

## 7. Cloudflare/CDN 建议

如果域名接入 Cloudflare：

- `yourdomain.com` 可以开启代理云朵。
- API 不要设置页面缓存。
- R2 文件建议使用单独的 `cdn.yourdomain.com`。
- R2/CND 可设置较长缓存时间。

不要缓存这些路径：

```text
/
/app*
/auth*
/api/*
/admin/api/*
/admin/*
/admin-assets/*
```

可以缓存这些路径：

```text
/_next/static/*
/admin-assets/_next/static/*
cdn.yourdomain.com/*
```

## 8. 更新发布

推荐一条命令完成更新、构建、迁移和重启：

```bash
cd /www/wwwroot/starai
git pull
bash scripts/deploy-prod.sh
```

下面是手动拆分命令，仅用于排查。

```bash
cd /www/wwwroot/starai
git pull
bash scripts/deploy-prod.sh
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml --profile tools run --rm migrate
docker image prune -f
```

如果只改了前端，也可以只重建：

```bash
BUILD_SERVICES="web admin" bash scripts/deploy-prod.sh
```

如果只改了 API/Worker：

```bash
BUILD_SERVICES="api worker" bash scripts/deploy-prod.sh
```

## 9. 备份

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

建议再把 `/www/backup/starai` 同步到 R2 或另一台服务器。

## 10. 常用排查

后台页面能打开但样式/JS 404：

- 检查 `.env.production` 是否有 `ADMIN_ASSET_PREFIX=/admin-assets`
- 检查 Nginx 是否配置了 `/admin-assets/_next/`
- 修改后必须重新构建 `admin`

前台请求 API 失败：

- 检查 `NEXT_PUBLIC_API_URL=https://yourdomain.com`
- 检查 Nginx `/api/` 是否转发到 `127.0.0.1:8080`
- 检查 API 日志

上传失败：

- 检查 Nginx `client_max_body_size`
- 检查 R2 配置
- 检查 `MINIO_PUBLIC_URL`

生成任务一直排队：

- 检查 worker 日志
- 检查 Redis 是否正常
- 检查上游模型网关是否可用

Docker 构建前台/后台时报 `No such built-in module: node:sqlite`：

- 原因是容器内 Node 版本过低，但 Corepack 拉取的 pnpm 版本要求 Node 22+。
- 项目内 `apps/web/Dockerfile` 和 `apps/admin/Dockerfile` 已使用 `node:22-alpine` 并固定 `pnpm@11.7.0`。
- 如果服务器仍报这个错，先拉取最新代码，再清理旧构建缓存：

```bash
docker builder prune -f
bash scripts/deploy-prod.sh
```

Docker 构建 API/Worker 时报 `golang:1.22-alpine ... failed to resolve source metadata`：

- 原因通常是服务器 Docker 镜像源缓存异常，或者旧基础镜像元数据拉取失败。
- 项目 Dockerfile 已升级到 `golang:1.25-alpine`，并设置了 `GOPROXY=https://goproxy.cn,direct`。
- 宿主机安装的 Node.js 版本不影响这个错误；Go/Node 都是在 Docker 镜像里构建。
- 服务器执行：

```bash
cd /www/wwwroot/starai
git pull
docker builder prune -f
docker pull golang:1.25-alpine
docker pull node:22-alpine
docker pull alpine:3.20
bash scripts/deploy-prod.sh
```

如果 `docker pull golang:1.25-alpine` 仍失败，优先检查宝塔/Docker 配置的镜像加速源。某些第三方镜像源会缓存损坏，可临时切回 Docker Hub 官方源或更换可用镜像源后重试。



******************************************************************************************************************************



## 11. 单域名方案说明

单域名部署是简单可行的，但必须区分这几类路径：

- `/` 给用户前台
- `/_next/*` 给用户前台静态资源
- `/admin/*` 给管理后台页面
- `/admin-assets/_next/*` 给管理后台静态资源
- `/api/*` 给用户 API
- `/admin/api/*` 给管理 API

不要把后台也放到 `/_next/*`，否则会和前台资源冲突。
## 12. 单域名 Nginx 推荐完整配置

适用目标：

- 前台：`https://yourdomain.com`
- 用户端 API：`/api/*`
- 管理后台：`/admin/*`
- 管理后台 API：`/admin/api/*`
- 管理后台静态资源：`/admin-assets/_next/*`
- 对外 OpenAI 兼容 API：`/v1/*`
- 本地上传文件：`/uploads-local/*`

对应 `.env.production` 必须保持一致：

```env
BASE_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://yourdomain.com
LOCAL_STORAGE_PUBLIC_URL=https://yourdomain.com/uploads-local
ADMIN_ASSET_PREFIX=/admin-assets
```

后台 API 文档管理里的 `Base URL` 推荐填写：

```text
https://yourdomain.com
```

用户最终调用示例：

```text
https://yourdomain.com/v1/chat/completions
```

宝塔站点 Nginx 配置可使用下面这份完整规则。替换域名和证书路径后保存，保存前先执行 `nginx -t` 检查。

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

    location ~* \.(sql|bak|old|tmp|log|lock|yml|yaml|toml|mod|sum|json)$ {
        return 404;
    }

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
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }
}
```

保存后检查并重载：

```bash
nginx -t
/etc/init.d/nginx reload
```
