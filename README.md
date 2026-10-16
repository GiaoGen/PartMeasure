# PartMeasure · P0-0

仅「约束与架构基线」。首页是工程启动标记，`GET /api/health` 是进程存活检查，明确不代表数据库就绪。没有认证、项目、分享、上传、标注、测量、交付业务实现。

## 运行

需要 Node **24.15.0**（`.nvmrc`）、npm **11.12.1**。统一 npm；不用 pnpm/yarn，不修改全局 registry。依赖精确版本与 `package-lock.json` 一并管理。

```powershell
npm ci
npm run dev
# http://127.0.0.1:3000
```

P0-0 不需外部凭据即可启动。后续用 `Copy-Item .env.example .env.local` 创建本地配置；示例所有凭据均为空。不要提交 `.env.local`、数据库密码、分享令牌或服务端密钥。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm exec playwright install chromium
npm run test:e2e
npm run start
npm run licenses
```

`test:e2e` 自动在 3100 端口启动**已构建**服务器；先 build，勿占用 3100。只测试基础页与健康检查。Pixel 7 viewport 是 Chromium 仿真，不是手机实测。Vitest 测无凭据健康契约；异步 Server Component 通过 Playwright 测。首次下载依赖/浏览器需外网。

## 审阅入口

1. [范围与 PRD 对照](docs/P0-0/00-baseline.md)
2. [依赖、兼容与许可证核对](docs/P0-0/01-dependencies.md)
3. [架构、关系与安全基线](docs/P0-0/02-architecture-security.md)
4. [路由与接口契约](docs/P0-0/03-api-contracts.md)
5. [图像坐标与早期验证计划](docs/P0-0/04-images-and-spikes.md)
6. [双端交互提案与待决策项](docs/P0-0/05-interaction-proposal.md)
7. [migration 流程及回滚](docs/P0-0/06-migrations.md)
8. [实际检查、审批和外部验证状态](docs/P0-0/07-verification.md)

`supabase/drafts/` 为**未批准 SQL 草案**，不在自动 migration 链中；`supabase/migrations/` 仅管理工程空基线。未经架构审查与后续实施授权，不把草案提升为 migration，不连接远程数据库，不部署。P0-0 未宣称验收通过。

本机目录归属为 Administrators，Git可能报dubious ownership。可仅对当前命令使用`git -c safe.directory=D:/PartMeasure status`（或log/diff），无需修改全局safe.directory。初始目录无Git，现建立本地历史；没有配置远程或推送。
