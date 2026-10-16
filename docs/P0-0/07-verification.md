# P0-0收尾验证与验收准备

日期2026-10-16（Asia/Taipei）。基线提交`a9bdc83`；本轮收尾提交ID见`git log -1`与交付消息。**P0-0尚未获用户验收，架构/安全/交互方案仍待明确批准。** 没有提前实施P0-1～P0-4或正式业务UI，没有操作既有生产项目或部署生产，全程不使用Docker。

## a9bdc83之后的实际范围

开始时没有新提交，工作树仅`next-env.d.ts`从`.next/types`变为`.next/dev/types`的Next生成变化。未把它当用户手写代码覆盖；正常typegen/build后回到原基线内容。主应用`src/app`、原PRD及未批准的业务SQL草案保持不变。

新增的是独立实验与可复跑脚本：`experiments/konva`（单独Next应用与输出目录）、`experiments/cloud`（极小真实服务SQL/邮件模板候选）、`scripts/labs`、`tests/konva`；显式固定实验dev依赖Sharp0.35.5并提交lock。补齐无Docker流程、明确PG事务适配器推荐及worker/孤儿清理方案。所有业务选择均停留在文档待审批。

## P0-0已通过的检查

| 实际执行 | 结果 | 证据和准确覆盖范围 |
|---|---|---|
| 根PRD、AGENTS与P0-0全部方案复核 | 完成 | 重点§4～6、8～10、12；未覆盖原PRD |
| `npm run lint` | exit0，最终31源/配置文件，0问题 | Biome recommended，warning即失败；实验脚本也检查 |
| `npm run typecheck` | exit0 | `next typegen --webpack && tsc --noEmit`；strict与额外空值/索引约束保留 |
| `npm test` | exit0，1/1通过 | 基础健康响应/no-store/数据库未连接标记，不代表业务 |
| `npm run build` | exit0 | 主应用webpack生产构建，只有`/`、框架404、动态`/api/health` |
| `npm run test:e2e` | exit0，2/2通过 | 主应用生产构建；桌面/Pixel7 Chromium viewport基础页与健康契约 |
| `npm run lab:images` | exit0，16份合成图断言通过 | EXIF1～8×横竖图，独立角点oracle、尺寸/metadata/再次标准化稳定性 |
| `npm run lab:konva:build` | exit0 | 独立Next生产构建，无SSR window或native canvas错误 |
| `npm run lab:konva:test` | exit0，36/36通过，0跳过/失败/flaky | DPR1/2，线圆点、逆矩阵、缩放/平移/旋转、resize、真实Canvas像素、修改后JSON保存/刷新恢复 |
| `node scripts/labs/record-konva.mjs` | exit0，36条真实结果记录 | `docs/evidence/closeout/konva-browser.json`，约18.6秒 |
| `npm audit --json` | exit0，0项已知漏洞 | `docs/evidence/closeout/npm-audit.json`；不是安全保证 |
| `npm run licenses` | exit0，203个lock条目有SPDX | 原清单更新Sharp直接dev依赖；LGPL/MPL/CC-BY等传递通知保留，CLI根LICENSE缺项仍见01 |
| 组织指定、Free核价、新云项目 | 完成，$0/月 | 用户指定MESS's Org；`partmeasure-p0-0-lab` / `rvysclscetfqicpnzlra` / 东京 / PG17.11 |
| MCP真实系统与实验配置核对 | 通过到**配置层** | auth/storage真实存在；仅`p0_lab_records`及私有实验桶；7策略；0实验行/对象；不是上传下载或A/B权限PASS |

本机PG替身的原20项检查是`a9bdc83`历史结构证据，本轮不冒充重跑，不部署云端。真实Chrome/Edge/Safari/Android/微信手机和大图性能均未验证。独立实验不是正式标注器、数据库保存或跨设备业务验收。

云端只执行本轮授权的独立实验migration `20261016093639 / p0_0_isolated_service_lab`；未部署应用空marker或业务草案。实验表/桶/策略保留以便后续复用。安全advisors仍有1项warning：[Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)，没有宣称云端零告警。

## 邮件与真实服务验证：待完成，不标PASS

两个邮箱经用户确认（B拼写更正）后，只发送过2个被接受的登录邮件请求。默认`signInWithOtp`发Magic Link；未先解释模板/配额就发送是本次流程失误。用户收到邮件并点击后，保存在ignored文件的原始链接各返回`403 otp_expired`；云端聚合显示2用户email_confirmed，但脚本没有取得可用session，不能当登录通过。

MCP无SMTP/模板接口，浏览器控制初始化失败；用户检查Dashboard确认“set up custom SMTP to edit source”。数字码需自有SMTP后把Magic Link/Confirm signup改为`{{ .Token }}`正文。用户决定**暂不配置，记录验证码验证待完成**，所以没有改模板、配SMTP、使用Admin凭证或重发邮件。

`services.mjs`准备了真实Auth getUser、A/B行隔离/伪造owner拒绝、私有Storage正向/拒绝及清理，但**尚未执行**；其存在不算测试通过。缺少session是明确前置条件，不以MCP高权限查询/SET ROLE模拟替代。数字OTP送达、A/B及Storage完整服务实验均待用户恢复验证。详见09与脱敏`auth-request/verify-*.json`。

凭据、邮箱、登录链接、refresh/access token只存ignored本地配置/输入；错误只输出白名单status/code，不输出SDK响应/堆栈或URL。已消费输入处理后删除；没有把凭据写进提交。

## 尚需用户批准的具体决策

| 决策 | 当前推荐 | 审查入口/范围 |
|---|---|---|
| ARCH-01 | 服务端PostgreSQL事务适配器、受限非bypass runtime角色、transaction pooler | 08；不是RPC与适配器并行写入，业务SQL须后续获批修订 |
| UI-01～05 | 工程师桌面三列/窄屏单目标、客户三条回复方式、冷灰白纯蓝、submitted修改与归档规则 | 05；仅两Section，正式UI未实施 |
| SEC-01/02 | 链接30天、会话24h、每次核撤销；受控下载代理优先 | 02/05；短签名下载备选有残留窗口，上传grant2h/TUS24h另计 |
| FILE-01/02、IMG-01 | 初始格式/大小/配额、客户标准图/Owner原件、Sharp标准化及历史版本 | 02/04/08；实验成功不等于生产管线批准 |
| OPS-02、FILE-03 | 常驻Node worker、资源/托管/费用、扫描器、ZIP边界及清理租约/重试 | 08；没有部署或新增费用 |
| OPS-01（延期部分） | 大陆实测指标与测试样本 | 用户已决定UI可操作后、P0最终验收前；阈值仍待审查 |
| P0-0验收 | 在上述方案审查及暂缓验证边界被接受后由用户明确决定 | 本报告不替用户签收 |

“收到方案”或“继续执行收尾”不等于批准正式业务UI/数据库方案。本轮明确授权仅覆盖隔离服务实验与独立Canvas实验。

## 需后续业务实现才可验证的项目

| 阶段 | 验证项目 | 为什么本轮不算未完成业务阻断 |
|---|---|---|
| P0-1 | 正式SSR邮箱OTP/回调/Cookie恢复、项目归属、Guest链接校验撤销、真实业务文件网关/上传管线/限额 | 本轮无这些应用代码；服务实验不能代替，也不要求提前实现 |
| P0-2 | 获批标注交互、revision保存、Guest只读、真实照片标准化与跨设备位置、手机手势/大图性能 | 独立固定几何实验已完成基础风险验证，业务保存仍属P0-2 |
| P0-3 | 三类回复、重测/确认历史、真实多表事务/竞态/幂等 | ADR供审查，不提前写业务 |
| P0-4 | 正式多附件交付、不可覆盖发布、真实端到端闭环 | 未实现交付不能拿模拟流程冒充验收 |
| P0最终出口前 | 大陆真实手机网络登录/上传/回复/下载 | 按用户决定延期，当前**不是P0-0阻断** |
| P2/P3 | 导出、完整版本UI、生产备份恢复/发布与全浏览器质量 | 对应阶段另行授权与验证 |

只记录用户已确认**数据库可访问**；没有扩展为大陆Auth/Storage/整站通过。当前开发机使用系统代理连通服务也不提供大陆移动网络证据。

## 真正影响进入P0-1的事项

1. **必要审批仍缺失**：架构/权限与ARCH-01需明确批准，才能实施业务schema/事务；涉及P0-1新交互时，需对应UI方案批准。可以批准后先做不依赖UI的后端工作，不要求先实现所有P0。
2. **SMTP和会话验证缺口是局部前置条件**：用户已选择暂缓，它阻止数字OTP及完整A/B/Storage服务实验被标通过，也会阻止P0-1邮箱登录能力验收；不自动扩大为所有P0-1技术工作的硬阻断。能否接受该暂缓条件并批准阶段，由用户决定，当前未获验收。
3. 本轮适用的本地工程/Canvas检查没有未修复失败。无Docker、没有正式业务UI、未完成后续业务、未做大陆手机测试，均不能被额外列作强迫提前实现全部P0的理由。

## 项目复用与交付状态

`partmeasure-p0-0-lab`是隔离测试环境，P0-0是创建阶段标记，**不计划阶段完成即废弃**。可持续复用于P0-1～P0-4测试；不每阶段重建、不擅自删除/改名。若用户希望可另改显示名`partmeasure-test`，ref不变。正式业务migration获批后，先清理或明确隔离旧实验策略/对象；生产须另建环境、凭据和发布授权。当前2用户、0实验行、0对象及私有桶配置见`closeout/cloud-inventory.json`。

主PRD和`src/app`未变，未批准草案未应用；提交包含文档、独立实验、锁和脱敏证据。Git目录归属问题继续使用命令级`-c safe.directory=D:/PartMeasure`，不改全局信任。提交前检查变更与密钥，工作树状态和最终commit在交付时报告。完整细节见06（无Docker）、08（运行决策）、09（云服务/邮件）、10（Canvas）。

提交前对76个非ignored文件与本地配置中的真实key/测试邮箱精确比对，并扫描私钥/JWT格式：0匹配；确认私密config及生成图片被ignore，`git diff --check`通过。Next生成文件未被手工覆盖为新业务实现。
