# P0-3 测量请求、追加回复与审核

沿用已批准 P0-0 架构与交互；授权和 P0-2 验收确认见 [00-authorization.md](00-authorization.md)。复用 `rvysclscetfqicpnzlra` 的现有私有 `pm` schema、受限 PG 适配器、Auth、Guest能力会话、Storage/ClamAV/Sharp管线和React Konva。没有新增依赖、公开桶、业务RPC、认证旁路或生产部署，无Docker。

## 数据及事务

正式 migration `20261017145122_p0_3_measurement_workflow.sql` 在已授权隔离项目应用。CLI先创建文件，云端实际history version核对后同步本地文件名；首次MCP请求状态过期，经查询确认未执行后才重试，未重复部署。源内容/hash见本阶段migration证据。

顾问复查后补充正式migration `20261017152616_p0_3_issue_response_index.sql`，为最新回复复合FK提供完整覆盖索引；云端与本地内容逐份一致，未改写已应用历史。

- 扩展已有 `pm.issues`：旧comment原样保留并初始化awaiting_response/revision1；新增measurement、目标说明/方法、固定annotation id/revision、不可变geometry/metadata快照。复合FK指向原文件/标注修订。新请求只可引用当前已保存且未隐藏的标注，创建后不随头版本变化。
- Guest不获得整份标注修订表的读权限，而是读取Owner发出请求时固定的快照。标准图路径、宽高、哈希、normalization version沿用P0-2不可变约束；图片仍按归一化原图坐标渲染。
- `pm.issue_responses` 追加每轮回复，保留原数值/单位、文字、Owner或Guest会话来源、可选称呼。称呼是自填标签，不是认证。`response_attachments` 同项目复合FK；`issue_reviews` 追加Owner决定、对应回复、最终值及来源/说明。没有UPDATE/DELETE历史权限。
- 回复种类measurement为numeric/photo/unable；comment只允许text。正十进制字符串、mm/cm/m/in，保留原字符串不自动换算；不做角度、读尺、像素→毫米或工程合理性判断。photo不接数值，至少一张ready标准图片；unable和text须有说明。每轮最多10个不重复附件，每任务最多100轮回复，每文件最多200个保留问题。
- 状态只允许 `awaiting_response → submitted → confirmed`、`submitted → remeasure_requested → submitted`。submitted后不能追加修改，confirmed后纠错新建请求。CAS修订和最新responseId均校验，Guest不得审核或直接设置状态。
- Owner确认来源：customer_numeric必须与原回复值/单位完全一致；owner_from_photo要求照片回复、人工值及说明；owner_manual允许人工录入/修正且必须说明。comment确认仅处理结果，无假数值。重测必须原因、不得附加确认值。原回复和照片均不改变。
- SQL事务固定project→share→issue锁顺序，先状态/修订/文件核验，回复→附件→头状态→审计一次提交；审核→头状态→审计一次提交。延迟constraint trigger在事务结束再次检查回复/审核与头状态一致，防止漏更新状态却提交历史。未知网络结果只重试原幂等键，不盲目新建。
- 观察到并发测试55P03锁等待超时，适配器对已回滚的55P03增加最多2次有限退避重试，与既有40001/40P01相同；不重试未知网络/提交结果。不将这次证据扩展为历史401/503全部根因已解决。

## 权限与文件

每请求仍使用正常Auth getUser或HttpOnly Guest能力，核项目、链接有效性、文件可见性。服务端DTO拒绝owner/state/path等控制字段；CSRF/同源、限流、幂等与no-store沿用P0-1。Owner A/B隔离，Guest仅本项目读/回复；创建请求、专业编辑、审核均Owner专属。

所有新表RLS开启，仅runtime SELECT/INSERT，无anon/authenticated/worker授权。issue只授runtime更新state/revision/latest_response_id/updated_at列，并由trigger限定转换和不可变目标。所有函数SECURITY INVOKER，无definer或公开RPC。

证据只接收同项目、customer可见、未隐藏的ready资产ID；pending/quarantine、其他项目、缺失、伪装photo的普通附件都拒绝。Guest关联证据后只能通过严格trigger将history_protected单向置true；不能改文件名、路径、可见性、删除或解除保护。关联后禁止补挂新附件/覆盖旧附件。没有公开文件URL，标准图/证据/下载仍经原核权代理；Owner原件权限不扩给Guest。

## 路由增量

Owner前缀`/api/projects/:projectId`，Guest前缀`/api/guest/projects/:projectId`。

| 接口 | 输入与约束 |
|---|---|
| GET `/issues?cursor=id` | 任务、状态计数、每页30；按主体待办优先级、时间、ID游标分页；状态变化后刷新列表 |
| POST `/issues` | Owner；原comment DTO兼容。measurement需kind、fileId、annotationRef{id,revision}、title、targetInfo、description、measurementMethod |
| GET `/issues/:id` 或 `/issues/:id/history` | 固定目标、文件、追加回复/证据、审核记录；无内部会话凭据 |
| POST `/issues/:id/responses` | Owner/Guest；numeric/photo/unable/text严格DTO、evidenceFileIds、guestLabel；If-Match修订+幂等键；201 |
| POST `/issues/:id/review` | Owner；decision、responseId、value/unit/source（无则null）、note；If-Match+幂等键；201 |
| GET `/files/:id/issues` | 兼容原入口，返回问题状态，可进入统一回复/审核页 |

缺修订428，状态/修订/幂等载荷冲突409；非法数值/来源/附件422；Guest审核403；跨Owner项目404；无效Guest能力401。所有私有返回禁止公共缓存。

## 双端交互

工作台仍只有资料与补测、交付与版本两大Section。资料区顶部为平铺待办摘要和可收起任务列表，非看板。Guest首次优先打开待回复/重测任务；始终有“继续上传资料”，窄屏进入资料选择/上传后可再选任务。

Owner在已保存标注属性下创建请求，固定修订可见；请求草稿期间暂停修改该标注，切换/离开有提示，成功后防止再次误点重复创建。目标图复用只读Konva，不引入第二套编辑器。回复或审核输入暂存在本会话内存，离开有提示；不默认写localStorage。

客户直接看“测哪里/怎么测”和三种回复方式。照片模式复用现有私有上传队列，处理完成后勾选本次附件，再提交回复；明确上传≠回复已提交。工程师同页看历史、证据缩略图和原尺寸核权查看入口，再确认/要求重测。失败保留输入，未知结果冻结编辑并沿用幂等键重试；409允许复制草稿、确认放弃后重载。成功已提交但最新状态读取失败时暂停旧表单，避免显示旧状态继续提交。

没有图文教程系统、交付、AI、CV、导出。沿用冷白/灰/蓝、纯色分隔线，无渐变、暖黄主色、AI装饰或无意义套卡。证据缩略图使用Next Image unoptimized，保持私有代理Cookie核权，避免公共图片优化缓存。

## 运行（无Docker）

Node24/npm11与现有`.env.local`、严格TLS CA、runtime/worker角色不变。私钥/DB密码/会话/分享地址只放ignored本地配置。普通开发`npm run dev`；集中验证使用生产构建：

```powershell
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action start
# 新照片需要既有ClamAV和独立worker
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action worker
```

本阶段真实验证复用P0-2项目和已处理文件，不重建Supabase或用户：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action concurrency
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action browser
# 首轮业务部分通过后，照片流程可单独复验，保留旧记录
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action browser-photo
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-3/run.ps1 -Action seed
node scripts/p0-3/check-secrets.mjs
```

先api再db，其他集中串行运行避免互相制造锁负载；seed最后准备稳定人工任务，人工试用期间不重跑seed。正常密码登录，不发注册邮件/不调用Admin代替认证；浏览器不采集trace/HAR。API测试会预留一份64字节未传输文件验证pending附件拒绝，未签发上传grant，不会对客户开放，按既有清理周期回收预留。

云端已应用正式迁移，禁止重新手贴SQL或整份部署drafts。回退优先前滚修复；若必须撤回，先停止新写入、备份issue/response/attachment/review与固定标注关联，评审补偿迁移。不能DROP历史表或解除历史保护作快捷回滚。

官方兼容核对：本轮读取Supabase changelog、RLS/连接池文档，关注11月10日旧TLS1.2密码套件停用；Node24/当前Chromium使用现代TLS，旧实机浏览器仍待验证。本轮未升级依赖，沿用已核对版本及许可证；已阅读安装版本Next Route Handler指南和React组件质量技能。
