# PartMeasure · P0-1

当前范围：密码认证、项目、Guest 分享权限与私有文件处理。P0-0 方案已获用户明确批准，依据见 [P0-1 授权记录](docs/P0-1/00-authorization.md)。数字 OTP 注册因发信域名问题经用户决定暂缓验证；测试账号为明确授权的 Admin 夹具，不能冒充注册通过。不实现几何编辑、测量回复或成果发布。

## 运行

需要 Node **24.15.0**（`.nvmrc`）、npm **11.12.1**。统一 npm；不用 pnpm/yarn，不修改全局 registry。依赖精确版本与 `package-lock.json` 一并管理。

```powershell
npm ci
npm run dev
# http://127.0.0.1:3000
```

用 `Copy-Item .env.example .env.local` 创建本地配置；示例所有凭据均为空。正式流程需要受限 PostgreSQL runtime/worker 连接、CA、Auth 和服务端 Storage key，以及独立 ClamAV。不要提交 `.env.local`、数据库密码、分享令牌或服务端密钥。`GET /api/health` 只表示 liveness，database=not-probed，不能作为业务验收。

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

`test:e2e` 自动在3100启动已构建服务器，覆盖公开UI、无效链接和基本拒绝；真实业务脚本在3000另跑。Pixel7只是viewport，不能代替真机。Vitest覆盖文件边界/ZIP/大小及健康契约。全程无Docker。运行、迁移、worker与脱敏结果见 [实现说明](docs/P0-1/01-implementation.md)、[文件与migration](docs/P0-1/02-files-and-migrations.md)、[验证报告](docs/P0-1/03-verification.md)。

## 审阅入口

1. [范围与 PRD 对照](docs/P0-0/00-baseline.md)
2. [依赖、兼容与许可证核对](docs/P0-0/01-dependencies.md)
3. [架构、关系与安全基线](docs/P0-0/02-architecture-security.md)
4. [路由与接口契约](docs/P0-0/03-api-contracts.md)
5. [图像坐标与早期验证计划](docs/P0-0/04-images-and-spikes.md)
6. [双端交互提案与待决策项](docs/P0-0/05-interaction-proposal.md)
7. [migration 流程及回滚](docs/P0-0/06-migrations.md)
8. [实际检查、审批和外部验证状态](docs/P0-0/07-verification.md)
9. [事务适配器、上传worker及孤儿清理决策](docs/P0-0/08-runtime-decisions.md)
10. [无Docker云服务实验及邮件配置现状](docs/P0-0/09-cloud-service-lab.md)
11. [独立Konva/EXIF实验结果](docs/P0-0/10-konva-experiment.md)

`supabase/drafts/` 留作历史架构草案，未整份应用。本阶段按范围建立正式migration，仅应用到已授权ref `rvysclscetfqicpnzlra`，业务位于私有pm schema，不部署本机auth/Storage替身。云端version与本地SQL/hash核对见本阶段报告；不操作生产，不自动进入P0-2。

独立实验不进入业务路由：

```powershell
npm run lab:images
npm run lab:konva:build
npm run lab:konva:test
node scripts/labs/record-konva.mjs
```

`partmeasure-p0-0-lab`继续复用，不按阶段删除或重建。P0-0的07～10是当时历史状态；最新批准和验证以docs/P0-1为准。敏感配置/账号/会话只存ignored tmp与.env.local，邮件脚本不自动重发。大陆手机网络按用户决定延至P0最终出口，当前不因此阻断。

本机目录归属为 Administrators，Git可能报dubious ownership。可仅对当前命令使用`git -c safe.directory=D:/PartMeasure status`（或log/diff），无需修改全局safe.directory。初始目录无Git，现建立本地历史；没有配置远程或推送。
