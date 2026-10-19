# PartMeasure 前端与后端对齐文档

日期：2026-10-19（Asia/Taipei）\
依据：当前工作区的累计前端改版、现有 API / Zod 类型 / 服务层 / 正式 migration，以及用户本轮要求。\
文档性质：现状核对、接口交接与后续实施清单。**不是后端变更或部署授权。**

## 1. 阅读约定与结论

本文使用以下状态，避免把视觉完成写成业务完成：

| 状态 | 含义 |
| --- | --- |
| 已接通 | 前端正在调用仓库中已有后端实现；不表示本轮重新做过真实服务验收 |
| 前端临时 | 当前页面内存或外观提示可工作，但不能承诺后端保存、刷新或跨设备一致 |
| 待后端 | 当前前端意图仍需要补充数据、接口或事务能力；本轮未实现 |
| 待决策 | 需要先确定业务语义或范围，不能直接按建议建表 |
| 仅前端 | 布局、动画、选中项、弹窗等，不应因此新增业务字段 |
| 待验证 | 代码存在，但缺少当前版本的真实服务、浏览器、真机或网络证据 |

最需要对齐的事项：

1. **文件夹实体、项目归属、颜色持久化尚未接通**，当前只在项目列表内存中存在。旧项目目前没有重新归类入口。
2. **工程师工作台跟随颜色目前使用 URL 外观提示**，并非项目详情已返回数据库里的文件夹。
3. **资料图片是标准图上叠加已保存的几何标注**，不是后端已生成一份“带标注图片”；原图没有被覆盖。
4. **保存标注不等于私有草稿**；现有 Guest 权限允许读取已保存的可见标注。是否需要“发送前客户不可见”，必须另定发布语义。
5. **发送测量提醒是先保存标注、后创建提醒**，当前不是整张照片或多个提醒的原子发布。
6. **标注与提醒的关联字段已有**，主要缺口是列表 DTO 与按标注查询，不应再造一套关系字段。
7. **交付的私有草稿、原子发布与不可覆盖版本已有**，不能因为标注草稿尚缺而误判交付也没实现。
8. 手机属性弹窗、撤销/重做位置、圆角、动画、首页与认证页设计调整，本身不需要新表或新字段。

本轮只静态读仓库、写文档；未改业务代码、SQL、Auth、Storage、API、依赖或部署，未访问云端 schema，未打开浏览器。正式 migration 是代码依据，不是本轮云端核验结果。

## 2. 当前前端页面与用户流程

### 2.1 路由及角色

| 路由 | 当前用途 | 后端边界 |
| --- | --- | --- |
| / | 简洁产品入口、工程师登录入口 | 无新增业务数据 |
| /login | 邮箱+密码登录；注册后数字 OTP 确认 | 复用现有 Auth；不是“每次用 OTP 登录” |
| /projects | 工程师项目列表、临时文件夹、当前已加载范围搜索、新增项目 | Owner 私有项目；分类与全库搜索待接入 |
| /projects/[projectId] | 工程师工作台；用户称 [slug] 的页面 | 实际仍使用 UUID projectId，未增加 slug 字段或改路由 |
| /s/[token] | 用分享令牌换项目受限会话，随后跳转 | 令牌不是普通项目 ID，不用于读取全站项目 |
| /s/session?project=UUID | 客户协作工作台 | 必须有该项目的有效 Guest Cookie；query 中的 project 不能授予权限 |
| not-found / loading / error | 404、加载、未捕获错误与重试 | 展示层，不需要新增“错误页面”业务表 |

### 2.2 主区与上下文

- 当前用户可见名称为「资料与测量」「交付与版本」。历史 PRD/早期文档中的「资料与补测」指同一个资料区，**不是新增第三个业务区**。
- 桌面浏览资料时约 3:1 双栏同时展示；进入图片编辑后右侧切换为工程师「标注与属性」或客户「测量提醒与回复」；具体提醒仍能查看回复、审核、历史。
- 手机资料保持单列；点击照片标注可直接打开居中属性/填写弹窗，不再把属性常驻照片下方。
- 顶栏项目名居中、旁边箭头展开项目说明与角色提示；右上角主页图标到 /projects。Guest 点击主页仍按 Owner 登录规则处理，不能看到工程师列表。
- 项目说明编辑、分享生成/复制/撤销/重建收在工程师的项目说明展开区。
- 资料区右下角「上传」管理原始资料；手机提供拍照、文件、相册。成果附件仍从交付区上传，回复证据仍从回复表单选择，不能把三个用途混为一个“提交”。

### 2.3 完整主流程及容易混淆的动作

| 动作 | 实际结果 | 不应向用户承诺 |
| --- | --- | --- |
| 新建文件夹 | 当前页面内存中新增文件夹 | 已同步账号、刷新或跨设备保留 |
| 新增项目 | 真实创建项目；本页附加临时文件夹关系 | folderId 已被后端接受 |
| 上传资料 | 预约、上传、处理后形成 material 文件 | 传输 100% 就等于资料已就绪 |
| 在照片上画标注 | 本地编辑会话产生或修改几何 | 未点保存也已同步服务器 |
| 保存标注 | 逐条保存当前照片的变更及修订 | 私有草稿；所有变更整批原子成功 |
| 发送测量提醒 | 校验要求 → 保存标注 → 用成功修订创建站内 issue | 发邮件/短信；整批标注与提醒一个事务提交 |
| 上传测量证据 | 图片/附件成为可选 material 文件 | 已自动绑定回复、回复已提交 |
| 提交回复 | 显式提交选择的证据及本次数值/照片/无法测量说明 | 覆盖历史回复、客户自行确认 |
| 保存交付草稿 | 保存工程师私有成果清单与说明 | 客户已经可以看到或下载 |
| 发布交付 | 单次后端事务发布已保存的成果集合 | 可以覆盖已发布版本 |
| 下载成果 | 经核权按片下载后交给浏览器保存 | 前端提示成功等于真机系统文件一定已落盘并可打开 |

## 3. 页面功能与后端覆盖总表

| 编号 | 前端功能 | 现有依据 / 数据 | 状态与缺口 |
| --- | --- | --- | --- |
| P-01 | 全部项目、加载更多、创建、编辑说明 | projects 与列表/创建/PATCH 接口 | 已接通；列表每页 30 |
| P-02 | 文件夹名称、说明、七色 | folders / assignments React 状态 | 前端临时；缺实体与归属持久化 |
| P-03 | 分类数量、分类项目列表 | 当前已加载 items 的前端筛选 | 非全库数量；待分类查询与准确计数 |
| P-04 | 名称/说明搜索 | 对当前分类已加载项目作前端匹配 | 前端临时；缺服务端全库搜索 |
| P-05 | 工作台继承所属文件夹配色 | 固定 theme query + 七色白名单 | 前端临时；Owner 详情缺归属颜色，Guest 当前默认主题 |
| A-01 | 注册、数字码确认、密码登录、退出 | 现有 Auth API / SSR Cookie | 已接通；真实新注册送达与确认仍待验 |
| S-01 | 分享生成、重建、撤销、受限客户会话 | share_links / guest_sessions | 已接通；明文 URL 仅生成时返回 |
| F-01 | 拍照/相册/附件上传、处理、恢复、重试 | upload_reservations / jobs / file_assets | 已接通；刷新后的传输续传有边界，见第 6 节 |
| F-02 | 图片预览与已保存标注 | 标准图 + annotations | 已接通；不是标注图片导出 |
| F-03 | 非图片文件名称/格式/大小、下载 | file_assets 与受控文件接口 | 已接通；不在线解析 CAD 几何 |
| F-04 | 文件隐藏、原件下载、历史保护 | deleted_at / history_protected | 已接通；Owner 限定 |
| N-01 | 线、圆/孔位、点位、文字 | annotations.geometry / metadata | 已接通；无自动毫米测量 |
| N-02 | 修订、冲突、隐藏、撤销重做 | annotation_revisions + 本地会话 | 已接通；撤销重做不是后端历史回滚 |
| N-03 | 手机点标注填写，桌面右侧属性 | 相同标注 ID 与同一编辑会话 | 仅前端；不新增“手机标注表” |
| N-04 | 私有标注草稿 / 一次提交多个提醒 | 当前只有逐条保存与单条 issue 创建 | 待决策与待后端；不可套用交付草稿假设 |
| N-05 | 标注永久显示编号 | 当前可见列表顺序 | 前端临时；永久编号待定 |
| M-01 | 从标注发出测量提醒 | issues 的固定 annotation_revision / snapshot | 已接通；发出后位置固定 |
| M-02 | 点某标注查询其测量提醒 | 读文件提醒列表，再读详情核对 ID | 已接通兼容方案；摘要/过滤接口待补 |
| M-03 | 文件级文字问题 | kind=comment、file_id | 已接通；没有几何目标也能提问 |
| R-01 | 数值、照片、无法测量、文字回复 | issue_responses / response_attachments | 已接通；附件最多 10 |
| R-02 | 工程师确认、人工修正、要求重测 | issue_reviews、issue revision、latest_response_id | 已接通；历史追加保留 |
| R-03 | 待回复/待审核数量及任务汇总 | issues 列表 counts + 角色优先级 | 已接通；不是外部通知系统 |
| D-01 | 交付草稿、多个附件、发布、版本、下载 | deliveries / delivery_files | 已接通；最新发布集合 + 最多 5 个草稿 |
| D-02 | 全部交付历史管理、反馈、接受确认、导出 | 当前 UI 没有开放相应流程 | 非本轮缺字段承诺，单独范围审批 |
| U-01 | 动效、主题层级、弹窗、焦点与安全区 | CSS / React / visualViewport | 仅前端；浏览器与真机效果待验 |

## 4. 项目、文件夹、搜索与主题

### 4.1 当前真实项目契约

现有项目 DTO：id、name、description、revision、createdAt；详情另有 share（Owner 返回最新链接的 id / expiresAt / revokedAt，Guest 为 null）。没有 folderId、folderColor、slug 或文件夹计数。

- 项目名称去首尾空白，1～120 字符；说明最多 4000 字符。
- 创建/编辑输入是严格 schema，当前只接受 name、description。**现在直接多传 folderId 会被拒绝，不是后端会默默保存。**
- 列表按创建时间与 ID 倒序，每页 30，nextCursor 为 UUID 或 null；不是 offset 分页。
- 文件夹下新建项目成功后只在本页 assignments 保存归属；目前不自动跳走，以保留临时分类。
- 已按用户要求移除项目行右侧“所属文件夹”信息和归类控件。当前不存在给已有项目重新分类的入口；后端归类更新接口的建议不等于该 UI 已批准恢复。

### 4.2 待新增数据：单层文件夹草案

下表是待实施契约建议，必须与未来接口/迁移一起审核：

| 对象 | 字段 | 约束 / 默认 |
| --- | --- | --- |
| project_folders（建议名） | id | UUID；前端不要依赖临时生成的 ID 一定被后端采用 |
| 同上 | owner_id | 由已认证用户确定，不信任客户端提交；不同账号隔离 |
| 同上 | name | 与现有前端对齐为 trim 后 1～60 字符；同账号名称归一化后不重名；保留“全部” |
| 同上 | description | 可选，默认空字符串，最多 500 字符 |
| 同上 | color | 只接受 blue / cyan / green / purple / rose / coral / slate；不接受任意 CSS 或 URL |
| 同上 | created_at / updated_at | 服务端生成时间 |
| 同上 | revision（建议） | 若后续开放改名、改色等并发更新，采用与现有 CAS 一致的修订；不是当前已存在列 |
| 同上 | sort_order（按需） | 仅在排序需求获准时增加，不因左侧栏存在就必须新增 |
| projects | folder_id | 可空；一个项目最多一个文件夹，且 folder 与 project 同 owner；历史项目默认 null |

“全部”是所有项目的查询视图，不是数据库文件夹；null 表示尚未归类，不能把它解释成“全部文件夹 ID”。删除文件夹不能级联删除项目或资料；改名、删除、拖拽移动和排序尚未确定交互与权限规则，不在本轮顺便开放。

### 4.3 待补接口建议（均未存在）

| 能力 | 建议契约 | 必须明确 |
| --- | --- | --- |
| 列文件夹 | GET /api/project-folders | 当前 Owner 的文件夹、确定性排序；数据多时的分页/数量上限 |
| 新建文件夹 | POST /api/project-folders，name / description / color | CSRF、幂等、归一化重名；服务端返回权威 ID 与完整对象 |
| 项目创建时归类 | 现有 POST /api/projects 增加可选 folderId | 新项目与归属在一个事务内成功；不能创建成功却归类失败仍报全成功 |
| 列表/详情返回归属 | 项目 DTO 增加 folderId；Owner 详情返回颜色或最小 folder 摘要 | 兼容无分类历史数据；不把 Owner 文件夹详情暴露给 Guest |
| 分类分页/搜索 | 现有 GET /api/projects 扩展分类与 q 查询 | 分类、关键词、排序需绑定游标；切换条件重置游标 |
| 准确计数 | 明确 allCount、folderCount、searchMatchCount 的范围 | 全库/当前文件夹/当前搜索不能混用；与查询条件和权限一致 |
| 移动既有项目 | 后续在有明确交互时设计 | 所属项目与目标文件夹同 owner；保留项目 revision；不靠批量扫描前端列表更新 |

文件夹重名建议独立稳定错误码（如 FOLDER_NAME_EXISTS）；不存在/越权对外使用现有不泄露资源存在性的错误语义。最终名字及状态码由接口设计确认，不能把这里的建议当成已可调用接口。

### 4.4 搜索与颜色规则

- 当前搜索按名称或说明包含匹配，忽略前后空白及英文大小写；只覆盖当前分类已加载数据，继续加载后扩充范围。后端全库搜索应先保持相同语义，再讨论模糊匹配、分词或索引。
- 搜索不改变项目归属；无结果不等于该账号数据库里没有结果。不同分类、关键词的分页不能拼接。
- 七色标识由前端映射为实色页面、面板、按钮及标注色；数据库存标识即可，**不需要再加 projects.background_color 或每个 CSS 变量的列**。
- 当前项目链接从 assignments 查该项目自己的文件夹，在 /projects/ID?theme=rose 等链接传外观；从“全部”进入也不拿“全部”的背景冒充项目归属。
- 带 theme 的工作台刷新可恢复该外观；服务端首屏/占位使用默认主题，客户端再应用提示。非法 theme 回默认；Guest 当前忽略 theme。
- theme 不能参与核权。跨设备、旧链接或刷新项目列表后无归属信息时，只能使用默认主题；不能从 URL 参数推断数据库关系。
- 后端接入后以服务端归属为准，移除内存分类与“刷新重置”提示及对 query 的业务依赖；如未来要 Guest 同色，只返回核权后的颜色标识，不能附带私有文件夹列表、名称、说明。

## 5. 认证与分享

### 5.1 当前接口

| 方法与路径 | 输入 / 返回关键点 |
| --- | --- |
| POST /api/auth/register | email、password；confirmationRequired；注册不能靠自动创建登录会话绕过邮箱确认 |
| POST /api/auth/verify | email、token（6～10 位数字）；确认邮箱后进入项目 |
| POST /api/auth/login | email、password；通过已确认邮箱的密码登录 |
| POST /api/auth/logout | 退出 Owner 会话 |
| GET /api/auth/session | authenticated、id；不是给 Guest 的全站身份 |
| POST /api/guest/session | 43 字符分享 token；设置对应项目 HttpOnly Cookie，返回 projectId |
| POST /api/projects/P/share-links | 创建/重建分享，返回 id、expiresAt、url（可能为 null）、replayed |
| DELETE /api/projects/P/share-links/S | 撤销对应分享，返回 revoked |

email 最多 254 字符；密码 12～128。OTP、密码不进业务表/日志。注册 OTP 与后续密码登录的产品约定优先于旧 PRD“邮箱 OTP 登录”的概述。

### 5.2 需保留的能力边界

- 分享令牌和 Guest secret 仅存哈希；分享默认 30 天，Guest 会话有效期不超过 24 小时且不超过链接到期。
- 重建/撤销使旧链接及其会话失效；在核权前不能返回私有资料。
- 明文分享 URL 不保存在幂等结果中。同键重放可能只返回 null URL，丢失首次响应后需要用户明确重建，不能指望“再次查询”拿回原令牌。
- Guest 的 guestLabel 是自填显示称呼，不是认证身份或可信授权来源；当前没有客户账号、指定人员任务分配或“只有此称呼能看此回复”的模型。
- 点“发送测量提醒”只创建站内记录；当前没有邮件、短信、推送订阅或消息已读/送达字段。
- 登录、注册、确认、失效与错误页面的设计改动无需新增数据库字段。密码重置、OTP 重发、邀请系统等不是本轮已实现功能。
- 真实新注册邮件送达、数字码确认和后续密码登录仍待单列验证，不能用已配置 SMTP 或管理员手工确认替代。

## 6. 文件资料、上传、预览与下载

### 6.1 用途隔离及数据

| 用途 | 当前保存方式 | 权限 / 关联 |
| --- | --- | --- |
| 原始资料 | purpose=material | Owner / 有效 Guest 上传；按客户可见性展示 |
| 回复证据 | 仍是 material 文件 | 显式以 evidenceFileIds 绑定 response_attachments；没有第三种 purpose=response |
| 成果附件 | purpose=delivery | 仅 Owner 上传；未发布 internal，发布后受 delivery 关联控制 |

上传核心数据已有：upload_reservations 的 project_id、actor_key、share_id、filename、extension、declared_mime、byte_size、sha256、purpose、state、error_code、授权/清理时间；处理任务在 jobs；就绪资产在 file_assets，含标准文件与原件 key/hash/大小、mime、width/height、normalization_version、visibility、deleted_at、history_protected。

UI 不能拿文件名当身份、不能提交客户端 owner_id 取得归属，也不能将 storage_key 或管理员凭据作为普通 DTO 返回。

### 6.2 当前接口清单

下文 B 表示 Owner 的 /api/projects/P，或 Guest 的 /api/guest/projects/P。不表示所有接口都对两角色开放。

| 方法与相对路径 | 输入 / 输出 | 限制 |
| --- | --- | --- |
| GET /api/upload-policy | maxFileBytes | 当前是部署总上限，不是完整的按格式策略 |
| POST B/uploads | filename、byteSize、declaredMime、sha256，可选 purpose；返回预约 id 等 | Guest 不可 delivery |
| GET B/uploads?purpose=... | items：id、filename、state、errorCode | 默认 material；Owner 项目范围、Guest 自己的预约；当前近一天、最多 30 |
| POST B/uploads/U/grant | signedUrl / token / path / bucket / supabaseUrl，或已有 state | 短期上传能力，不能记日志或当永久文件地址 |
| POST B/uploads/U/complete | 确认对象上传；202 | 进入服务端校验/任务管线，不是就绪证明 |
| GET B/uploads/U | state、errorCode 等状态 | 前端处理轮询 |
| POST B/uploads/U/retry | 重试处理；202 | 后端判断是否可重试，不能越过扫描 |
| GET B/files?purpose=...&cursor=... | items、nextCursor；文件摘要含 id、filename、mime、extension、byteSize、width/height、uploaderType、createdAt | 每页 30；默认 material；Guest 不可列 delivery 文件池 |
| GET B/files/F/preview | 私有标准图片字节 | 现有标准 WebP，非任意文件预览；不支持 original 预览 |
| GET B/files/F/download | 私有文件字节 | Guest 只读合法可见资料/已发布成果 |
| GET B/files/F/download?original=1 | 原件字节 | 仅 Owner；保留原件用途与 hash |
| DELETE B/files/F | deleted | 仅 Owner；有历史保护返回拒绝，不删除历史 |

上传的正常服务端状态为 reserved → queued → processing → ready；rejected / cleaned 是终止/清理分支。前端 waiting / uploading / processing / ready / failed 是本地展示状态，不应原样另建一套数据库枚举；grant 的 uploaded 也是传输判断，不是正式预约状态。

### 6.3 实际限制，不能沿用已删除说明的旧承诺

- 每批前端最多选择 20 个；并不意味着本次 API 有一个“20 文件批次事务”。
- 允许扩展名：jpg、jpeg、png、webp、pdf、step、stp、sldprt、sldasm、stl、dxf、dwg、zip。HEIC、视频未开放；手机相册入口不能让后端自动接受未支持格式。
- 代码格式策略：图片 20 MiB、PDF 50 MiB、其余允许附件 100 MiB；**最终取格式上限、部署 effectiveFileLimit 和真实 Storage 限制的较小值**。
- effectiveFileLimit 默认 50 MiB，可受部署配置限制，最多不超过代码的 100 MiB。文档不能把供应商全局限额和 MiB 换算当作自动等价，也不能承诺当前可传 100 MiB。
- 项目预算 1 GiB、账号 5 GiB、日上传预算 500 MiB；图片派生预留预算另计。它们是仓库策略，不是当前剩余额度查询结果。
- MIME、真实内容、SHA-256/大小、扫描、图像方向标准化及配额仍由服务端校验；删除静态限制文案没有放宽任何校验。
- 建议后续 upload-policy 返回明确的允许类型、按格式上限及有效部署限额，避免前端复制规则；这主要是接口完善，无需为每条提示建数据库字段。

### 6.4 传输、恢复与预览对齐

- 小文件通过签名 PUT，超过 6 MiB 使用已接入的签名 TUS 路径与 6 MiB 分块；前端顺序发起当前选择批次，服务端处理异步完成。
- 上传传输进度到 100% 后仍须等 ready；失败要区分传输失败、处理可重试、终止拒绝和授权窗口过期。
- 刷新后能从预约列表恢复已到服务端的处理状态；**浏览器 File 对象、未传完字节和 TUS 指纹没有持久化保证**，不能称为刷新后任意断点自动续传。可能需要重新选择原文件。
- 当前 material/标准图浏览不是公开桶。图片经受控预览接口读取，next/image 不走会丢失认证的图片优化代理。
- 图片方向与标注坐标以标准图为准，不用原始 EXIF 方向或缩略裁切尺寸保存标注。
- 资料区“已标注图片”是 SVG 叠加已保存标注。没有为每次标注生成新图片，也没有覆盖原件；带标注图片下载/报告生成是另外的导出能力。
- 当前缩略区仍加载标准图，没有专用小尺寸派生规格。若照片量大，优先设计带权限的缩略规格、批量摘要与修订失效机制，不增加公共 URL。

## 7. 照片标注与工程属性

### 7.1 已有字段，不应重复加列

| 前端输入 | 当前字段与约束 |
| --- | --- |
| 标注身份 | annotation.id 为 UUID；稳定身份不等于 UI 显示序号 |
| 线段 | geometry：type=line、from/to 的 x/y，均为 [0,1] |
| 圆 / 孔位 | geometry：type=circle、center、radiusX/radiusY；按标准图宽高归一化，真实像素半径一致 |
| 点位 | geometry：type=point、at |
| 文字位置/内容 | geometry：type=text、at、text；文字 1～500 |
| 名称 | metadata.name，最多 120 |
| 人工尺寸 | metadata.dimension，可空正十进制字符串 |
| 单位 | metadata.unit：mm / cm / m / in |
| 直径/半径 | metadata.circleMeasure：diameter / radius |
| 孔深 | metadata.holeDepth，可空正十进制字符串，使用对应单位 |
| 孔类型 | metadata.holeType：空、through、blind、threaded、counterbore、countersink、other |
| 螺纹 | metadata.thread，最多 80 |
| 备注 | metadata.notes，最多 2000 |
| 人工来源 | metadata.source 固定 human，不是算法识别结果 |
| 修订/隐藏 | revision、deleted_at；DTO 为 deleted；annotation_revisions 追加快照 |

尺寸字符串不接受负值、科学计数法或零，最多 9 位整数、6 位小数，字段总长最多 24；编辑中的不完整小数不能作为已校验结果保存。非圆不带孔字段；点/文字不填写人工尺寸。几何不得越界，线/圆满足已有最小原图像素约束。像素长度不能自动变成人工尺寸。

### 7.2 当前接口及保存语义

| 方法与路径 | 关键契约 |
| --- | --- |
| GET B/files/F/annotations | image：id / width / height / imageHash / normalizationVersion；items：几何、metadata、revision、deleted、时间 |
| POST B/annotations | id、fileId、geometry、metadata、imageHash；Owner；返回已提交 Annotation |
| PATCH B/annotations/A | geometry、metadata、imageHash + 修订头；Owner |
| DELETE B/annotations/A | 修订头；Owner；隐藏并留历史 |
| GET B/annotations/A/revisions?before=N | Owner；items、nextBefore；每页 30；before 为修订号，不是 UUID cursor |

imageHash 是当前标准图版本基准，不是“原文件 hash”或随意文件名。图片版本不符必须保留输入并停止保存，不能把几何强行套到新图。

当前保存循环按标注分别创建/修改/隐藏，不变项跳过；某个请求失败时先前成功的修改不会回滚。重试使用未完成操作保留的幂等键与原修订。撤销/重做只是当前会话编辑历史，不会删除服务端追加历史；刷新后不能恢复未保存会话。

工程师可读自己的隐藏标注及修订；Guest 的当前标注列表只读未隐藏项，不能调用写接口或完整标注修订接口。已保存且符合现有权限的标注并没有“未发送私有”状态。

### 7.3 手机弹窗与桌面属性的统一

点击缩略图标注按 annotationId 打开同一属性会话；移动端弹窗与桌面侧栏不维护两份独立数据。关弹窗不等于提交，也不等于丢弃，仍保留挂载和输入；切换目标、文件、工作区或离开要遵守未保存/未确认请求保护。缩放/平移、命中区域、软键盘和动画阶段是前端状态，不需要数据库列。

工具栏常驻顺序为线段、圆/孔位、点位、文字、撤销、重做。删除/修订等保留上下文入口与原权限；移除可见放大缩小按钮不等于移除画布缩放能力。

### 7.4 需先定语义的后端增强

| 编号 | 能力 | 必须先确定的规则 |
| --- | --- | --- |
| G-04 | 私有标注草稿 / 显式发布 | “保存”“发送”各公开什么；Guest 读哪个修订；发布后修改时旧公开版本是否保留；无提醒的文字能否单独发布；隐藏已关联提醒的标注如何展示历史 |
| G-05 | 多标注/多提醒原子提交 | 批次边界是单张图还是多张；整批幂等、逐项 expected revision、无变化项、局部校验失败、超时重放、返回 ID/修订映射；不能前端 Promise.all 模拟事务 |
| G-06 | 永久标注编号 | 是否要求文件内单调、不复用、隐藏后不重排；旧数据回填；是否把编号纳入提醒快照；当前列表 index+1 不能充当永久编号 |
| G-07 | 批量摘要/缩略规格/失效信号 | 每文件的标注版本、预览版本、权限、上限、缓存/重新获取条件及大列表分页；避免把当前图层当永久渲染资产 |

上述为待决策和待设计能力，不要求机械新增 draft、published、number 等几个列就算完成；发布权限必须同时覆盖 API、DAL、RLS、预览读取与历史快照。**不得把交付私有草稿的实现直接等同于标注已具备同样语义。**

## 8. 测量提醒、文件问题、回复与审核

### 8.1 提醒与文件问题

UI 使用“测量提醒”，后端仍为 issues.kind=measurement；改词不需要重命名表。普通文件问题为 kind=comment，无几何目标。

| 项目 | 当前契约 |
| --- | --- |
| 创建测量提醒 | POST B/issues：kind=measurement、fileId、annotationRef:{id,revision}、title、targetInfo、description、measurementMethod |
| 创建文件问题 | POST B/issues：fileId、title、description，不带 measurement kind |
| 项目待办 | GET B/issues?cursor=UUID：items、nextCursor、counts |
| 文件问题/提醒 | GET B/files/F/issues?cursor=UUID；目前没有 annotationId 过滤 |
| 详情 / 历史 | GET B/issues/I 或 B/issues/I/history；包含 target、responses、reviews |

title 为 1～120，targetInfo 为 1～2000，description 最多 4000。measurementMethod 为 outside / inside / depth / other / unspecified。测量标题取标注名称或默认类型名，不另造“标注名称同步列”；issue 是发送时独立记录，之后改标注名不能静默改历史问题。

现有 issues 已保存 annotation_id、annotation_revision、annotation_snapshot，并通过项目/文件/修订关系约束引用。详情 target 返回 annotationRef、固定 geometry/metadata 及标准图基准。发送后编辑照片上的当前标注，不得改变旧提醒的测量位置。

同一标注可另发多条提醒；不应假设 annotationId 与 issueId 一对一。文字标注可仅保存而不发测量请求。

### 8.2 精准关联的接口缺口

IssueSummary 当前含 id、fileId、kind、title、description、targetInfo、measurementMethod、state、revision、latestResponseId、时间，**不含 annotationRef**。前端暂时：

1. 读取当前文件一页提醒；
2. 最多 4 个并发读详情；
3. 同时核对真实 fileId 与 target.annotationRef.id；不凭名称猜测；
4. 保留分页“继续查找”；请求过期或弹窗关闭后不强行跳出新的表单。

后端建议返回 annotationRef:{id,revision}|null，支持文件内按 annotationId 过滤。普通文件问题返回 null；完整 target snapshot 仍由详情获取。cursor 必须绑定角色、项目、文件、过滤条件与排序。

Guest 在结果足够明确时可直接进入对应提醒；多条结果仍需选择。当前文件提醒接口返回的 counts 是**项目范围**，不能当作该标注或该文件的计数；新接口要明确 countScope。

### 8.3 回复字段

POST B/issues/I/responses 需要 issue 当前修订头与幂等键；追加响应，不覆盖旧记录。

| kind | 必填 | 其他字段 |
| --- | --- | --- |
| numeric | value 正十进制字符串、unit | body≤4000、evidenceFileIds≤10、guestLabel≤80 |
| photo | evidenceFileIds 至少含一张已处理就绪的合法图片 | body、guestLabel；不能只选 PDF 假装照片证据 |
| unable | 非空 body 说明 | 可选 evidenceFileIds、guestLabel |
| text | 非空 body | 文件级 comment 使用，measurement 不接受此种替代数值/照片/无法测量 |

附件必须去重、同项目、可共享且就绪；不能选择交付私有文件或其他项目文件。上传后仍须显式勾选本次证据并提交回复。证据引用受历史保护，不能后续软删除让审核失去依据。

### 8.4 状态机与审核

| 当前状态 | 允许动作 | 下一状态 |
| --- | --- | --- |
| awaiting_response | Owner/Guest 按权限追加回复 | submitted |
| remeasure_requested | Owner/Guest 按权限追加新回复 | submitted |
| submitted | Owner 确认 | confirmed |
| submitted | Owner 要求重测 / 补充说明 | remeasure_requested |
| confirmed | 当前不接受直接再提交/覆盖确认 | 需要新问题时另建，不能私改历史 |

POST B/issues/I/review 输入 decision、responseId、value、unit、source、note，要求当前 issue revision 和最新 responseId。并发新回复/审核冲突时不覆盖旧内容。

- confirm 测量：value/unit 必须有效；source 为 customer_numeric（保持客户原值和单位）、owner_from_photo（照片回复，必须说明人工录入）、owner_manual（人工修正/录入，必须说明）。
- confirm 文件问题：source=comment，value/unit 为 null。
- remeasure：note 非空，value/unit/source 为 null。
- source 字符串是数据来源说明，不是 AI 可靠性判断，也不授权客户审核自己。
- 手机客户点击标注后填写的是对应 issue 的回复，不是 PATCH annotation.metadata；工程师的标注“人工尺寸”、客户本次数值与审核最终值是三层不同记录。当前审核不会自动把最终值写回标注 metadata；若未来要联动，必须明确同步规则、来源、修订冲突及历史，不能静默覆盖。
- 回复、附件、审核与状态推进按各自已有事务追加；当前每个问题最多 100 轮回复，详情历史当前上限 100，不能把它包装为无限分页历史。

### 8.5 待办与刷新

项目待办每页 30，Guest 优先待回复/重测，Owner 优先待审核；counts 来自服务端状态汇总，不是当前页长度。折叠汇总在页面可见时约每 20 秒刷新；展开后不自动重排，保留人工刷新。不是 WebSocket 实时推送，也没有未读消息/通知收件人模型。

## 9. 交付、版本与受控下载

### 9.1 已有数据与接口

deliveries 已有 id、project_id、description、revision、state、version_no、created_by/published_by、时间；delivery_files 已有 project_id、delivery_id、file_id、position、selected。

| 方法与路径 | 当前行为 |
| --- | --- |
| GET B/deliveries | published：最新发布集合或 null；drafts：Owner 最多 5 个，Guest 为空 |
| GET B/deliveries/D | 按权限读取集合，含已选文件 |
| POST B/deliveries | description≤4000、fileIds≤20 且不重复；创建私有草稿，允许空清单保存 |
| PATCH B/deliveries/D | 同上，加 expected revision；已发布不得修改 |
| POST B/deliveries/D/publish | 空 JSON，加 expected revision / 幂等键；发布需 1～20 个合法就绪成果 |
| GET B/deliveries/D/files/F/download | 核对本集合附件与访问权限，再流式返回文件 |

附件 DTO 为 id、filename、mime、byteSize；集合 DTO 为 id、description、state、revision、versionNo、createdAt、publishedAt、files。versionLabel 仅把数字显示为 V001 等，版本号由服务端分配，前端不可指定或覆盖。

### 9.2 不可被 UI 精简破坏的规则

2026-10-19 空状态精简：工程师交付区无成果可选、也无已有文字草稿时，只显示“上传文件，开始交付”和图标上传入口。上传中/处理中展示队列，服务端 ready 文件进入可选清单后再展开交付说明与保存/发布区域。已有文件或文字草稿仍直接恢复；不自动勾选附件、不自动保存或发布。当前没有新增后端字段或更改用途/权限。

- 资料区与成果文件池按 purpose 隔离；成果必须同项目、Owner 上传、ready、未删除。
- 交付草稿与未发布成果不可给 Guest 列表、详情、下载或通用文件接口读取。
- 发布按一次事务校验清单、分配版本、记录发布及审计、更新可见性和历史保护；失败不出现“集合发了、部分附件没发”的半发布状态。
- 已发布不可原地覆盖，下一次成果使用新集合；移除“已发布不会覆盖……”那段说明，只是文案删除，约束仍需存在。
- 当前 UI 只展示最新发布集合，不等于历史数据被清除，也不等于已有完整历史浏览/分页。
- 进入标注/属性上下文时交付组件保持挂载；暂时隐藏不应清空未保存草稿，编辑与发布 pending 状态不能互相覆盖。

### 9.3 下载契约

当前成果下载按 4 MiB 分片请求 Range，在同一挂载会话中重试利用已完整收到的片段；取消/卸载清理片段。每片都走有会话核权的应用接口，不把长期 Storage URL 交给客户端。

- 正常分片返回 206、准确 Content-Range / 字节数；非法 Range 返回 416 及 bytes */total。
- 保留 Content-Type、Content-Disposition、Content-Length、Accept-Ranges 等语义；图片标准文件扩展名按 WebP 处理，原件仅 Owner。
- 401/403/404 不继续使用失去权限的断点；会话失效须关闭对应访问。已下载到设备的副本不能撤回，已开始的传输也不能夸大为可即时召回。
- 后端内部使用 60 秒 Storage 签名地址并代理流，不能把它当作永远有效的业务链接。
- 当前内存拼接下载不等于跨刷新持久续传，大文件内存和手机保存行为待实测。

完整交付历史管理、客户反馈、接受确认、整包 ZIP、PDF 报告和带标注图片导出仍未开放；本对齐文档不新增这些业务的表或 API。

## 10. 通用契约、权限、并发与异常

### 10.1 请求与 DTO 约定

- JSON 成功响应为 {data,requestId}；失败为 {error:{code,message},requestId}。文件字节流不套 JSON。
- 动态私有数据使用 private, no-store；成功 JSON 按 Cookie 区分，不进入公开 CDN 缓存。
- 非 GET 写请求使用同源校验与 CSRF；前端先 GET /api/csrf，再送 x-csrf-token。是否要求 Idempotency-Key 以具体接口为准，不能把前端自动带头等同于所有接口都有幂等事务。
- 业务更新头为 X-PM-Revision: "N"；是带引号正整数，与 HTTP ETag 分开。旧 If-Match 兼容存在，但新客户端使用业务修订头。
- UUID、字段长度、枚举、未知字段、JSON 体大小均由服务端校验。当前 JSON 体上限 64 KiB；未来批次接口需要明确载荷上限，不能无界加数组。
- 数据库 snake_case 与 API camelCase 在服务层转换；DTO 不直接返回内部数据库行或 Storage key。
- byteSize 来自 PostgreSQL bigint 时为字符串；当前部分前端 Asset 类型写为 number，使用时做 Number 转换。后续应统一 DTO 类型为十进制字符串，在显示/下载范围内校验安全转换；不要改成有精度风险的任意 JS number。
- 人工尺寸/value 保留十进制字符串，不用浮点或自动单位换算静默改原回复。时间统一服务端带时区表示，显示时本地化；服务端决定版本/修订。

### 10.2 幂等与冲突

同一未确认操作重试必须沿用同 key、同请求体、同 expected revision。更改输入后的新业务操作才用新 key；幂等冲突不能靠随机换键重发来掩盖。

当前标注保存、回复/审核/交付写入和项目创建分别保存 pending 信息；基础 api() 默认可生成随机 key，不能推断所有按钮在网络失败后的重试都自动满足上述条件。新接入文件夹接口需显式设计 pending 生命周期、刷新后查询/恢复与幂等结果。

| 情况 | 前端应有表现 | 后端契约 |
| --- | --- | --- |
| 401 / LINK_UNAVAILABLE | 停止访问、关闭私有上下文、转登录或失效页 | 不泄露数据，撤销会话不能继续用 |
| 403 / CSRF_INVALID / FORBIDDEN | 区分安全凭据与操作权限，提供合适恢复 | 不把客户升级成 Owner |
| 404 | 内容不可用，不显示其他账号内容 | 资源不存在和越权保持不泄露语义 |
| 409 / REVISION_CONFLICT 等 | 保留输入并要求重载/重新选择；不覆盖 | CAS 检查在事务中执行 |
| 428 / REVISION_REQUIRED | 保留输入、恢复权威修订再操作 | 不把缺修订当 revision=1 |
| 422 / 输入无效 | 精确提示并允许修正输入 | 再次执行同样校验，不信任 HTML 限制 |
| 413/415 / 文件大小或格式 | 不展示就绪资产，提示换文件 | 服务端有效策略权威 |
| 429 | 显示稍后重试，不无限自动重发 | 保留 Retry-After，限流不依赖客户端计数 |
| 503 / 超时 / 断网 | 结果可能未知，保留输入/pending，同操作安全重试 | 不把响应丢失当作事务必然失败 |
| 处理失败 | 区分重试与终止，保留错误码 | 扫描失败不可默认为通过 |

这是联调目标，不表示每个现有错误入口都已做相同细分；目前工程师工作台 API 返回 401 时也复用链接不可用展示，是否按角色改为登录恢复属于前端待核对项，无需新增数据库字段。

尚未映射到中文的新增错误码应补前端 messages；未知错误保留安全的通用说明。调试使用脱敏 requestId/错误码，不记录密码、OTP、明文分享令牌、签名上传 URL、Cookie 或连接串。

### 10.3 角色权限矩阵

| 能力 | Owner 本人项目 | 有效 Guest 当前项目 | 其他账号 / 无效会话 |
| --- | --- | --- | --- |
| 列全部项目、创建/编辑项目、管理分类、分享 | 允许；分类后端待接 | 拒绝 | 拒绝 |
| 上传/读客户可见 material | 允许 | 允许 | 拒绝 |
| 读原件、隐藏资料 | 允许，服从历史保护 | 拒绝 | 拒绝 |
| 读当前可见标注 | 允许 | 允许，只读 | 拒绝 |
| 写标注、完整修订管理、创建测量/文件问题 | 允许 | 拒绝 | 拒绝 |
| 查看当前项目提醒、追加合法回复 | 允许 | 允许，服从任务状态 | 拒绝 |
| 确认/人工修正/要求重测 | 允许 | 拒绝 | 拒绝 |
| 读写交付草稿、成果上传、发布 | 允许 | 拒绝 | 拒绝 |
| 查看/下载已发布授权成果 | 允许 | 允许 | 拒绝 |

权限必须在接口、DAL、数据库/RLS 和私有文件读取中执行；前端 hidden、颜色、查询参数和按钮缺失不是权限。沿用私有 pm schema 与受限运行角色，不能因为新增文件夹就开放浏览器对业务表或 Storage 的直接读写。

## 11. 刷新一致性、前端临时状态与待补项

| 当前行为 / 风险 | 责任与处理方向 |
| --- | --- |
| 文件夹/归属刷新丢失、旧链接无主题 | 后端实体/DTO 与前端替换临时状态；不引入无账号隔离的 localStorage 假装完成 |
| 当前图层编号隐藏后重排 | 若确认需永久编号再设计后端；日常关联始终使用真实 UUID |
| 本地保存后刷新对应缩略标注；其他设备改标注未必自动更新已有缩略图 | 文件列表暂无 annotationVersion 摘要；需修订失效信号或受限批量刷新，不声称实时同步 |
| 资料约每 15 秒刷新首屏，加载更多与自动刷新可能发生数据集替换 | 前端需核对已加载页合并/游标恢复策略；不是靠新增文件夹字段就能解决 |
| 图片已显示但标注读取失败 | 分别显示图片/标注状态及重试，不能把“没读到标注”当作“确认无标注” |
| 标注/回复/交付输入、弹窗选中项与 pending 只在当前挂载会话保存 | 离开保护不等于持久草稿；重新登录/刷新恢复能力需明确范围 |
| 项目名称/说明编辑区的未提交输入未纳入工作台统一 dirty 汇总 | 前端待完善项；不需要新后端字段，不能宣称所有表单都有同样离开保护 |
| 回复证据与交付附件上传已完成但没提交清单 | 文件存在不等于业务关联完成；保留显式勾选/保存/发布步骤 |
| 同项目多个 Guest 共享授权可见资料/问题 | 不是按自填称呼隔离的多人私聊；个体任务归属需另定身份模型 |

这些是源码核对得到的边界或待检查项，不是本轮已复现并修复的缺陷，也不构成未经批准的代码改动。

## 12. 后端缺口台账与建议顺序

| ID | 缺口 | 类型 | 建议输出 / 完成条件 |
| --- | --- | --- | --- |
| G-01 | 文件夹、归属与权威主题 | 新数据 + DTO/API/RLS | 文件夹元数据、projects.folder_id、Owner 同属校验、创建归类原子性；刷新/跨设备恢复 |
| G-02 | 服务端分类搜索与计数 | 查询/API/索引评估 | q/分类/排序绑定分页；准确 count scope；不只过滤一页 |
| G-03 | 提醒摘要 annotationRef 与按标注查询 | 优先接口补充 | 复用现有外键/快照，去掉前端 N+1 详情兼容读取 |
| G-04 | 标注私有草稿/公开修订 | 先定业务，后数据/权限 | “保存”和“发送”可见性明确，所有 Guest 读取路径一致执行 |
| G-05 | 标注与提醒批次原子提交 | 先定事务边界 | 整批校验/幂等/CAS/回滚/超时重放；不能有半发布 |
| G-06 | 永久显示编号 | 先定需求，后字段/约束 | 不复用编号、历史回填、快照一致；不能用数组下标 |
| G-07 | 缩略派生、批量预览与修订摘要 | 性能接口/派生策略 | 受控读取、规格版本、失效与配额；不开放公共桶 |
| G-08 | 完整上传策略给前端 | 接口完善 | 部署与格式有效上限一致、明确格式/错误码，避免多份常量漂移 |

建议先做 G-01/G-02，使分类与颜色成为真实可保存功能；G-03 可独立减少手机点标注时的额外请求；G-04/G-05 必须作为一组业务发布设计评审，再安排编号/性能等增强。此顺序是交接建议，**不是立即执行后端、P1/P2 或生产部署的指令**。

无需新增字段的部分：页面圆角与颜色映射、遮罩/动画、手机尺寸、visualViewport、工具栏位置、选中项/弹窗开关、布局比例、撤销/重做栈、缩放平移、现有工程属性输入、提醒与标注关联本身、首页/登录/错误页。新增字段必须对应可说明的持久业务事实，不能为每个 UI 控件各建一列。

## 13. 后续接入与兼容要求

1. 先冻结每项 DTO、错误码、空值、长度、权限和事务规则；新增契约明确区分 Owner/Guest。
2. 按已授权阶段准备独立 SQL 草案、迁移与权限测试；本文件不生成 SQL，不把未来草案整体部署。
3. 文件夹迁移为历史项目保留 null；不要猜归属或按项目名自动分组。私有标注发布如实施，要明确旧数据的公开/草稿迁移，不能悄悄隐藏现有客户任务。
4. 后端先提供兼容字段/接口，前端再切换；当前 strict projectInput 不兼容直接多传 folderId。
5. 前端取服务端真实 ID/revision，替换 folders/assignments 临时状态；可取消操作与失败保留输入，提交中防重复。
6. 每个查询条件独立分页；修改归属/颜色后更新列表、详情与主题；退出/换账号不复用上一账号缓存。
7. 移除临时兼容逻辑前，要验证旧链接、无分类项目、Guest 访问和数据较多的分页。服务端归属应优先于 query 颜色。
8. 不变更既有私有数据和下载权限；如需增加费用、供应商或生产部署，按具体授权另行处理。无 Docker；不得转向现有生产项目。

## 14. 联调验收清单

以下是未来联调的检查要求，不是本轮结果：

| 场景 | 必须核对 |
| --- | --- |
| 文件夹基础 | 七色、说明、空名称、60/500 边界、重名含大小写/首尾空白、“全部”保留名；刷新与两设备一致 |
| 归属安全 | A/B 两个 Owner 隔离；把 A 的项目归到 B 文件夹失败；Guest 不可读私有分类元数据 |
| 创建与弱网 | 分类下新增、失败重试、响应丢失重放、重复点击、不出现孤立归属或重复项目 |
| 搜索与分页 | 超过 30 项、不同分类/关键词切换、无匹配、跨页匹配、中文/英文、清空；计数范围正确 |
| 主题 | 七种分类到详情、从“全部”进入、旧链接、刷新、非法 theme、跨设备、Guest 主题边界 |
| 上传 | 桌面和真机拍照/相册/文件；批量上限、HEIC 拒绝、大小有效上限、配额、同内容去重、授权过期、扫描失败和重试 |
| 刷新/断网 | 传输中刷新、处理后刷新、无 File 对象时恢复提示、暂停/重试与重复 complete；不误报 ready |
| 图片与坐标 | EXIF 方向、长宽比、缩略留白、缩放/双指、手机点线/圆/点/字命中一致，原图 hash 不变 |
| 标注保存 | 创建/修改/隐藏、各属性边界、撤销重做、刷新、并发 revision/imageHash 冲突、部分保存失败与重试 |
| 标注可见性 | 当前语义与界面文案一致；若新增私有草稿，Guest 所有列表/详情/预览/直调 API 均不可读草稿 |
| 提醒关联 | 同标注多提醒、同名不同标注、历史修订、当前标注移动/隐藏后仍可定位原目标；分页不漏、不误关联 |
| 手机属性 | 资料区直接点标注、关闭重开、切换标注、软键盘/长表单、Escape/遮罩、输入保留、减少动态效果 |
| 回复 | 数值/照片/无法测量/文件文字；上传后不选证据、错项目证据、私有成果证据、10 份上限；重复提交不重复记录 |
| 审核 | 客户原值、照片人工值、人工修正来源/说明、重测说明、最新 responseId 冲突；Guest 直接调用审核接口被拒绝 |
| 交付 | 私有草稿、0 附件可保存但不可发、1～20 多附件原子发布、版本不重复、失败重放、旧版本不可覆盖 |
| 下载 | Guest 猜草稿/其他项目 ID、分享撤销、分片 206、非法 Range 416、断网续试/取消、真实手机文件保存与打开 |
| 页面恢复 | 无效链接、会话失效、401/403/404/409/422/428/429/503、返回主页、保留输入，不能以“暂无资料”吞错误 |
| 真实环境 | 新邮箱注册 OTP、两种角色、两设备、真实工程附件、大陆移动网络登录/分享/上传/回复/私有下载 |

实现变更后按范围执行 lint、typecheck、单测、build 与获授权的联调；**用户当前禁止自行开浏览器**，因此浏览器/E2E/截图/真机需遵守该约束，不能为满足通用检查要求擅自启动。未测项目标为待验证，不能套用旧截图或旧 E2E 结果宣称新 UI 通过。

## 15. 核对依据与文档关系

本文件是本轮前后端交接入口；细节及历史记录保留，不删除旧验收证据。旧提案与当前实现冲突时，布局/命名按最新用户决定与源码解释；业务范围与权限不能仅因 UI 改名而扩大。

| 依据 | 用途 |
| --- | --- |
| [PRD](../PartMeasure_V1_PRD.md)、[P0-0 契约](P0-0/03-api-contracts.md)、[阶段授权](P0-4/00-authorization.md) | 业务边界与历史基线 |
| [文件夹后端待办](projects-ui-backend-followup.md) | 分类/颜色/搜索草案与前端历史 |
| [后端字段核对](ui-backend-field-audit.md) | 已有工程字段、关联与剩余缺口 |
| [测量 UI 记录](workspace-measurement-ui.md)、[页面统一记录](site-ui-refresh.md) | 当前交互与前轮检查边界 |
| [P0 缺口](P0-4/06-p0-gaps.md)、[人工清单](P0-4/02-manual-checklist.md) | 运行、注册、真机/大陆网络与阶段出口，不由本轮文档覆盖 |
| [项目主题](../src/components/projects-theme.ts)、[项目列表](../src/components/projects.tsx)、[工作台](../src/components/workspace.tsx) | 临时分类、外观提示、布局与真实调用 |
| [标注 schema](../src/lib/annotations.ts)、[测量 schema](../src/lib/issues.ts)、[交付 schema](../src/lib/deliveries.ts)、[文件策略](../src/lib/policy.ts) | 字段、枚举、长度、状态与校验 |
| [API 入口](../src/app/api/%5B...segments%5D/route.ts)、[通用响应](../src/lib/server/http.ts)、[修订头](../src/lib/revision.ts) | 路由、请求与错误契约 |
| [项目/文件服务](../src/lib/server/service.ts)、[标注服务](../src/lib/server/annotation-service.ts)、[测量服务](../src/lib/server/issue-service.ts)、[交付服务](../src/lib/server/delivery-service.ts) | DTO、核权、分页与事务 |
| [上传队列](../src/components/upload-queue.tsx)、[私有文件响应](../src/lib/server/file-response.ts)、[成果下载](../src/components/delivery-download.tsx) | 状态恢复、受控读取与 Range |
| [正式 migrations](../supabase/migrations/) | 已有表、约束、RLS 与追加历史；不代表本轮云端结构核验 |

本轮验证只包含源码/文档静态交叉核对、Markdown 本地链接与差异检查；没有重跑业务测试、云端查询、浏览器、E2E、真机或部署。前轮 74 项单测与构建通过属于前轮检查记录，不能当作本轮新增数据库能力的证据。
