# P0-4 实际验证与验收准备

日期2026-10-18（Asia/Taipei）。只使用隔离Supabase `rvysclscetfqicpnzlra`，无Docker。P0-3人工通过依用户明确确认记录；本轮实现、自动验证和人工/外部出口分别判断，不宣称整个P0通过。

## 已执行自动检查

| 命令 | 实际结果与范围 |
|---|---|
| `npm run lint` | PASS，123文件；新增脚本初轮有未用import/模板字符串提示，已整理后复验。命令结果汇总见[checks.json](../evidence/p0-4/checks.json)。 |
| `npm run typecheck` | PASS，Next16安装版typegen与TypeScript strict。 |
| `npm test` | PASS，7文件46项；新增交付DTO/重复附件/版本标签边界与修订头兼容/冲突/非法输入，不镜像UI编写大量测试。 |
| `npm run build` | PASS，最终上传恢复重试代码已纳入生产webpack构建。 |
| `npm run test:e2e` | PASS，6项桌面/手机viewport基础回归；公开页、登录表单、无效链接/匿名拒绝，**不等于业务闭环**。 |
| `scripts/p0-4/run.ps1 -Action api` | PASS，7组正常A/B登录、私有处理管线、草稿持久化/CAS/幂等、原子多附件发布、Guest管理拒绝/Owner隔离、并发发布单胜者/旧集合保留、刷新与撤销后拒绝下载。见[api.json](../evidence/p0-4/api.json)。此前口头将接口组数写为8；实际此脚本7组，另有下载专项，不更改证据凑数。 |
| `… -Action db` | PASS，8组真实云PG回滚检查，含RLS/最小授权、Owner隔离、已发布集合/关联/文件不可变、缺保护及空发布整事务失败、worker通用计划权限分支、本地两份migration与云source/hash一致。见[db.json](../evidence/p0-4/db.json)、[migration.json](../evidence/p0-4/migration.json)。 |
| `… -Action workflow` | PASS，3组最终HTTPS跨模块回归：工程师先传标准图再发固定目标请求、仅照片回复后人工录值及来源、无法测量→重测→数值再提交→确认且历史追加。见[workflow.json](../evidence/p0-4/workflow.json)；较早本机结果单独保留workflow-local，不是mock。 |
| `… -Action browser` | PASS，最终HTTPS 6/6段：正常UI登录/空项目创建/免账号客户上传→工程师真实画布绘线保存/固定请求→客户数值回复/工程师确认/刷新历史→Owner双文件上传/草稿保存刷新后再修改/Guest不可见→多附件发布/Guest下载7.55MiB STEP核hash/刷新→传输故障后真实重试。见[browser.json](../evidence/p0-4/browser.json)，httpFailures为空。 |
| `… -Action transfer` | PASS，最终HTTPS私有公开读取400拒绝、真实Range206/无效416、完整文件hash一致；见[transfer.json](../evidence/p0-4/transfer.json)。不输出内部签名。 |
| `… -Action probe-header` | PASS，修复版HTTPS PATCH 200、旧修订409、原未知提交幂等恢复且revision不增加；见[https-precondition-after.json](../evidence/p0-4/https-precondition-after.json)。 |
| `… -Action seed` | PASS，3条人工任务已准备；正常Auth Cookie和项目级Guest Cookie均Secure/HttpOnly/SameSite=Lax，新Guest上下文恢复已发布集合通过。见[manual-fixtures.json](../evidence/p0-4/manual-fixtures.json)。首轮脚本错用全局Guest Cookie名而断言失败，已保留manual-seed-first-attempt并修正；没有改应用权限。 |
| `… -Action soak` | PASS，12/12真实交付列表读取；仅有限观察，单次约10～16秒，不能称性能或长期稳定已通过。见[soak.json](../evidence/p0-4/soak.json)。 |

最终HTTPS入口为 [staging测试登录](https://partmeasure-staging-em72unjso-messup-s-projects.vercel.app/login)，目标staging，见[deployment.json](../evidence/p0-4/deployment.json)。以上通过的是浏览器→应用API→真实Auth/受限PG/私有Storage/本机安全worker，不以健康检查或mock代替。唯一传输故障专项主动中断一次下载，恢复后仍访问真实服务并核hash；其余闭环无mock。手机viewport不是实机，合成STEP/照片不是真实工程质量证明。P0-1/2/3历史证据按原报告复用，不覆盖其首轮FAIL/待验。

稳定人工入口（含客户能力地址）和正常凭据位置只保存在ignored `tmp/p0-4/manual-entry.txt`。已准备「人工 · 数值回复」「人工 · 仅照片与人工确认」「人工 · 无法测量与重测」及两份未上传合成PNG，用户可按清单集中试用；当前未收到本阶段人工反馈，均记待验。扫描器/worker为后台隐藏本地进程，需在试用期间保持电脑在线，不能把网页部署称作worker已托管。

## 真实失败与修复

首次API前置503保留在api-first-attempt；后续登录和项目创建成功，上传进程被本机网络沙盒EACCES拒绝，后继依赖用例随之失败（api-second-attempt）。获工具联网授权后真实管线通过，没有改凭据或降低TLS。中断后3000由其他应用占用，CSRF路径404/非JSON，保留api-resume-port-failure；核对进程后改3001，未停止其他应用。

浏览器首轮未展开既有分享设置，第二轮未展开手机任务列表；都属于脚本定位错误。修正定位并复用已真实保存的前置资料，未改业务来迎合测试。browser-first/second-attempt保留原失败；各分段证据与汇总说明真实覆盖范围，不声称首轮全绿。

本轮关键真实缺陷：worker插入material/internal成果时PG_42501。回滚复现明确是delivery_files访问检查，证据[worker-permission-before-fix.json](../evidence/p0-4/worker-permission-before-fix.json)。SQL组合AND不能充当跨权限查询的过程控制，通用计划下无关子查询仍触发权限检查。新增正式migration `20261018010435_p0_4_worker_purpose_guard.sql`，使用显式嵌套IF隔开查询；没有给worker交付表SELECT、没有SECURITY DEFINER/bypass。修复后相同回滚插入NO_ERROR，真实Owner资料完成并跑通后续测量；额外force_generic_plan覆盖通过。

诊断前次尝试postgres SET ROLE被42501拒绝，随后改为既有受限worker连接，不授角色成员权限；另一次构造复现混用了delivery记录，触发INVALID_ASSET_PURPOSE，修正测试筛选后才定位正确关系。没有把这些诊断尝试称为业务通过。

真实故障也暴露刷新后的上传队列缺少处理重试入口，已补齐；成功202后继续原任务/租约/扫描/额度结算，不重建资产。独立material任务通过正常Owner接口重试；脚本最初把202当200断言失败，但服务确已接受，之后真实流程通过，脚本期望已修正。旧失败和修复后结果分别保留。

HTTPS首轮另有真实兼容缺陷：If-Match PATCH在数据提交后返回无业务JSON的412，回读确认revision=2。主闭环初轮6/6但未覆盖草稿PATCH，API专项6/7暴露此项，两者都保留在api/browser-https-before-header-fix；没有凭初轮主流程通过忽略该缺陷。[复现](../evidence/p0-4/https-precondition-before.json)与修复后专项分别保存。当前应用及P0-4脚本改用X-PM-Revision，DB CAS/锁/幂等语义不变，服务端兼容旧头但双头冲突422。最终重新部署并完整复跑API7/7和浏览器6/6，浏览器新增真实刷新后编辑草稿，未出现412或静默覆盖。旧入口/旧客户端仍可能遭HTTP条件头处理，应使用最新测试入口。

## 部署与外部条件

用户已导入Preview配置，8项名称和目标核对通过：[preview-env.json](../evidence/p0-4/preview-env.json)。误勾Production已移除；只查名称/目标，不解密或输出。随后真实HTTPS Auth、严格TLS数据库读写、Storage签发上传/下载和可信处理均通过，运行有效性有业务证据；没有读取明文逐项比较变量，也没有将变量存在当作验收。

首次MCP显式请求preview却返回production，位于新建partmeasure-staging，未操作既有生产项目。中断后READY，先暂停并复查live=false，未用于验收。后续自动审批曾拒绝源码上传与恢复项目；用户分别明确批准后才恢复和按官方target=staging部署。暂停期间正确staging请求BLOCKED，不算成功。没有绕过拒绝换CLI/UI间接部署，也没有把未登录的CLI备用称成功。用户知晓恢复测试站也恢复旧无凭据测试构建地址；正式验收只用最新staging，不用旧构建。

HTTPS全闭环、托管Range与大文件已有上述真实证据。Secure Cookie专项/人工资料准备另见manual-fixtures结果；真实跨设备触摸、手机保存和大陆网络仍须人工补证。详见[部署运行文档](05-deployment-runbook.md)与[人工清单](02-manual-checklist.md)。本机HTTP结果没有升级为HTTPS通过，数据库可访问没有升级为整站大陆可用。

## 安全与运行限制

安全顾问仅既有泄露密码保护WARN：[官方处理说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)；未擅改Auth套餐。性能顾问仅unused_index INFO，没有缺FK索引/RLS新增问题；测试负载不足不能因此删除历史/权限索引。参见[unused index说明](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。最终快照见advisors.json。

密钥/密码/OTP/分享令牌/签名URL不进入提交或截图。只保存脱敏结果，无trace/HAR。最终候选与静态bundle扫描、截图肉眼核对另见安全证据；扫描不等于像素OCR或全Git历史审计。首次分享路径的托管日志保留/脱敏仍需要部署方落实。

最终应用源码与部署allowlist 53个文件逐一hash一致，见[source-integrity.json](../evidence/p0-4/source-integrity.json)；此后仅整理文档/脚本。保留任务开始时用户已有next-env.d.ts生成声明，恢复其dev类型引用并排除提交，未覆盖他人工作；构建会按Next惯例重新生成该声明，不属于业务源码差异。所有提交仅本地Git，无远程推送。

历史偶发503未证明所有根因关闭；本轮limited soak全成功不能覆盖长时间/弱网/全部历史风险。worker临时错误现在会退避重试，但无OS守护托管时，电脑关闭/进程退出仍需恢复。扫描失败仍隔离，不能绕过处理。病毒库更新、持续监督/告警、备份恢复演练为上线准备限制，本次未宣称通过。

真实注册数字OTP仍按此前用户决定待验；正常测试用户密码登录通过不能替代它。实机触摸/肉眼位置/下载保存及大陆五项仍待人工。无新增架构/主要交互方案待审批；部署外部授权与实际环境阻断单列。不借待验实施P1/P2。

## 正式UI截图与方案差异

| 截图 | 核对内容 |
|---|---|
| [guest-empty-upload.png](../evidence/p0-4/screenshots/guest-empty-upload.png) | 客户空项目直接上传，免账号，保留两个主Section。 |
| [owner-fixed-request.png](../evidence/p0-4/screenshots/owner-fixed-request.png) | 真实标注及固定目标请求沿用既有布局。 |
| [owner-saved-draft.png](../evidence/p0-4/screenshots/owner-saved-draft.png) | 多文件选择、说明、刷新后修订2，发布前核对。 |
| [guest-draft-invisible.png](../evidence/p0-4/screenshots/guest-draft-invisible.png) | Guest看不到草稿/私有成果。 |
| [owner-published.png](../evidence/p0-4/screenshots/owner-published.png) | V001、说明/时间/明确多附件集合、无原地覆盖入口。 |
| [guest-download.png](../evidence/p0-4/screenshots/guest-download.png) | 390×844手机viewport，真实7.55MiB下载、状态与已发布文件。 |

上述交付关键截图已肉眼查看，未见分享地址/密码/签名URL。沿用批准的交付线框，不新增主流程；白/冷灰/蓝、无渐变/暖黄主色/AI装饰，文件行与必要表单平铺，未堆叠卡片。细节是V001、最多5私有草稿与分片重试；完整版本管理、反馈/接受、打包导出未开放，页面明确提示。主观操作顺畅度仍待用户集中确认。

阶段停点：P0-4实现及自动验证完成，交人工验收；没有已知阻止已测闭环的实现缺陷，不自动进入P1/P2。整个P0仍受真实手机/大陆网络、注册OTP及上线运行准备的未验限制，不能宣称全部验收。
