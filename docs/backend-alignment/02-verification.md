# 后端对齐：验证结果与剩余接入

日期：2026-10-19（Asia/Taipei）。基线提交 `3aeff4c`，前端累计工作按启动快照保留。只使用获授权隔离 Supabase `rvysclscetfqicpnzlra`；未使用 Docker、浏览器、生产环境或新部署。

## 结果与证据

| 检查 | 实际结果与范围 |
|---|---|
| `npm run lint` | PASS，最终 158 文件；包含当前前端累计改动，但不代表前端浏览器/视觉通过。 |
| `npm run typecheck` | PASS，Next typegen + TypeScript strict。 |
| `npm test` | PASS，14 文件、83 项；其中本轮新增 9 项文件夹/创建分类/查询游标/上传策略契约测试，原前端测试保留。 |
| `npm run build` | PASS，Next 16.4.2 webpack，当前工作区构建。未部署到 Vercel，旧 HTTPS Preview 不自动具备本轮接口。 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backend-alignment/check-local.ps1` | PASS，10 组实际 DAL/原生 PostgreSQL/RLS 检查；全新本机 PG18、仅回环监听、严格 TLS。本地 Auth/Storage 是结构替身，**不证明真实 Supabase Auth/Storage**，且从未发送云端。见 [local-service.json](../evidence/backend-alignment/local-service.json)。 |
| `…/run.ps1 -Action db` | PASS，7 组真实云数据库检查；迁移内容/版本、最小授权、Owner/Guest RLS、同账号复合 FK、禁止文件夹改删、输入约束及查询计划。探针仅针对本轮 ALIGN 夹具并回滚。见 [db.json](../evidence/backend-alignment/db.json)。 |
| `…/run.ps1 -Action api` | PASS，7/7 组；A/B 正常密码登录、文件夹保存/幂等/边界/隔离、创建项目归属原子性、33 项真实 API 创建后的跨页全库搜索/字面匹配/准确计数、跨条件游标拒绝、Guest 元数据保护/管理拒绝/撤销、既有真实文件与标注提醒的只读查询。见 [api.json](../evidence/backend-alignment/api.json)。只使用纯 HTTP request context，不启动 browser。 |
| 独立图像进程 | PASS，既有合成 PNG 经实际 Sharp 输出 1200×800、image/webp、normalizationVersion=1；只将像素/派生上限改用共享常量，没有更改方向/坐标语义。未重新宣称全部 EXIF/设备均通过。 |
| `npm run test:e2e` / 浏览器 / 截图 | 未执行，遵守用户不自行打开浏览器的约束；历史 E2E/截图不充当当前新 UI 或新后端联调结果。 |
| 密钥扫描与差异检查 | PASS，441 个候选源码/文档及浏览器静态产物，未检出已配置私钥/密码/已知分享能力；非全历史/OCR审计。见 [secret-audit.json](../evidence/backend-alignment/secret-audit.json)。文档链接、差异空白与原前端文件保护另行核对。 |

原生测试覆盖：七色/重名、同键/异键并发、创建归属原子性和 Owner 隔离、超过 30 项的搜索/字面 `%_`/分页与三种计数、跨条件游标拒绝、Guest 分类隐私、真实复合 FK、按标注分页与固定修订、标注隐藏/修改后的失效摘要、分享撤销后拒绝。结构夹具是合成身份/文件，不把它算上传处理/邮件送达通过。

## 正式 migration 与安全核对

用户明确批准具体迁移后，通过 Supabase MCP 应用。云端实际版本 `20261019025932_frontend_backend_alignment`；本地尚未发布文件按同内容对齐该版本，未改写已应用 SQL。规范化 LF/去首尾空白后的本地与云端 SHA-256 一致：`c55d0dfdb0af5dcfd68dc6f123e80623cfad79b55db744c5c4688f923c1ad03d`。

新增表启用 RLS，仅受限 runtime 有 SELECT/INSERT；anon/authenticated/worker 无表权限；runtime 无 UPDATE/DELETE，且非 superuser/bypassrls。project 与 folder 用 `(owner_id,folder_id)` 复合 FK；旧项目归属保持 null，无猜测回填。没有公开桶、SECURITY DEFINER、通用业务 RPC 或客户端密钥。

真实执行计划在此小数据测试上命中 `projects_folder_owner_created` 的 Index Only Scan；不代表大规模搜索性能已验收。包含查询保持原前端语义，没有安装 trigram/全文扩展。安全顾问仍为历史 [泄露密码保护未启用 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)；性能顾问只有 [unused_index INFO](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)，未为消除提示删除索引。见 [advisors.json](../evidence/backend-alignment/advisors.json)。

开工复核 Supabase changelog（2026-10-19 读取），跟进 2026-10-12 [CBC TLS cipher 弃用](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)；沿用 Node24、provider CA 和 rejectUnauthorized=true。核对官方 RLS/最小权限文档、PG 外键索引建议及安装版 Next Route Handler/DAL 指南；没有修改依赖版本或锁文件。

## 真实失败、修复与边界

1. 首次云迁移被自动审批拒绝，要求该份具体 DDL 的明确云端批准。用户确认“批准应用到该隔离测试项目”后才重新调用同一 MCP 应用；没有换通道绕过。授权与文件版本映射见 [00-scope](00-scope.md)。
2. 本地首次启动受 Windows initdb 受限令牌阻止；随后在工具授权的正常本机环境运行。一次启动检查错误读取 pg_ctl 进程退出码，改为其 status 子命令确认；只启动/停止本轮新建的 tmp 集群。
3. 实际本地 DAL 检查发现 `SELECT … FOR SHARE` 对文件夹要求 UPDATE 权限，与仅开放创建/读取冲突。移除当前不必要的行锁；不扩大 GRANT。分类实体当前无改删，复合 FK 保护归属；本机 10 组和真实云权限探针通过。

当前测试入口为专用本地 3105，连接真实隔离服务；不占用或停止原有 3000/3001 应用。测试项目以 `ALIGN-` 标记；不删除/重分类已有项目，不改已有文件/标注/提醒来制造通过。旧 P0-4 合成夹具只作只读关联验证。

可复现运行：先配置 ignored `.env.local` 中原有隔离测试凭据和严格 TLS CA，执行 `npm run build`；独立终端执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backend-alignment/run.ps1 -Action start`，然后用 `-Action api` / `-Action db` 执行上述脚本。API 脚本每次创建独立 ALIGN 数据，避免反复运行造成无意义夹具堆积；DB 脚本只对上次 API 夹具作回滚探针。本轮没有重发注册邮件。local 检查需要本机 PostgreSQL 18 与 Git OpenSSL，重建临时集群后自动停止，不依赖云迁移授权。

## 前端未完成接入与未决业务

本轮保留原前端文件：分类仍有内存 folders/assignments，theme query 仍是外观提示；搜索仍可能只筛已加载数据；标注提醒兼容逻辑仍可能逐条取详情。**后端提供真实接口不等于当前这些 UI 已自动持久化或跨设备恢复。** 下一轮按 [01-contracts](01-contracts.md) 第“本轮不替前端完成的接入”部分切换，保留已有视觉与交互。

未实现且须先决定语义：G-04 私有标注公开修订、G-05 整图/跨图批次事务、G-06 永久编号/回填。G-07 只完成失效摘要，专用缩略派生/批量几何未新增。文件夹改名/删除/移动/排序、Guest 同色和完整 P1/P2 能力不扩展。

注册 OTP、真实手机/跨设备/当前 UI 手感、大陆移动网络及此前运行保障缺口继续待外部验证；本轮正常测试账号密码登录不是新注册验收。无新增待审批 DDL；其他主要交互与发布语义尚待决策。最终状态为“本轮明确后端项交付，前端接入与上述项分别待办”，不能宣称整个 P0 全部验收。
