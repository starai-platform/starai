# StarAI 真实运营配置打包与同步

这套脚本用于把服务器上已经配置好的真实大模型、工作流、角色模板、渠道预设、系统配置等导出成一个“配置包”，再导入到本地或新服务器。

它不是全库备份。默认不会导出用户、钱包、订单、任务、作品、资产、提现、操作日志，避免把真实用户数据和资金数据带到测试环境。

重要：导入配置包会替换目标库的配置表，并使用 `TRUNCATE ... CASCADE` 处理依赖关系。请只导入到干净本地库或新服务器。不要直接导入到已有真实用户的生产库，除非你已经做了完整数据库备份并明确知道影响范围。

## 适合导出的内容

默认包含：

- `system_configs`：系统配置、界面语言、生成语言、存储配置、OAuth/SMTP 等
- `models`：大模型配置、价格、参数、上游模型名、图标
- `workflow_definitions`：智能体/工作流定义
- `role_templates`：角色模板
- `model_channel_presets`：多模型渠道预设
- `home_cards`：首页卡片
- `gallery_tags`：灵感广场标签
- `api_docs`：对外 API 文档
- `member_levels`：会员等级和推荐奖励配置
- `announcements`：公告配置

默认不包含：

- 用户、登录身份、钱包、流水、现金账户、提现
- 订单、卡密、充值卡
- 生成任务、作品、会话、AI 调用日志
- 用户上传资产、灵感广场作品、操作日志

管理员账号默认也不导出。需要复制管理员账号时，显式加 `INCLUDE_ADMIN_ACCOUNTS=1`。

## 从生产服务器导出配置包

在服务器项目根目录执行：

```bash
bash scripts/export-settings-pack.sh
```

生成文件类似：

```text
backups/settings/starai-settings-20260618-120000.tar.gz
```

如果需要连管理员账号一起导出：

```bash
INCLUDE_ADMIN_ACCOUNTS=1 bash scripts/export-settings-pack.sh
```

注意：配置包里可能包含上游模型密钥、存储密钥、SMTP、OAuth 等敏感信息。不要提交到 GitHub。

## 导入到本地

本地需要先准备 `.env` 或 `.env.production`，并启动数据库、执行迁移。使用 Docker 部署方式时可执行：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml --profile tools run --rm migrate
CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh backups/settings/starai-settings-20260618-120000.tar.gz
```

如果本地环境变量文件不是 `.env.production`：

```bash
ENV_FILE=.env CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh backups/settings/starai-settings-20260618-120000.tar.gz
```

导入会替换目标数据库里的配置表。用于干净本地库最合适；如果本地旧测试数据很多，建议先重新建库或重建 Docker 数据卷。

## 新服务器一键部署时带上真实配置

新服务器推荐顺序：

```bash
git clone <your-repo-url> /www/wwwroot/starai
cd /www/wwwroot/starai
cp .env.example .env.production
```

填好 `.env.production` 后：

```bash
bash scripts/deploy-prod.sh
CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh /path/to/starai-settings-xxxx.tar.gz
bash scripts/deploy-prod.sh
```

第一次 `deploy-prod.sh` 用于构建服务并跑迁移；导入配置包后再次执行部署脚本可以确保服务按最新配置启动。

如果只是数据库配置变化，导入后通常不需要重启 API；但涉及模型、存储、系统配置时，为了避免缓存或进程内配置未刷新，生产环境建议执行：

```bash
BUILD_SERVICES="api worker web admin" RUN_MIGRATIONS=0 bash scripts/deploy-prod.sh
```

## 本地存储文件怎么处理

如果线上使用 R2/S3/MinIO 公开桶，配置包里带的是公开 URL 和存储配置，新服务器不需要额外复制文件。

如果线上使用本地存储，配置包只会带数据库里的 URL，不会自动带物理文件。你还需要备份上传目录。默认本地存储目录由 `LOCAL_STORAGE_DIR` 决定，未配置时 API 容器内默认是 `../../data/uploads`。

推荐生产明确配置：

```env
LOCAL_STORAGE_DIR=/app/data/uploads
LOCAL_STORAGE_PUBLIC_URL=https://your-domain.com/uploads-local
```

当前生产 Docker Compose 已默认把项目根目录的 `data/uploads` 挂载到 API/Worker 容器的 `/app/data/uploads`。因此服务器上需要额外备份的是项目根目录下的：

```text
data/uploads
```

然后单独打包上传目录：

```bash
tar -czf backups/settings/uploads-local-$(date +%Y%m%d-%H%M%S).tar.gz data/uploads
```

恢复时解压到新服务器相同目录，并确保 Nginx `/uploads-local/` 能代理或映射到 API 的上传访问路径。

## 和完整数据库备份的区别

配置包用于迁移运营设置，不是灾备。

正式生产仍建议定期做完整数据库备份：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > backups/full/starai-full-$(date +%Y%m%d-%H%M%S).dump
```

完整备份用于事故恢复；配置包用于把“真实配置”同步到本地或新服务器。
