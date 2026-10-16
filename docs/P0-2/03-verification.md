# P0-2 验证与交付记录

状态：P0-2 实施及验收准备，2026-10-16 开始、10-17 额度恢复后收尾；不宣称已验收。测试使用真实 Supabase 隔离项目 `rvysclscetfqicpnzlra`，名称 `partmeasure-p0-0-lab`；私有业务 schema 为 `pm`，默认 `public` 页面不显示业务资料。无 Docker、生产变更、远程 push 或后续阶段实现。

## 前置与证据边界

[prerequisites.json](../evidence/p0-2/prerequisites.json) 8/8：A/B 正常密码登录、项目归属拒绝、Owner/Guest 私有图片、Guest 会话建立。旧测试账号由 P0-1 用户授权 Admin 夹具建立，本轮没有用 Admin 替代登录；这仍不能证明新注册数字 OTP。用户已暂缓注册验证，不发信、不催 OTP。

[setup.json](../evidence/p0-2/setup.json)：正常登录创建项目，真实私有 Storage 上传、实际 ClamAV/Sharp 处理三份样本后 ready。样本是合成定位图、复用 EXIF6 合成原件、最小 STEP 文件，非真实手机或生产 CAD。EXIF1～8完整实验及正式处理管线结果复用 P0-0/P0-1 证据，不冒充本轮重测。

## 已运行检查

| 检查 | 当前实际结果与证据 |
|---|---|
| 单元测试 | `npm test`：4 文件、33 测试 PASS，含9个 P0-2 坐标/圆比例/DPR/窗口/校验用例 |
| lint / strict | `npm run lint`、`npm run typecheck` PASS |
| 生产构建 | `npm run build` PASS，Konva客户端动态加载，不引入Node canvas |
| 基础浏览器回归 | `npm run test:e2e`：桌面/Pixel7 viewport 共6 PASS，只证明基础公开页/登录表单/匿名拒绝，不当作业务验收 |
| 真实标注 API | [api-first-run.json](../evidence/p0-2/api-first-run.json)：11组中10 PASS；四类写入、人工字段、幂等、隔离、Guest拒绝、非法数据/图片版本、修订冲突、删除恢复、刷新恢复、文件问题、并发读、撤销检查 |
| 历史保护定向复测 | 首轮该组 FAIL（只有AssertionError，缺少原HTTP证据，不能推断具体根因）；[history-targeted.json](../evidence/p0-2/history-targeted.json) 两文件均409 HISTORY_PROTECTED PASS。保留首轮，不宣称稳定性根因已解决 |
| 数据库结构/RLS | [db.json](../evidence/p0-2/db.json) 5组 PASS：权限、非法坐标/绑定、图像/历史不可改、Guest上下文读写、migration同源；写测试回滚 |
| migration | [migration.json](../evidence/p0-2/migration.json) 版本及SHA-256与云端历史一致，无未来草案/本机Auth替身 |
| 实际页面核心 | [browser.json](../evidence/p0-2/browser.json) 中绘制/人工字段/删除撤销重做、拖动后保存与缩放resize实际点击定位、刷新及修订预览3组 PASS；该完整运行仍有失败，不改写为整轮通过 |
| 失败重试与并发 | [browser-recovery.json](../evidence/p0-2/browser-recovery.json) 2组 PASS：模拟503草稿保留/编辑冻结、同键真实重试；另一个正常会话真实CAS写入后，本页409保留草稿且不覆盖，确认重载读取另一会话值 |
| 文件问题/手机图片 | [browser-files.json](../evidence/p0-2/browser-files.json) 最终2组 PASS，`actualImagePixelsChecked=true`，无HTTP错误、无图片重试。文件问题真实创建/刷新恢复，手机Guest看到真实标准图、同几何/孔字段、无编辑入口、只读文件问题；只证明viewport，不是真机 |

真实 API 是正常应用入口；DB admin 仅结构检查及回滚夹具，不计为 Auth 用户行为。浏览器唯一故障注入是明确命名的模拟503 UI保留/重试检查，最终重试落真实API；不得用其证明网络故障已修复。

## 已修复与保留的问题

- 浏览器初始默认 expect 5 秒，在真实服务仍读取时失败；将等待预算调整到实际45/60秒，保留 [browser-first-run.json](../evidence/p0-2/browser-first-run.json) 和 [browser-before-timeout-adjustment.json](../evidence/p0-2/browser-before-timeout-adjustment.json)。这是测试预算修正，不能当作性能改善。
- 早期上下文复用较旧的保存 cookie 后页面拒绝访问；改成每个上下文独立正常密码登录，不用管理员或认证旁路。记录 [browser-session-collision.json](../evidence/p0-2/browser-session-collision.json)。后续仍有401，因此不能将全部401都归因于旧cookie。
- 画布 focus 自动滚动导致绘制方向漂移，改 `preventScroll`；React 批处理历史 updater 读取可变 ref 导致撤销/重做快照错误，改为捕获前态。保留 [browser-before-history-fix-full.json](../evidence/p0-2/browser-before-history-fix-full.json)，真实浏览器重新通过绘制/拖动/撤销与恢复。
- 有值 textarea 的嵌套标签使严格标签定位不稳定，补显式可访问名称；失败草稿截图仍可见，但旧自动断言失败，保留 [browser-before-recovery-fix.json](../evidence/p0-2/browser-before-recovery-fix.json)，定向复测两组通过。
- 截图审查发现旧手机图片加载失败时，“加载文字消失”的断言仍通过。该判断不充分，旧 [guest-mobile-before-image-check.png](../evidence/p0-2/screenshots/guest-mobile-before-image-check.png) 不能证明图像可见。最终脚本要求错误/加载遮层消失并读取实际画布已知位置RGB/alpha；允许一次真实重试，错误与重试单列。
- 完整浏览器运行在文件问题刷新时有真实401（`/issues`、`/uploads`），根因仍未证实；不能用后续独立会话PASS抹去长时间稳定性缺口。Auth 临时网络/5xx现在区分为503而非401，只记录白名单错误码/状态，不输出SDK原始消息或令牌。不是已证实的401根因修复。

多轮证据分别有原始时间与结果；定向重测是为了覆盖实际修复，不是同一完整运行“全绿”。单元/类型/构建/基础e2e与业务e2e的范围不同。

最终功能覆盖共7类页面检查，来自核心完整运行3项、恢复定向2项、文件/实际图片定向2项，均有对应PASS；汇总见 [browser-summary.json](../evidence/p0-2/browser-summary.json)，可用 `node scripts/p0-2/summarize.mjs` 重新汇总。不将此前完整运行中的3项FAIL删除或改写。恢复定向的503是明确注入的响应，409是真实数据库CAS冲突，两者记录在该次HTTP失败列表中属预期。

## 正式 UI 与批准方案差异

| 约束 | 实际落实与差异 |
|---|---|
| 两个主要Section | 仅「资料与补测」「交付与版本」；后者保持尚未开放说明，无假发布、聊天或看板 |
| 桌面布局 | 资料列、画布、属性并列；本阶段用属性/修订替代未来请求列内容，不提前做测量请求 |
| 手机 | 文件列表/单文件详情互斥，返回按钮；只读属性在画布下，Owner小屏同样可进入单文件状态，精细手感待人工 |
| 无渐变 | 纯白/冷灰背景、纯蓝操作色，源码无gradient；选中几何加白色衬线以增强图片对比 |
| 非暖黄主色 | #175CD3 / #073C9C 蓝色、石墨正文；异常语义红，不使用暖黄主视觉 |
| 无AI风 | 文件行/真实画布/字段/修订列表，无星光、发光、玻璃、营销大卡或AI浮层 |
| 无无意义嵌套 | grid分列、画布视口、属性fieldset、历史列表分别有布局/操作/语义目的；没有多层装饰卡片 |
| 本阶段具体选择 | 显式保存、单会话100步历史、每图200个保留头、只读修订预览、错误复制草稿/重载均在批准契约内；无新增主要流程 |

截图： [工程师与圆字段](../evidence/p0-2/screenshots/owner-desktop.png)、[Guest手机](../evidence/p0-2/screenshots/guest-mobile.png)、[文件问题](../evidence/p0-2/screenshots/file-question.png)、[保存重试](../evidence/p0-2/screenshots/save-retry.png)、[真实冲突](../evidence/p0-2/screenshots/save-conflict.png)。均为Chromium自动化截图、合成资料，非实机；不能以截图代替主观试用。旧失败图保留，不裁掉错误状态。

肉眼已检查上述最终截图：手机标准图已实际显示，重试/冲突的草稿仍可见，无凭据/分享地址。低倍率下长名称与相邻标注文字可能重叠，几何位置不变，可放大或用对象列表/属性查看；是否影响日常使用待人工，文字避让/布局视觉统一留到功能接近完成后精修，不擅自提前实现复杂标签排布。

## 待人工、后续与阻断

人工清单见 [02-manual-checklist.md](02-manual-checklist.md)。布局是否顺手、文字清晰度、拖拽/缩放与快捷键主观感受、真实Android/iOS触摸和肉眼同位均待人工，桌面viewport不替代真机。没有接到反馈就不标 PASS，也不因此要求提前实现P0-3/4。

已于10-17提供正常登录入口、ignored本地凭据/Guest入口和检查清单，并请求人工试用；报告完成时未收到结果则继续标待人工。Owner入口 `http://127.0.0.1:3000/projects/a293ec24-2f33-4aae-b73e-41e092259aca`，此UUID不授予访问能力。分享令牌不写报告。

保留 P0-1 偶发503稳定性问题；本轮读共享锁减少不必要串行，安全错误码有助后续诊断，但不是已证明根因修复。注册OTP、泄露密码保护WARN、生产worker/硬资源限制/备份演练仍按原报告待后续。大陆网络依用户决定延后到P0最终出口，不阻断本阶段开发。

最新 [advisors.json](../evidence/p0-2/advisors.json)：仍有泄露密码保护未启用WARN；性能仅4项unused_index INFO，测试小样本没有理由删除必要历史/操作者索引。密钥扫描见 [secret-audit.json](../evidence/p0-2/secret-audit.json)，范围包括待提交/未忽略文件及客户端静态包，截图另行肉眼审查；不声称完成全历史秘密扫描。

阶段边界：文件级comment只是创建/查看文字问题，未实现回复/审核。P0-3承担测量请求、证据与审核；P0-4承担成果交付和完整双端闭环。本阶段既不实现也不以缺少这些功能判定必须扩大范围。

**审批状态**：架构/权限/坐标/双端方案已由本阶段用户明确批准，无新架构选择待批准；本次代码、UI及阶段验收仍待用户审阅。**未关闭的问题**：真实401/偶发503稳定性根因、主观与真机检查，故不能宣布P0-2全项验收通过。没有发现需重写P0-1的权限隔离缺陷，但稳定性不得带着“已解决”的错误结论进入验收。后续阶段仍需用户启动，本轮停止P0-2。
