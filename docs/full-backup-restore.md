# StarAI 完整备份与本地重建

如果你希望本地环境完全变成服务器同款，并且不需要保留本地旧测试数据，完整备份恢复比“配置包”更简单。

完整备份包含：

- 完整 PostgreSQL 数据库
- 上传文件目录
- `.env.production` 副本

注意：完整备份会包含真实用户、钱包、订单、API Key、管理员账号、模型密钥、SMTP/OAuth 配置等敏感信息，不要提交到 GitHub。

## 服务器导出完整备份

在服务器项目根目录执行：

```bash
cd /www/wwwroot/starai
bash scripts/export-full-backup.sh
```

生成文件：

```text
backups/full/starai-full-backup-xxxx.tar.gz
```

脚本会自动处理上传目录：

- 如果项目根目录有 `data/uploads`，直接打包它。
- 如果没有，会尝试从 API 容器里的 `LOCAL_STORAGE_DIR` 打包。
- 如果确实没有上传目录，会生成一个空上传目录包，不会报错中断。

## 本地清空并恢复

先把备份包放到本地项目目录，例如：

```text
backups/full/starai-full-backup-xxxx.tar.gz
```

如果你要彻底清空本地 StarAI Docker 数据：

```bash
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml down -v --remove-orphans
```

恢复：

```bash
CONFIRM_RESTORE=1 bash scripts/import-full-backup.sh backups/full/starai-full-backup-xxxx.tar.gz
bash scripts/deploy-prod.sh
```

如果本地没有 `.env.production`，并且你要直接使用备份里的生产环境文件：

```bash
RESTORE_ENV_FILE=1 CONFIRM_RESTORE=1 bash scripts/import-full-backup.sh backups/full/starai-full-backup-xxxx.tar.gz
```

本地测试时通常需要把 `.env.production` 改成本地地址，例如：

```env
BASE_URL=http://localhost:8080
LOCAL_STORAGE_PUBLIC_URL=http://localhost:8080/uploads-local
NEXT_PUBLIC_API_URL=http://localhost:8080
```

本地.env.local 开发环境一键清理脚本 /scripts/cleanup-local-dev.ps1

# 预览，不删除
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-local-dev.ps1 -DryRun

# 执行清理，会要求输入确认词
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-local-dev.ps1

# 跳过确认
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-local-dev.ps1 -Force

如果你要模拟线上域名环境，可以保持生产域名配置，但本地浏览器访问和上传文件打开地址会依赖这个域名是否能访问。
