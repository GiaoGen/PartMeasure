# PartMeasure · P0-4

当前范围：在既有认证、文件、标注和测量审核基础上，新增私有交付草稿、多附件原子发布、不可覆盖成果集合和受控下载。用户已确认P0-3人工验收并授权P0-4，见 [阶段授权](docs/P0-4/00-authorization.md)。本轮停在P0-4验收，不自动进入P1/P2。数字OTP注册仍按此前决定待验证，正常测试账号密码登录不能代替注册通过。

最新：[实现与契约](docs/P0-4/01-implementation.md)、[人工与大陆手机清单](docs/P0-4/02-manual-checklist.md)、[实际验证/已知问题](docs/P0-4/03-verification.md)、[P0总验收表](docs/P0-4/04-p0-exit-matrix.md)、[无Docker运行/测试部署](docs/P0-4/05-deployment-runbook.md)。[HTTPS staging入口](https://partmeasure-staging-em72unjso-messup-s-projects.vercel.app/login)已跑通真实闭环；P0-4实现与整个P0验收分别记录，真实手机/大陆网络和OTP未验证时不能宣称整个P0通过。

[P0 缺失实现与验收缺口清单](docs/P0-4/06-p0-gaps.md)分别列出尚未落实的运行配置、已实现待验证项目、历史质量风险及不属于 P0 的后续能力，供收尾排期使用。

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

`test:e2e` 自动在3100启动已构建服务器，覆盖公开UI、无效链接和基本拒绝；P0-4真实业务脚本在3001另跑，见部署运行文档。正常dev默认3000，本次该端口被其他应用占用，未停止它。手机viewport不能代替真机。Vitest覆盖文件边界/ZIP/大小、归一化几何、测量审核和交付DTO。全程无Docker。基础认证/文件运行与worker说明沿用 [P0-1实现](docs/P0-1/01-implementation.md) 和 [文件与migration](docs/P0-1/02-files-and-migrations.md)。

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

`supabase/drafts/` 留作历史架构草案，未整份应用。本阶段正式migration只包含成果用途、delivery/delivery_files、发布原子性/不可变/权限和worker分支修复，应用到已授权ref `rvysclscetfqicpnzlra`。业务位于私有pm schema，不部署本机auth/Storage替身；云端version与本地SQL/hash核对见P0-4证据。既有生产项目未动；新建Vercel测试站曾因目标异常暂停，用户明确批准恢复后，当前仅以已核对的最新staging做验收，详见部署记录。

独立实验不进入业务路由：

```powershell
npm run lab:images
npm run lab:konva:build
npm run lab:konva:test
node scripts/labs/record-konva.mjs
```

`partmeasure-p0-0-lab`继续复用，不按阶段删除或重建。早期文档保留当时历史状态，最新批准和验证以docs/P0-4为准。敏感配置/账号/会话只存ignored tmp与.env.local，邮件脚本不自动重发。大陆手机网络已安排在P0最终出口清单，当前等待有效HTTPS入口和实测结果，不能据数据库可访问宣布整站通过。

本机目录归属为 Administrators，Git可能报dubious ownership。可仅对当前命令使用`git -c safe.directory=D:/PartMeasure status`（或log/diff），无需修改全局safe.directory。初始目录无Git，现建立本地历史；没有配置远程或推送。
