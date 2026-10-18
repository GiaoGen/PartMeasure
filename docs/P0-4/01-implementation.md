# P0-4 实施契约与部署准备

沿用已批准交付线框，不新增主要流程：Owner在交付Section上传专用成果，保存说明/明确文件集合，发布前确认清单；Guest只读最新已发布集合并逐文件下载。草稿刷新恢复；状态/错误/重试真实呈现。没有下载全部、完整历史列表、反馈或接受按钮。

## 数据/权限增量

- upload_reservations/file_assets新增不可变purpose（material/delivery），旧数据默认material。成果只能Owner预留，worker沿用原扫描/标准化管线，ready成果初始visibility=internal。普通资料/证据列表不混入成果。
- deliveries保存草稿说明、revision、创建人、发布人/时间与项目唯一version_no；delivery_files真实关系保存文件及顺序/当前选择。草稿修改CAS，关联保留而不物理删历史；发布后delivery及其附件关联不可改删。
- 发布锁project→delivery，核expectedRevision、全部同项目Owner成果、ready/未隐藏、1～20附件。分配项目内递增编号，冻结集合、公开对应成果、单向history_protected与审计/幂等结果同事务提交。数据库trigger及复合FK再校验；deferred检查防止发布成功却未保护/公开附件。
- Guest拒绝成果预留/草稿/发布/编辑，所有读/下载仍逐次核会话、项目、撤销、visibility及发布关联。未发布文件即使猜ID也不可读取；公开桶/永久URL均不引入。新版本可复用已发布的不可变文件，但不能覆盖其路径、内容或元数据；完整历史管理UI留P2。
- 下载沿用受控代理并支持单Range/416；签名仅内部使用。交付页提供进度、失败重试/取消，重试仍重新核权，不把交给浏览器保存当作实际磁盘保存已验收。当前供应商单文件50MiB限制仍有效。

## 前置与部署检查

真实服务已核对Supabase ref/status、最新changelog与私有Storage官方文档。依赖沿用精确锁，不以新库重建模块。Vercel MCP已连接，新增独立partmeasure-staging；首轮preview参数返回production后先暂停，经用户明确批准源码上传/恢复测试项目，现已使用官方非生产staging正确部署，最终HTTPS闭环通过。没有使用旧无业务凭据构建做验收，既有生产项目未动。网页与worker分离；当前本机受控worker连接同一云测试库处理任务，不能称生产常驻托管已通过。

P0-3历史39单测/6基础E2E及真实业务分段通过复用；503与worker退出风险继续核对。真实OTP此前暂缓、大陆网络与实机仍待外部证据。最终逐项结果见03-verification与04-p0-exit-matrix，不以基础检查代替业务。

## 正式代码与接口

Owner/Guest沿用已有两个前缀 `/api/projects/:project` 与 `/api/guest/projects/:project`。`GET /deliveries`返回最新published和仅Owner可见的drafts；`POST /deliveries`创建草稿，`PATCH /deliveries/:id`使用If-Match，正文严格为description与fileIds；`POST /deliveries/:id/publish`要求空正文、If-Match、Idempotency-Key，返回201。已发集合详情和成员下载为 `GET /deliveries/:id`、`GET /deliveries/:id/files/:file/download`。Guest全部写动作403；猜ID仍走同项目/RLS。草稿最多5份、每集合1～20文件、说明4000字；列表只展示最新成果，没有完整历史管理UI。

`POST /uploads`可选purpose，省略仍为material，避免改变旧幂等载荷。成果预留只Owner；`GET /files?purpose=delivery`只Owner可用，资料/证据/标注仍限制material。worker用同一可信处理管线；未完成安全处理不进入成果选择。新文件存储路径唯一，禁止upsert覆盖。图像成果为统一方向的标准WebP，UI明确格式，原件保留私有；不生成或导出CAD/PDF。

`delivery-service`使用原事务适配器，锁项目再锁delivery/file；Owner身份来源正常Auth核验，不接收ownerId。审计存发布人/动作，published_by/at和version_no真实落库。数据库只存分享摘要，客户端不会收到service key或内部下载签名；每个Range重新核权。修订冲突409保留输入并可复制，未知结果沿用幂等键重试。保存成功后刷新恢复；草稿本轮未保存输入不承诺跨关闭恢复。

HTTPS兼容修正：应用和P0-4脚本使用 `X-PM-Revision: "n"` 表达业务CAS。首轮部署上 `If-Match` PATCH已提交却被返回无业务JSON的412，回读明确revision=2。业务修订与HTTP表示ETag语义分离；数据库修订/锁/幂等仍原样，服务端继续兼容旧If-Match，但两个头不一致时422，缺失/通配/弱ETag等非法值428。项目、标注、回复/审核和交付共用这个入口，不改变主要流程。旧阶段本地实验脚本中的If-Match属于历史兼容用法，部署测试请用本轮脚本。

## 本轮修复

真实跨模块回归发现worker报PG_42501，回滚复现定位到delivery_files：组合布尔表达式不足以隔离无关子查询。新增 `20261018010435_p0_4_worker_purpose_guard.sql`，将material/internal分支与发布关联查询改为显式PL/pgSQL条件控制，保持SECURITY INVOKER和worker无交付表权限。未修改已应用的首份migration，未用bypass/definer或扩大GRANT修复。新增force_generic_plan回滚覆盖，且重新跑业务管线。

worker外层现在对临时依赖失败限次退避至30秒、清理失败60秒再试；lease/安全处理仍fail closed。`--once`和`--cleanup-only`失败仍退出非零，配置缺失不无限掩盖。它不能替代OS监督重启。上传组件补齐刷新后恢复的待处理条目重试入口，与原同会话处理重试共用真实接口，不重新上传/重复结算。

## 交互与批准方案差异

沿用P0-0交付线框：两大Section、上传→选择明确文件集合/说明→保存→核对确认发布；Guest最新已发布多附件列表。没有新增主要流程、未决设计审批项。新增实现细节是私有purpose、最多5份草稿、V001展示、4MiB下载进度/取消/重试。完整历史列表、反馈/接受确认、打包下载、导出和P1/P2仍不开放。

逐条视觉核对：CSS无gradient；主色沿用冷蓝/白/冷灰而非暖黄；没有AI图标、提示词/智能生成入口；交付由标题、分隔线、文件行与必要表单组成，无卡片层层嵌套。桌面保留资料/画布布局，交付为行式清单；手机单列、按钮/进度换行。主观顺手程度和实机保存仍交人工，不能以代码核对替代。
