# P0-3 实际验证与验收准备

当前阶段：P0-3实施与验收准备。P0-2由用户明确确认验收；P0-3尚未收到人工结果，**不宣称已验收**。无Docker、生产部署、远程推送或P0-4实现。真实服务仅为隔离项目`rvysclscetfqicpnzlra`，沿用原项目/Auth/文件/标注/Guest能力。

## 已执行检查

| 命令/检查 | 实际结果与证据范围 |
|---|---|
| `npm run lint` | PASS，102文件；使用仓库既有Biome配置 |
| `npm run typecheck` | PASS，安装版本Next生成类型+TypeScript strict |
| `npm test` | PASS，5文件39项；本阶段6项涵盖状态矩阵、正十进制、类型/附件引用、控制字段拒绝及人工来源说明 |
| `npm run build` | PASS，生产构建；未新增依赖 |
| `npm run test:e2e` | PASS，6项；公开页/登录页/匿名拒绝基础回归，不能代替业务验证 |
| `scripts/p0-3/run.ps1 -Action api` | 首轮9/10组PASS；并发组FAIL保留，见下述修复与专项复验。真实Auth、受限runtime、私有文件代理与云PG；非mock |
| `… -Action concurrency` | 修复后3/3 PASS：同时回复与同时审核各一201一409，最终每次转换只追加一条历史；见[concurrency.json](../evidence/p0-3/concurrency.json) |
| `… -Action db` | 7/7 PASS：新表RLS/角色授权、Guest伪造拒绝、固定目标/历史不可变、回复及审核缺头状态更新事务回滚、禁止迟挂附件、本地/云端migration完全一致；见[db.json](../evidence/p0-3/db.json) |
| `… -Action browser` + `browser-photo` | 分段业务复验PASS，见[browser-summary.json](../evidence/p0-3/browser-summary.json)：正常UI登录/固定请求创建、390×844客户目标与数值提交/刷新、工程师人工修正/Guest确认历史，以及真实私有照片上传→安全处理→仅照片回复→人工确认。前三条在第五轮通过，照片单独复验2/2；不是首轮整套全绿 |

真实API通过内容见[api-first-run.json](../evidence/p0-3/api-first-run.json)：

- 正常A/B密码登录、项目与Guest私有图片访问可支撑本阶段；新会话能恢复追加历史。
- 创建请求引用标注修订；随后修改标注，新请求目标快照不变。
- 数值+证据回复、原幂等键重放、不一致载荷拒绝、采用原数值确认。
- 仅照片回复，不填数值；工程师依据照片人工录入并保留来源和说明。
- 无法测量→重测→再次提交→人工修正，原回复、证据和审核事件均追加保留。
- 旧文件comment直接文字回复、确认已处理，不要求geometry/value。
- Guest创建/审核/管理拒绝；Owner B不能访问A项目；非法控制字段、负数/科学计数法、未处理/缺失/非图片photo附件以及真实其他项目文件拒绝，未留下部分历史或状态。

## 失败与修复，不抹去首轮

首轮真实并发遭遇Postgres `55P03`（2秒锁等待超时），一请求503，未达到应有201/409。适配器仅对已回滚SQLSTATE55P03加有限重试（最多2次，沿用40001/40P01策略）；未知网络/提交结果不自动重放。专项真实并发复验3/3 PASS；未将`api.json`中的首轮FAIL改成PASS，也不以此声称历史偶发401/503的所有根因已关闭。

浏览器前轮失败原因包括：密码label包含说明、select标签包含选项文字、目标区域还含上传组件h2导致定位不唯一。均为脚本定位问题，修正为实际可访问标签/明确标题。多轮脚本原来每轮API和页面各登录一次，触发现有每邮箱十分钟5次限流；保留429，等待窗口自然结束，改为仅一次正常UI登录并复用同一会话；没有重置计数、提升限额或认证旁路。当前正常UI登录和创建请求已验证成功。历史结果在`browser-first/second/third-run.json`保留。

第四轮定位错误以及第五轮真实503也分别保留。第五轮前三条PASS；照片场景在打开源图时遇到503，上传尚未开始。本地worker进程此前退出（只输出脱敏WORKER_FAILED，未确定根因），核对ClamAV监听后重新启动现有worker。照片专项复验通过：真实上传的新PNG经ClamAV/独立图像处理→标准图ready，首次处理成功无错误；客户提交时不含数值，工程师看见真实私有缩略图并人工确认来源owner_from_photo。专项期间仍有一次Guest文件列表503，随后onReady正常读取并完成流程，记录未隐藏。当前能够完成业务流程，**偶发503及worker长时运行稳定性仍需观察**；没有把恢复后的PASS当作全部稳定性根因已解决，也没有自动调高限流或放宽安全处理。

性能顾问发现最新回复复合FK未完整覆盖，补充`20261017152616_p0_3_issue_response_index.sql`并通过顾问复查。首次补充使用已有单列索引名，返回42P07且未应用；核对后使用独立复合索引名，不改写已应用migration。两份migration云端version/source/hash见[migration.json](../evidence/p0-3/migration.json)。CLI首次受本机telemetry写权限限制，获授权工具环境重试创建，不使用Docker。

## 安全顾问与运行限制

[advisors.json](../evidence/p0-3/advisors.json)：安全顾问仅保留既有泄露密码保护WARN，参见[官方处理说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。本阶段未擅改Auth套餐/配置。性能顾问只剩8条unused index INFO（测试负载尚不足，不据此删除权限/历史关联索引），缺外键索引提示已消除。unused index说明见[官方文档](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。

密钥、密码、OTP、DB URL、Guest令牌只保存在ignored本地配置；不采集trace/HAR。当前提交候选和`.next/static`扫描PASS，见[secret-audit.json](../evidence/p0-3/secret-audit.json)，提交前再次核对。截图肉眼查看无分享地址/凭据，失败登录截图已遮住输入。扫描不等于对全部历史或像素做OCR。

## 人工与外部待验证

[5～10分钟清单](02-manual-checklist.md)：测量位置和量具说明是否清楚，三种回复/勾选证据是否顺手，原回复与人工确认来源是否易懂，重测原因是否明显，布局/键盘/真实触摸。未收到人工结果不写PASS。浏览器390×844触摸viewport只是自动化；真实手机需要可访问的获授权HTTPS测试入口，当前localhost不满足。

`… -Action seed`实际PASS，已通过正常API准备5条「试用 ·」任务：数值、仅照片、无法测量、文件文字问题和一条已有回复的待审核任务。[manual-fixtures.json](../evidence/p0-3/manual-fixtures.json)只保存脱敏计数。本机ignored `tmp/p0-3/manual-entry.txt`保存工程师/客户入口与凭据位置，`manual-evidence.png`为未上传的独立合成样本。没有测试认证旁路；不重复运行seed消耗人工任务。

大陆真实手机网络仍按用户决定延期至P0最终出口，不能由本机数据库可访问扩展为Auth/Storage/整站大陆通过；不阻断当前开发。真实注册邮件数字OTP送达和确认仍是此前用户暂缓项，本阶段正常密码登录不替代该项。长时间、多设备及弱网稳定性仍需后续连续观察。

## 方案差异与阶段边界

沿用已批准方案：两个主要Section、客户待测优先、三种直接回复、固定修订目标、submitted等待审核、追加回复与Owner人工确认。没有新增主要流程或需重复审批的架构决定。

实现细节：复用原UploadQueue，上传ready后明确勾选本轮证据再提交；同页历史展示原回复/证据/人工来源。确认后纠错新建请求，不改历史；标题/目标不可编辑。数值上限9位整数/6位小数、单位mm/cm/m/in，不自动换算。任务按30条分页，轮数/附件上限见实现文档。草稿仅会话内存，不承诺关闭页面恢复草稿。

视觉沿用白/冷灰/纯蓝、分隔线、目标图与操作列；没有渐变、暖黄主色、AI装饰或层层卡片。截图在本阶段evidence/screenshots，正式体验质量交人工确认。交付与版本继续显示尚未开放，不以假发布按钮扩展P0-4。

| 正式UI截图 | 内容 |
|---|---|
| [owner-create.png](../evidence/p0-3/screenshots/owner-create.png) | 从已保存标注创建固定请求，仍沿用原标注工作台 |
| [guest-numeric.png](../evidence/p0-3/screenshots/guest-numeric.png) | 手机viewport中真实目标图、三种直接回复与数值输入 |
| [owner-review.png](../evidence/p0-3/screenshots/owner-review.png) | 工程师审核与人工来源选择 |
| [guest-photo.png](../evidence/p0-3/screenshots/guest-photo.png) | 新照片处理完成、选择本轮证据并准备提交 |
| [owner-photo-evidence.png](../evidence/p0-3/screenshots/owner-photo-evidence.png) | 只读目标、原照片回复、真实证据缩略图及人工确认表单 |

当前没有阻止本阶段代码提交的功能阻断；P0-3仍停在待人工验收。已知运行风险是偶发503、worker退出后需运维恢复，尚未证明长时间稳定；真实手机、注册OTP与大陆网络未验证。新增架构/主要流程待审批项：无。人工反馈未到不写验收通过；未授权进入P0-4，没有要求提前实现交付、教程或全部P0。

Git保留最初已有`next-env.d.ts`的dev类型路径生成差异，不将其混入本阶段提交。没有提交ignored配置、账号、OTP、能力地址、node_modules或构建产物。生产构建早于最终文档/脚本整理；构建之后没有修改应用源码，因此没有无意义重复构建。
