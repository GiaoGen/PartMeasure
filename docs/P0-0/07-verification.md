# P0-0 交付、实际检查与审批登记

日期：2026-10-16（Asia/Taipei）。**P0-0尚未验收通过**：已完成可审阅工程/方案，架构权限与交互审查没有项目所有者批准记录。没有开展P0-1～P0-4的业务实现，没有远程数据库变更或生产部署。

## 已完成与实际执行

| 检查 | 实际结果 | 覆盖范围/证据 |
|---|---|---|
| 根PRD、仓库与AGENTS | 已读；初始只有PRD、非Git仓库，无项目AGENTS | 00文档；PRD未改；新增项目约束及Next自动生成的版本文档指引 |
| 官方依赖/兼容/许可证 | 已核对并精确固定，统一npm | 01、THIRD_PARTY_NOTICES、registry/official-docs/licenses证据；传递依赖非全MIT |
| `npm ci --no-fund --fetch-retries=1 --fetch-timeout=30000` | exit0；108包安装，审计109包，0已知漏洞 | 锁文件可干净安装；不同平台optional安装数不同 |
| `npm run lint` | exit0；Biome recommended检查14个源/配置文件，0问题 | 不把关闭lint当通过 |
| `npm run typecheck` | exit0；`next typegen --webpack && tsc --noEmit` | TS strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes；先typegen支持新checkout |
| `npm test` | exit0；1 test / 1 file通过 | 无凭据健康响应、数据库未连接标志、no-store；不代表业务单测 |
| `npm run build` | exit0；Next16.4.2 webpack生产构建 | `/`静态基础标记，`/api/health`动态；生成404为框架默认 |
| `npm run dev -- --port 3101` | Ready 691ms；根页与健康HTTP200 | 正常本地权限下实际访问后已停止；开发/生产都webpack |
| `npm run test:e2e` | exit0；2通过（桌面Chromium/Pixel7 viewport） | 基础页标题、健康body、no-store/no-referrer；仅Chromium仿真，不是实机/业务闭环 |
| `npm run test:e2e:list` | 2个基础测试可发现 | 两个project使用同一基础用例 |
| `npm audit --json` | exit0；0 low/moderate/high/critical | `docs/evidence/npm-audit.json`；已知公告时间点，不是无漏洞保证 |
| `npm run licenses` | exit0；203个lock条目均有SPDX声明 | `docs/evidence/licenses.json`；CLI包未附根许可证文本，见下方限制 |
| `npm ls --depth=0` | exit0；版本与lock一致，无invalid peer | npm/Next在Windows clean install后仍显示两个optional wasm包extraneous，见下方说明，不伪报全树完全clean |
| 固定Supabase CLI help/init/migration new | exit0，生成本地配置和空history marker | `supabase/migrations/20261016085629_infrastructure_baseline.sql`；没有应用业务schema |
| 本机PostgreSQL18.4草案结构检查 | exit0；20项PASS，临时集群已停止 | `scripts/check-sql-draft.ps1`、`tests/sql/draft-smoke.sql`、`docs/evidence/sql-draft-check.txt`；auth.uid/storage.buckets为stub |

本机结构检查覆盖：16业务表RLS开启；private bucket元数据上限；Owner A/B及子表隔离；Owner不可直写/读分享哈希；anon无表权限；跨项目annotation/response拒绝；测量需目标；回复/几何修订/历史文件/标准图尺寸不可静默改；发布版本和附件集合不可变；版本及幂等作用域唯一。**没有**验证真实Supabase HTTP、Guest验证代码、撤销竞态、Storage策略、事务RPC、扫描器和额度worker。

## 工具链发现与限制

- npm沙箱DNS拒绝外网，已通过自动审查的正常本地网络安装官方registry依赖；未改全局registry。GitHub raw/CLI LICENSE链接未能取得许可证原文，官方npm manifest声明MIT；发布/再分发CLI二进制前补齐上游通知。其余直接依赖可检查到包内许可证文件hash。
- ESLint候选有peer冲突及5项high依赖公告，已移除该链改用Biome；最终安全报告0。TypeScript7已调研，最终固定实际验证的6.0.3。没有force忽略peer。
- Turbopack CSS子进程错误在沙箱与正常权限均出现；webpack构建已实际通过，所以固定官方回退。该问题不再阻止本基线运行，未来是否恢复Turbopack另评估。
- 沙箱不能访问127.0.0.1，也影响浏览器启动等待；实际Playwright/SQL/开发访问在正常本地权限下运行。PowerShell的进程等待和psql NOTICE处理问题已修正。早期失败不计PASS，表中只记录最终实际结果。
- 两个optional包`@emnapi/runtime@1.11.3`、`@img/sharp-wasm32@0.35.5`在npm ci后由依赖安装链保留，并被npm ls标为extraneous；它们已在lock/licenses清单中，未手改node_modules隐藏告警。无peer冲突，构建和测试正常；后续npm/Next升级时复核该元数据行为。
- Docker daemon未运行；Supabase本地全栈、迁移history回放、db lint/advisors未执行。不能用本机PG18+stub替代PG17托管/Auth/Storage测试。
- Playwright仅安装并运行Chromium；Firefox、WebKit、真实Chrome/Edge/iOS/Android/微信兼容未验证。NO_COLOR/FORCE_COLOR提示来自执行环境，不影响测试结果。

## 主要变更

- 保留PRD原文件；新增npm精确依赖/锁、Node版本、环境示例、ignore、TS/App Router、Tailwind PostCSS、Biome、Vitest、Playwright和无外部依赖健康路由。
- 新增架构/权限、路由DTO、图像契约与Spike计划、交互低保真、审批表、migration与恢复说明；SQL独立于自动执行目录。
- SQL采用真实关系与跨项目FK，追加历史、发布保护、只读Owner RLS和默认拒绝Guest直连。**方案尚未批准，缺少正式事务与完整约束，不得直接上线**。
- 新建本地Git历史以便审阅，没有关联/推送远程；提交ID在最终交付消息及`git log -1`中查看。
- 本机目录的Administrators归属触发Git safe.directory检查，使用命令级`-c safe.directory=D:/PartMeasure`，未改全局信任设置。未发现用户Git作者配置，本次提交使用`Codex <codex@local.invalid>`标记代理产物，不冒用用户身份。
- 提交前检查未发现私钥或真实secret key；新增文件`git diff --cached --check`通过。原PRD自带3处Markdown行尾双空格（硬换行）原样保留，因此检查排除该原文件；SQL日志只去除表格行尾空白，保留实际结果。

## 待审批

| 项目 | 状态 | 审查入口 |
|---|---|---|
| 架构、关系与安全策略 | pending，无批准人/时间 | 02及SQL草案，重点是服务端写入路径、撤销与签名窗口 |
| API/annotation与图像契约 | pending | 03、04，含固定revision/归一化规则 |
| UI-01～05双端主方案 | pending | 05，含两Section、空项目/待测双路径、四项禁令证据 |
| SEC/FILE/OPS具体选项 | pending | 05末表，含30天链接、代理下载、格式配额、实测阈值 |
| P0-0阶段验收 | 未通过/待审查 | 工程运行通过不等于完整P0-0验收 |

PRD §8.3/§12及本次用户指令要求明确批准正式交互方案；当前没有授权实施业务UI。本报告只交付审查材料，不把“收到文档”当批准，不以本次提交自动启动P0-1。

## 待外部验证/阻断

| 事项 | 缺少条件 | 后续证据要求 |
|---|---|---|
| Supabase集成/RLS/Storage/迁移恢复 | 可用Docker本地栈，或明确授权的隔离测试项目与凭据 | 两Owner+无登录Guest、真实私有对象、拒绝越权、撤销/并发/幂等、up/down恢复、advisors/lint输出 |
| 邮箱OTP | 测试邮箱/SMTP资源和隔离Auth环境 | 投递、过期、重复、登出恢复、中文模板/Free限制 |
| 安全上传/成本窗口 | 实际Storage配额/套餐、扫描及图像worker、授权测试文件 | magic/解码/限额/断点恢复、撤销后finalize拒绝、2h/24h旧凭证窗口和清理实测 |
| React Konva/EXIF | 独立实验授权、方向样本、真实手机与工程师操作 | 04的矩阵、定位误差/FPS/内存、原件/派生图hash |
| 中国大陆网络 | 大陆城市/三运营商SIM、无VPN真机、授权预发域名 | 登录/分享/上传/回复/私有下载/断网恢复原始记录，失败根因和部署评估 |
| 完整业务与视觉验收 | UI/架构批准及P0-1～P0-4后续授权实施 | PRD §10完整用例，真实持久化数据，截图/录屏对照批准方案 |

以上均未实测，状态是待验证；没有模拟业务PASS。无远程数据库/生产部署行为。缺少外部条件不妨碍本次文档与基础代码审阅，但阻止相应集成/实机结论。
