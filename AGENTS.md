# PartMeasure 工作约束

- 先读 `PartMeasure_V1_PRD.md`，尤其 4–6、8–10、12 节，以及 `docs/P0-0/`。
- 当前授权 P0-4；用户已明确确认 P0-3 人工验收通过，并授权第一轮成果交付与P0端到端闭环，依据见 `docs/P0-4/00-authorization.md`。不实施 P1/P2 或全站UI重设计。
- 2026-10-21 用户明确取消工程师确认步骤：客户提交即已补充（绿色），初次待补为红色，仅工程师要求补测为黄色；保留回复/补测历史与工程师人工编辑权限。照片编辑区显示当前图片标注编号。本条替代旧方案中 submitted 必须等待确认的要求；旧确认记录仅作历史。
- 2026-10-21 用户审阅属性聚合交互示例后明确“开始改”：授权按统一对齐布局整理各类标注属性、测量要求/备注、客户补充与历史；移除编辑器中的“这张照片的其他问题”，保留左下角提醒入口。黄色标注旁显示“待补测”，编辑器编号只显示数字，不带圆圈。仅限现有功能排版，不增加新业务流程。
- 2026-10-21 用户批准双端补充区简化示例，并要求历史按角色配色：待补测优先原因、旧值降为上次提交；双方按角色显示当前操作、历史默认折叠，工程师蓝色/客户绿色且保留文字身份。日常补充区不重复嵌入照片，固定位置在历史中按需查看；保留状态机、权限与完整历史。
- 2026-10-20 用户审阅 `docs/proposals/annotation-tools/README.md` 和独立示例后明确“开始基于现有的代码实现这几个功能”：授权 CAD 式线段端标、手动角度/三点圆弧/可旋转椭圆及相应原位补测、保存/历史/单位与正式隔离迁移。椭圆按用户后续澄清默认标记斜拍圆孔的人工直径 Ø，可选长半轴 a，不要求双轴实测。这是原 P1 中这些指定工具的单独授权，不扩展到 OpenCV、AI、导出或其他 P1/P2；不启动浏览器/E2E，不部署生产。
- 2026-10-20 用户明确批准“标注即协作对象”的简化方案并要求实施：缺尺寸的线段/圆孔保存后自动待补，客户提交与工程师确认内嵌「标注与属性」，取消独立发布提醒步骤；点/文字默认说明，孔深可单独要求。复用独立 issue/response/review、固定快照和修订历史；只在隔离项目应用必要 migration，不启动浏览器/E2E、不部署生产。详见 `docs/annotation-collaboration.md`，本条替代旧方案中必须手动发布测量提醒的交互。
- 2026-10-20 用户要求按轻量简历作品取舍，并在取消Worker/完整杀毒扫描默认建设项的说明后明确“开始简化”：授权实施请求内文件校验/图片处理、移除常驻Worker与ClamAV依赖，并在现有隔离项目验证必要正式migration。不采购、不部署生产，不启动浏览器/E2E。保留私有文件/权限、格式大小、归一化坐标及历史；新资产明确format-only-v2，不能伪称已病毒扫描。详见 `docs/no-worker-upload-proposal.md` 及后续实施记录；本条替代此前“仅出方案”的停点。
- 2026-10-19 用户另行授权依据 `docs/frontend-backend-alignment.md` 先实施明确的后端对齐项；范围见 `docs/backend-alignment/00-scope.md`。文件夹/搜索等以本次授权为准；标注私有发布/批次/永久编号仍待语义决策，不扩大到完整 P1/P2。不自行启动浏览器或 E2E，保留当前前端未提交改动。
- 2026-10-19 用户授权执行性能方案第1、2项：默认直连与脱敏分段基线、现有契约接入及请求/缓存减负。依据 `docs/performance-s12.md`；不据此实施实时事件流、迁移worker、购买服务或增加转发层。不修改系统代理，不将开发机或代理结果充当大陆手机网络通过。
- 2026-10-19 用户进一步明确授权“执行3，4任务”：实施 `docs/realtime-performance-plan.md` 第3项事件同步和第4项安全图片快速路径；可准备隔离测试迁移及无Docker常驻worker部署包。新增收费资源仍须核价授权，缺托管资源不得宣称已部署。不自行启动浏览器/E2E，不修改系统代理，保留此前前端工作。
- 2026-10-19 用户授权第五项“采用有边界的缓存”：复用统一内存缓存，按项目/资源事件精准失效，图片按内容版本复用并限制保留与下载预留；退出/切换账号/撤销时清理，服务端小缩略图缓存每次仍先核权。实施与结果见 `docs/performance-s5.md`；不借此公开桶、延长签名、缓存授权、购买资源或修改网络代理。
- 在已批准方案内实施成果私有草稿、多附件原子发布、不可覆盖版本与受控下载，复用已有认证/文件/标注/测量；实质改变流程/架构再提案。
- 工作台只保留「资料与补测」「交付与版本」。无渐变、暖黄主色、AI 风格或无意义容器嵌套。
- npm 唯一包管理器；精确版本 + package-lock。TypeScript strict。复用已有内容，不覆盖他人改动。
- SQL 草案在 `supabase/drafts/`；仅部署本阶段正式 migration 至已授权隔离测试项目；禁止生产部署及整份部署未来阶段草案。
- 私有数据/RLS/Storage 必须默认拒绝。分享令牌只存哈希，日志脱敏，密钥永不进版本库。
- 检查：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`。基础测试不能代替真实数据库与大陆手机网络验收。
- 阶段报告区分已完成、待审批、待外部验证；未实测不得写通过。
- 收尾用户要求全程无Docker；已明确授权的隔离云实验项目ref为`rvysclscetfqicpnzlra`，不得转而操作既有生产项目。业务草案未批准不得应用，本机auth/Storage替身永不部署云端。
- 用户已配置 Resend SMTP 和数字 Token 模板。注册邮箱+密码+数字 OTP 确认，之后密码登录；此前用户暂缓的真实注册验证仍须单列。P0-4必须安排大陆真实手机网络登录/分享/照片上传/回复/私有下载人工实测；未实测不得宣称整个P0验收通过，等待期间继续不受影响工作。数据库可访问不等于 Auth/Storage/整站通过。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
