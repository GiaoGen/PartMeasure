# 路由与接口契约 v0.1 · 待审查

除 `/` 与 `GET /api/health` 外，本文路径**尚未实现**；不能以 curl 访问它们视为完成 P0-1。Owner/Guest 共用应用服务但分入口，避免误把 capability 当 Owner JWT。契约改变需同时更新草案/DTO/后续集成测试。

## 页面

| 页面 | 权限 | 内部视图 |
|---|---|---|
| `/` | 公开 | P0-0启动标记，正式产品首页P3另审 |
| `/login` | 公开 | 邮箱OTP（P0-1） |
| `/projects` | 工程师 | 自己的项目列表/创建 |
| `/projects/[projectId]` | 该项目Owner | `?section=files\|deliveries`；仅两大Section |
| `/s/[token]` | 有效bearer link | bootstrap后进入同一客户工作页 |
| `/s/session` | Guest会话 | 清除地址中的明文token，静态子路由优先；仍是同一客户页 |
| `/auth/confirm` | 认证回调 | PKCE/OTP校验、严格站内returnTo，无额外业务UI |

`/s/session` 是推荐的去令牌地址实现细节，需随交互一起批准；不携带项目名/隐私到URL。多项目会话的 selector 为随机链接ID，不承担授权作用。

## 通用请求与响应

- HTTPS、同源 JSON；写入校验 Origin + CSRF（Owner Server Actions同样做授权）。字段 reject unknown，ID UUID，UTC ISO8601，数值字符串避免精度丢失；默认 mm，可选 cm/m/in/deg，长度/角度单位依请求类型校验。不接收 ownerId、uploader_type、status、storage_key 等可伪造控制字段。
- 请求体 JSON≤64KiB，文字说明≤4000字符、名称≤120字符，文件名≤255字节并去控制字符；批量ID≤100。所有边界含非法Unicode/NaN/Infinity校验。分页默认30最多100，签名或严格解析cursor，不用无限列表。
- 写操作 `Idempotency-Key: <uuid>`；编辑/审核/发布 `If-Match: "<revision>"`，缺失返回428，过期409。创建201，读取200，逻辑删除/撤销204；上传直传不经过Next完整body。
- 成功 `{data: T, requestId: string, meta?: {nextCursor?: string}}`；失败 `{error:{code,message,fieldErrors?},requestId}`。内部异常不返SQL/密钥。幂等重放返回原status/body和`Idempotent-Replay: true`。
- 400/422 INVALID_INPUT；401 AUTH_REQUIRED / LINK_UNAVAILABLE；403 FORBIDDEN；404 NOT_FOUND（含跨项目ID）；409 REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / INVALID_STATE / HISTORY_PROTECTED；413 FILE_TOO_LARGE；415 UNSUPPORTED_FORMAT；422 FILE_REJECTED；429 RATE_LIMITED + Retry-After；503 DEPENDENCY_UNAVAILABLE。相同无效链接不透露撤销或存在性。
- 私有响应 `Cache-Control: private,no-store`、`Vary: Cookie`（未来支持Authorization也加入），不做公共缓存/静态生成。凭证通过Cookie或专门bootstrap body，不能复制token到每个业务URL/日志。

## 能力清单

Owner前缀 `O=/api/projects/:projectId`，Guest前缀 `G=/api/guest/projects/:projectId`。Guest projectId仅选择会话，服务器从会话推导权限；不允许随便换ID。所有嵌套对象都联查同project。

| 方法与路径 | 主体/阶段 | 输入→输出、约束 |
|---|---|---|
| `GET /api/health` | 公开，本次已实现 | `{status:ok,scope:P0-0,database:not-connected}`（工程liveness特例，不采用业务envelope） |
| `GET/POST /api/projects` | Owner / P0-1 | cursor/filter；`{name,description?}`→project；owner从已验签身份取得 |
| `GET/PATCH O` | Owner / P0-1 | 读项目；`{name?,description?}`+If-Match；归档P2 |
| `POST O/share-links` | Owner / P0-1 | `{expiresAt?}`→`{linkId,url,expiresAt}`；原子轮换，明文只返一次 |
| `DELETE O/share-links/:id` | Owner / P0-1 | 原子撤销链接/会话；重复撤销204 |
| `POST /api/guest/session` | bearer / P0-1 | `{token}`→Set-Cookie+`{projectId,linkSelector}`；验证熵/长度/到期/撤销，限流 |
| `GET G` | Guest / P0-1 | 客户可见项目投影，不返回owner邮箱/内部字段 |
| `GET O/files` / `GET G/files` | 各主体 / P0-1 | kind/cursor→ready资产metadata，Guest过滤visibility及历史权限 |
| `POST O/uploads` / `POST G/uploads` | 各主体 / P0-1 | `{filename,byteSize,declaredMime,sha256?,purpose}`→reservationId、固定隔离path凭证、协议与实际grantExpiresAt；Guest purpose只raw/evidence |
| `POST …/uploads/:id/complete` | 原预留主体 / P0-1 | 上传元信息→202 validating或200 ready；重复complete只一份资产；实际对象校验不相信客户端byteSize |
| `GET …/uploads/:id` | 原主体/Owner / P0-1 | 预留/验证状态与可重试原因；禁止返回其他会话上传信息 |
| `GET …/files/:id/content` | 各主体 / P0-1 | 受控代理/经批准短签名；Range/attachment；每次核链接/visibility/ready |
| `DELETE O/files/:id` | Owner / P0-1 | 无历史引用则软删；有引用409，不能清空历史 |
| `GET O/files/:id/annotations` / `GET G/files/:id/annotations` | Owner/Guest只读 / P0-2 | revision与geometry；图片必须ready且可见 |
| `POST O/annotations` | Owner / P0-2 | `{fileId,geometry,metadata}`→annotationId/revision1 |
| `PATCH/DELETE O/annotations/:id` | Owner / P0-2 | 追加新revision或删除墓碑，不能改已发请求的revision |
| `GET O/issues` / `GET G/issues` | 各主体 / P0-3 | state/cursor→请求、目标固定revision、最新回复摘要 |
| `POST O/issues` | Owner / P0-3 | `{kind,fileId?,annotationRef?,title,description,measurementMethod?}`；measurement必须图片/正式annotation，comment可文件级无几何；项目说明存在project.description，不造空geometry |
| `POST …/issues/:id/responses` | Owner/Guest / P0-3 | response DTO→不可变response；允许状态 awaiting_response/remeasure_requested，submitted重复另次修改需先由工程师退回（待产品批准） |
| `GET …/issues/:id/history` | 各主体 / P0-3 | 有序reply/confirm/remeasure事件；不覆盖旧轮次 |
| `POST O/issues/:id/review` | Owner / P0-3 | `{decision:confirm\|remeasure,responseId,value?,unit?,source?,note}`；确认来源须清楚；Guest此路径403 |
| `POST/GET O/deliveries` | Owner / P0-4 | 新建简单成果集合/列表；模型含version，无复杂P2版本UI |
| `POST O/deliveries/:id/publish` | Owner / P0-4 | `{fileIds,description}`+If-Match→固定编号/附件快照；只ready同project成果 |
| `GET G/deliveries` | Guest / P0-4 | 仅published可见成果；下载用同一files/content核权 |
| `POST G/deliveries/:id/feedback` | Guest / P2 | `{kind:comment\|received\|accepted,body?}`→追加记录；不赋予技术确认权 |
| `POST O/exports` / `GET O/exports/:id` | Owner / P2 | `{format:pdf\|png\|zip,snapshotRevision}`→job；完成后私有下载；未实现 |

`…` 表示对应O/G前缀，Guest只拥有表中显式列出的动作；未列出方法405或403。不存在通用“任意表CRUD”接口。Guest不能上传purpose=delivery、设置visibility=owner或confirmed状态。Owner登录响应也不返回service secret。

## 关键DTO（契约草案）

```typescript
type Point = { x: number; y: number }; // finite [0,1]，统一方向原始图
type Geometry =
  | { type: 'line'; from: Point; to: Point }
  | { type: 'circle'; center: Point; radiusX: number; radiusY: number }
  | { type: 'point'; at: Point }
  | { type: 'text'; at: Point; text: string };
type AnnotationRef = { id: string; revision: number }; // 正式存储修订
type ResponseInput =
  | { kind: 'numeric'; value: string; unit: 'mm'|'cm'|'m'|'in'|'deg'; evidenceFileIds?: string[]; body?: string }
  | { kind: 'photo'; evidenceFileIds: [string, ...string[]]; body?: string }
  | { kind: 'unable'; body: string };
// request envelope允许独立guestLabel?，仅显示标签，不代表认证身份
```

照片回复不强制value；unable必须说明；numeric是用户手动输入的十进制，不能从像素推断。长度正值、角度0–360、工程合理范围由具体issue字段指定；没有范围时不擅自判工程正确。确认DTO必须明确 `source: customer_numeric | owner_from_photo | owner_manual`，后两者require note；数值/单位同维度。文件级comment允许纯文字response（另加`kind:text`），测量请求不允许用空文字跳过三种明确路径。

审核状态：`awaiting_response → submitted → confirmed`；`submitted → remeasure_requested → submitted`。confirmed后的纠错需要显式重开事件/新请求（V1默认新请求，待批准），不能静默改confirmation。各动作核状态+revision+操作者，未定义转换409。
