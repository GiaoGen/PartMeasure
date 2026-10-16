# P0-1 验证与交付报告

日期：2026-10-16。目标为已授权隔离项目 `rvysclscetfqicpnzlra` 的应用实现与验收准备，**不是生产上线或 P0-1 已获用户验收**。本阶段没有进入 P0-2～P0-4。此前批准依据见 [00-authorization.md](00-authorization.md)。

## 已实现的交付范围

- 注册邮箱+密码、数字码确认接口及页面；实际工程师密码登录、HttpOnly SSR Cookie、受保护项目页、登出。注册送达/数字码验证按用户后续决定暂缓，和已通过的密码登录分开。
- 自己的项目创建、名称/说明修改、分页列表与进入；revision 防丢更新。没有搜索或归档。
- 分享生成、复制、轮换、撤销，数据库仅存摘要；免账号客户项目 Cookie、每请求项目与动作授权、撤销后旧链接/会话/完成请求失效。
- 真实私有隔离桶/资产桶，双端多文件队列、进度、逐项重试、SHA/幂等防重复、预留配额；XHR 小文件和签名 TUS 大文件。扫描/校验/图片归一化完成后才发布资产。
- 列表、图片预览、附件下载、上传者/时间/格式/大小、Owner 软删除及历史保护；客户不能删文件、取原图或管理项目。下载经服务端重新核权代理。
- 六份本阶段 migration、非 bypass runtime/worker 角色、真实 TLS、服务端事务适配器、独立无 Docker worker 和持久化补偿清理。

业务/API/运行说明见 [01-implementation.md](01-implementation.md)，文件、配额、迁移与清理边界见 [02-files-and-migrations.md](02-files-and-migrations.md)。

## 实际命令与检查

以下命令在本机实际执行；真实业务目标 `http://127.0.0.1:3000`，Next 使用生产构建，Auth/DB/Storage 是云端真实服务。扫描为本机独立 ClamAV 1.5.4。浏览器测试不采集 trace/HAR；凭据和原始链接仅在 ignored 本地文件。

```powershell
npm run check                    # lint、strict typecheck、Vitest、生产构建
npm run test:e2e                 # 3100 端口基础 UI/拒绝：6/6
npm run licenses                # 267 个包；无缺失许可证标识
npm audit --json                 # 0 vulnerabilities
node scripts/p0-1/login-test-users.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action business-test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action browser-test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action tus-test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action db-test
node --env-file=.env.local --conditions=react-server --import tsx scripts/p0-1/check-processing.ts
node scripts/p0-1/check-secrets.mjs
node scripts/p0-1/range-test.mjs
node scripts/p0-1/refresh-screenshots.mjs
git -c safe.directory=D:/PartMeasure diff --check
```

不自动重跑 `auth-request`：它会发送注册邮件，用户已暂缓；Admin fixture 工具也不是每次回归的前置条件。已有两个账号用 `login-test-users.mjs` 经实际应用密码登录重新取得状态，不再次调用 Admin 或发邮件。

| 检查 | 结果与证据 |
|---|---|
| lint / strict TypeScript / production build | PASS；`npm run check` 完成，全部正式路由构建成功 |
| 单元测试 | PASS 24/24：格式、magic、ZIP 风险、名称/大小、HTTP Range 边界及健康响应；不冒充真实业务测试 |
| 基础 Playwright | PASS 6/6，桌面与 Pixel 7 viewport；注册页检查没有发送邮件 |
| 两名测试用户的真实密码登录、新上下文恢复 | PASS；[auth-fixtures.json](../evidence/p0-1/auth-fixtures.json)。用户授权的 Admin 夹具，**不证明注册/OTP** |
| 真实业务 API 回归 | [business.json](../evidence/p0-1/business.json) 本轮17/18 PASS：A/B 隔离、Guest 无账号、管理拒绝、上传/处理/预览、跨项目/公开读取拒绝、伪装/超限、软删除、撤销及登出。越界 Range 暴露上游超时；最终构建定向复测4/4 PASS（全量200、正确片段206、非法/越界416及文件名），见 [range-diagnostic.json](../evidence/p0-1/range-diagnostic.json)。保留原失败，不把修复前整轮改写为全绿 |
| 正式 UI 真实业务 | PASS 8/8；见 [browser-business.json](../evidence/p0-1/browser-business.json)：SSR 刷新、两 Section、项目创建、匿名空项目、已有文件、部分失败/逐项重试、附件下载、TUS及无效链接 |
| 真实大文件 TUS | PASS：7,500,084 字节二进制 STL 合成样本；POST 201、PATCH 204、安全处理后页面完成，见 [tus.json](../evidence/p0-1/tus.json)。不冒充客户 CAD 语义兼容性 |
| 真实 DB 完整性 | PASS 7/7；见 [db-integrity.json](../evidence/p0-1/db-integrity.json)：角色/RLS、HTTP+trigger 历史保护、不可变路径、额度对账、COMMIT/ROLLBACK 身份清理、迁移逐字比对、孤儿清理 |
| 图片与扫描 | PASS 19/19：[processing.json](../evidence/p0-1/processing.json)，实际正式图片子进程处理 EXIF 1～8 ×横/竖图、真实 ClamAV clean/EICAR/缺失扫描 fail-closed。样本为合成图，非真机 |
| migration 核对 | 六份本地 SQL 与云端历史同版本/同内容；摘要见 [migrations.json](../evidence/p0-1/migrations.json)。未部署后续草案或本机 auth/Storage 替身 |
| 供应链与密钥 | [npm-audit.json](../evidence/p0-1/npm-audit.json)、[licenses.json](../evidence/licenses.json)、[secret-audit.json](../evidence/p0-1/secret-audit.json)。server-only/Supabase CLI 包未附 LICENSE 文件，声明 MIT；combine-errors 的 MIT 来自随包 README License 节并记录来源 |

DB 清理测试是专门创建、**从未签发 grant** 的结构夹具，回拨清理时间后运行真实 worker；没有缩短仍可使用的上传凭证寿命。历史保护测试也是受控 flag/trigger 夹具，不能替代后续尚未实现的几何/回复/交付引用链验收。配额已核对计数和拒绝逻辑边界，没有填满整个账户或做负载压测。

TUS 定向截图保留了当时一次资料列表加载失败提示，因此不能单凭该截图宣称列表恢复；文件浏览和附件下载另由完整真实浏览器流程验证。没有裁去错误提示。最终 workspace 仅文案与小文件字节单位调整后，另跑 `node scripts/p0-1/refresh-screenshots.mjs` 在最终生产构建核对实际图片显示并刷新两端截图，PASS 2/2，见 [final-ui.json](../evidence/p0-1/final-ui.json)。

最终构建的第一次 Range 定向复测与截图同时运行时，非法范围请求曾返回一次503；保留 [range-transient-service-error.json](../evidence/p0-1/range-transient-service-error.json)。独立复测四项全部通过，但503根因未定位，不能推断为仅网络问题或宣称并发稳定性通过。**偶发503/列表加载失败的稳定性复查仍待完成**，需结合受控脱敏错误码、连接/锁等待和弱网测试定位；不能用单次PASS抹去。当前没有破坏私有/撤销权限的证据。

## 已修复问题与保留的失败记录

- Resend 550 域名未验证导致注册失败；用户随后暂缓。历史 [auth-request.json](../evidence/p0-1/auth-request.json) 保留，不能改写为 PASS。
- Guest worker finalize 的行锁缺少最小权限，经正式 migration 补 `UPDATE(id)`，不授 bypass；真实 Guest 上传/下载重新验证。原 [business-before-retest.json](../evidence/p0-1/business-before-retest.json) 保留。
- TUS 原先走普通 `/upload/resumable` 而遇 `Invalid Compact JWS`。核对 Supabase 官方 Storage 实现的 `SIGNED_URL_SUFFIX='/sign'` 后改签名专用 `/upload/resumable/sign`，仅传固定路径签名，无服务密钥出浏览器。修复后实际传输成功；首次端到端等待 120s 超时，数据库稍后 ready，扩大异步测试等待后取得页面成功证据。旧超时记录 [tus-before-final-retest.json](../evidence/p0-1/tus-before-final-retest.json) 保留。官方 [TUS 文档](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[路由源码](https://github.com/supabase/storage/blob/master/src/http/routes/tus/index.ts)。
- 开发态 HMR 曾干扰测试，最终改用生产构建验证；[browser-development-run.json](../evidence/p0-1/browser-development-run.json) 及 [browser-before-final-retest.json](../evidence/p0-1/browser-before-final-retest.json) 保留。下载的官方参考源码在 ignored tmp 中，首次被宽泛 TS include 扫入后，将 tmp 正式排除并重跑通过。
- 并行回归曾把旧项目夹具与另一轮写入的 Guest 会话文件配对，客户页检查失败后中断该次运行；页面脚本改为直接从该夹具分享链接建立真实匿名会话，不依赖可变的配对状态文件，再完整复跑。
- 重复运行页面脚本曾复用相同图片/STEP 内容，触发真实防重复拒绝；将每轮样本内容和附件名唯一化，不修改业务防重复规则。
- 真实 Range 回归中，正常全量、206片段和多范围拒绝成功，但越界请求在上游超时。改为核权后按持久化原件/标准图大小预检，非法或不满足范围直接416并返回实际总大小；两个边界单元用例和独立真实服务重测覆盖修复。没有为通过测试放宽权限。

## 正式 UI 与批准提案的对应

| 项目 | 实现与差异 |
|---|---|
| 两主要 Section | 导航仅「资料与补测」「交付与版本」；后者诚实空态，不能发布。没有聊天、复杂看板或文件夹树 |
| 工程师桌面 | 资料列表/上传、图片查看、资料详情并列；项目说明和分享折叠。没有标注工具，未实现能力只作文字提示 |
| 客户空项目与已有文件 | 空态首先给拍照/选择入口；有资料后可选择图片查看/附件下载。手机单列、原生滚动/缩放，上传队列有高度上限 |
| 无渐变 | CSS 不含 gradient；背景纯色，无渐变按钮/装饰 |
| 非暖黄主色 | 冷白/灰为底，蓝为操作色；异常采用语义红色，没有暖黄主视觉 |
| 无 AI 风 | 无聊天机器人、星光、发光描边、宣传插画或生成式文案 |
| 无无意义嵌套 | 布局列直接承载资料、预览和详情；上传队列/原生 details 有实际功能，没有逐层装饰卡片 |
| 已批准方案内的具体调整 | Auth 按用户新要求改密码注册+验证码、密码登录；Free 环境有效上限降至50MiB并明确显示；TUS安全清理等待27h；生产页不显示 P0 阶段代号。没有增加业务流程 |

截图（Chromium，非实机）：[工程师桌面](../evidence/p0-1/screenshots/engineer-desktop.png)、[项目创建](../evidence/p0-1/screenshots/projects-desktop.png)、[客户空项目](../evidence/p0-1/screenshots/guest-mobile-empty.png)、[客户已有文件](../evidence/p0-1/screenshots/guest-mobile-files.png)、[批量部分失败](../evidence/p0-1/screenshots/guest-mobile-partial-failure.png)、[大文件完成](../evidence/p0-1/screenshots/tus-mobile.png)、[登录](../evidence/p0-1/screenshots/login-mobile.png)、[注册](../evidence/p0-1/screenshots/registration-mobile.png)、[无效链接](../evidence/p0-1/screenshots/invalid-link-mobile.png)。

## 待审批、待外部验证与后续阶段

**待用户验收**：本阶段代码、正式 UI、报告；不重复索取已经批准的架构/交互选择。本轮没有新增需要先批准才能实施的架构方案。没有生产发布或收费资源授权请求。

**本阶段剩余验证**：偶发503的根因与并发稳定性待复查，不标已解决。修复 Resend 已验证 Sender 域名后，使用全新邮箱实际注册、数字码送达/输入/确认、随后密码登录。当前两个 Admin 夹具已经确认，不能再拿它们冒充“新注册”。用户已决定暂缓，因此不再催要验证码或自动发信；这仍是完整 P0-1 认证验收缺口。实际 Android/iOS、相册/拍照、Safari、真实 CAD/ZIP 样本兼容也待外部条件。测试采用现有网络代理，不推断中国大陆直连情况。

**后续 P0 最终验收前**：中国大陆真实手机网络的整站/Auth/上传/下载；生产 worker 的常驻守护、病毒签名更新/告警、OS 硬资源限额、部署入口可信 IP 限流和上传重放流量计量；全新隔离环境从零回放与 DB+Storage 恢复演练。尚未部署生产。Free 下没有验证100MiB上传，不以配置项代替供应商能力。

**所属后续业务阶段**：P0-2 的几何/坐标与图片 UI 集成；P0-3 的问题/回复/审核及引用保护；P0-4 的交付快照/历史关联。现有底层接口不能证明这些业务通过，也不要求提前实现它们来完成本阶段。

Supabase Security Advisor 仍有 [泄露密码保护未启用](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) WARN；性能仅测试小数据下的 unused_index INFO，没有为消除提示删除必要索引。原始脱敏结果见 [advisors.json](../evidence/p0-1/advisors.json)。

**停止位置**：P0-1 提交并供审查；不自动进入 P0-2。真实注册/数字码缺口、偶发503稳定性与用户验收尚未完成，不能宣称 P0-1 全项验收通过。这些问题不需要提前实现 P0-2～4 才能处理。
