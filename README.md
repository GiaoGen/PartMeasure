# PartMeasure · V1

2026-10-26：P3-01/02/03已有代码交付，P3-04补运行及受控备份恢复；实际手机、云端权限/文件和OTP等欠项仍按阶段记录保留。**当前运行入口以[运行与恢复手册](docs/operations/runbook.md)为准**；[P3-04记录](docs/P3-04-operations-recovery-2026-10-26.md)区分本地恢复和真实云端欠项。旧Preview不能代表当前未提交工作区，也不代表当前版本已发布。

2026-10-20：已按轻量作品方向改为[请求内完成上传](docs/lightweight-upload.md)，**正常运行不需要独立Worker、ClamAV或另租处理服务器**。格式/大小/hash与权限校验保留，不进行病毒扫描；旧文件和标注坐标不改写。下方阶段报告中的Worker部署说明属于历史方案，不再作为运行前提。

历史P0-4范围：在既有认证、文件、标注和测量审核基础上，新增私有交付草稿、多附件原子发布、不可覆盖成果集合和受控下载，见[当时阶段授权](docs/P0-4/00-authorization.md)。后续阶段以PRD和各阶段最新授权/记录为准。数字OTP真实注册仍待验证，正常测试账号密码登录不能代替注册通过。

历史证据：[实现与契约](docs/P0-4/01-implementation.md)、[人工与大陆手机清单](docs/P0-4/02-manual-checklist.md)、[实际验证/已知问题](docs/P0-4/03-verification.md)、[P0总验收表](docs/P0-4/04-p0-exit-matrix.md)、[当时测试部署](docs/P0-4/05-deployment-runbook.md)。其中旧staging的通过结果只对应当时源码，不扩为当前版本或手机/大陆网络/OTP通过。

[P0 缺失实现与验收缺口清单](docs/P0-4/06-p0-gaps.md)分别列出尚未落实的运行配置、已实现待验证项目、历史质量风险及不属于 P0 的后续能力，供收尾排期使用。

2026-10-19 后端对齐历史：[授权与边界](docs/backend-alignment/00-scope.md)、[接口与前端接入契约](docs/backend-alignment/01-contracts.md)、[当时验证](docs/backend-alignment/02-verification.md)。文件夹、搜索、归档与前端统一的当前状态见PRD及P2/P3记录，不沿用旧“前端仍待接入”作为当前待办。

## 运行

需要 Node **24.15.0**（`.nvmrc`）、npm **11.12.1**。统一 npm；不用 pnpm/yarn，不修改全局 registry。依赖精确版本与 `package-lock.json` 一并管理。

```powershell
npm ci
npm run dev
# http://127.0.0.1:3000
```

用 `Copy-Item .env.example .env.local` 创建本地配置；示例所有凭据均为空。需要受限 PostgreSQL runtime连接、CA、Auth、服务端Storage key；现有SSE事件使用runtime的session连接`EVENT_DATABASE_URL`，不依赖上传消费者。已有本地配置保留即可，旧Worker/ClamAV变量不再使用。不要提交配置、密码、分享令牌或服务端密钥。`GET /api/health`只表示liveness，不能作为业务验收。先应用已授权隔离库的正式migration，再启动新代码；现有隔离库已应用轻量上传迁移。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run start
npm run ops:status
npm run licenses
```

正常dev默认3000，不占用或停止其他应用。`ops:status`默认只报告配置是否存在，不发送邮件、不探测业务网络；维护/备份命令详见当前手册。全程无Docker，不启动旧Worker/ClamAV脚本。`test:e2e`及旧业务/浏览器脚本仅在相应明确授权内运行；手机viewport不能代替真机。历史[P0-1实现](docs/P0-1/01-implementation.md)和[文件迁移](docs/P0-1/02-files-and-migrations.md)不作为旧Worker启动依据。

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

`partmeasure-p0-0-lab`继续复用，不按阶段删除或重建。早期文档保留当时状态，当前以PRD、后续阶段明确授权/记录及运行手册为准。敏感配置/账号/会话只存ignored tmp与.env.local，邮件脚本不自动重发。大陆手机网络仍属P0出口/发布前欠项，不能据数据库可访问宣布整站通过。

本机目录归属为 Administrators，Git可能报dubious ownership。可仅对当前命令使用`git -c safe.directory=D:/PartMeasure status`（或log/diff），无需修改全局safe.directory。初始目录无Git，现建立本地历史；没有配置远程或推送。
