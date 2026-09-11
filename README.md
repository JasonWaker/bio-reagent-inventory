# 试剂库存台账

面向生物试剂库存监测的 PC/移动端 Web 应用。每次导入新的入库表会建立新库存周期，后续出库仅从当前周期扣减；库存预警值与具体批号绑定。

## 已支持

- Excel 入库（优先读取名称含“亿丰”的工作表）和出库导入。
- 手工新增、修改入库批次与出库记录。
- 按“货号 + 批号”管理库存，出库优先按批号匹配。
- 每批次独立库存预警值与搜索，未单独设置时使用全局默认值。
- JSON 备份/恢复与 Excel 台账导出。
- 阿里云百炼 qwen-vl-ocr 图片识别；结果先进入可编辑草稿，确认后才入库。
- 独立 PostgreSQL 数据库云同步，使用版本号阻止多设备静默覆盖。

## 数据隔离

- 数据库：独立的 `bio_reagent_inventory`，独立运行账号 `bio_reagent_app`。
- 图片：独立私有 OSS Bucket，不复用其他项目 Bucket；图片识别结束立即删除，1 天生命周期兜底。
- 服务：独立容器、目录、网络与日志；仅监听 `127.0.0.1:3110`，限制 0.5 CPU / 512 MB。
- 凭据：百炼、OSS、数据库和登录密钥只进入服务端专用环境变量，不进入 GitHub Pages 或仓库。

## 本地前端

```bash
npm install
npm run dev
```

未设置 `VITE_API_BASE_URL` 时应用保持本地模式。GitHub Pages 发布前，在仓库 Actions Variables 中设置该变量为独立 API 的 HTTPS 地址。

## 独立后端

```bash
cd server
npm install
npm run typecheck
npm run build
```

配置项见 [server/.env.example](server/.env.example)。数据库初始化顺序：

1. 管理员执行 `server/deploy/provision-database.sql` 创建独立数据库和账号。
2. 使用 `bio_reagent_migrator` 在新库执行 `server/migrations/001_initial.sql`。
3. 执行 `server/migrations/002_runtime_grants.sql`，只授予运行账号本库 DML 权限。
4. 使用 `server/deploy/docker-compose.yml` 启动独立容器。

## 阿里云资源

`infra/main.tf` 仅描述进销存专用 OSS Bucket、私有 ACL、AES256 加密和 1 天图片清理规则。2026-09-11 已通过阿里云只读 Terraform plan：3 项新增、0 修改、0 删除；尚未 apply。

完整设计和上线约束见 `.aliyun-ai-ops-spec/reagent-inventory-cloud/designs/design.md`。
