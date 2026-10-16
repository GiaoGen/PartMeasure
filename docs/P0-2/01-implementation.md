# P0-2 实现与运行

授权依据见 [00-scope.md](00-scope.md)。沿用批准的私有 `pm` schema、受限 PG 事务适配器、Auth 与私有下载代理。没有新增依赖、公开桶、RPC 或认证旁路。用户本轮表示可在主要功能完成后集中优化 UI；本阶段仍保证基本布局、操作反馈和权限。

## 数据及安全

正式 migration `20261016132859_p0_2_annotations_file_issues.sql` 只新增本阶段结构，应用到 `rvysclscetfqicpnzlra`。名称 `partmeasure-p0-0-lab` 是创建时用途标记，继续作为跨阶段隔离测试环境使用，不随阶段废弃或重建。生产环境尚未部署。

- `pm.annotations` 是当前头版本，绑定文件、标准图哈希、normalization/schema version。线、圆、点、文字采用原图归一化坐标；圆的两个归一化半径满足 `rx × W = ry × H`，允许半个原图像素数值容差，不能按屏幕圆直接存相同 rx/ry。
- `pm.annotation_revisions` 在同一事务的 trigger 中追加快照，记录操作者。删除为头版本 tombstone，旧快照不改；撤销已保存删除会形成新修订。永久历史不可 UPDATE/DELETE。每图最多保留 200 个头，每标注 10,000 修订，包含隐藏记录。
- `pm.issues` 只实现文件级 `comment`，没有几何 FK、测量请求、回复或审核字段。文件问题不可覆盖；每文件上限 200。
- 复合 FK 防跨项目关联；文件/修订/创建者有必要索引。真实标注/问题引用设置 `history_protected`，阻止隐藏关联文件。标准图宽高、路径、哈希、版本不可修改。
- 每请求恢复真实 Auth 或 Guest 会话，核项目和文件可见性；业务服务及 RLS 双重拒绝 Guest 写标注/问题和读取修订历史。浏览器 anon/authenticated 和 worker 无新表授权，runtime 没有 DELETE 或历史 UPDATE 权限。
- 固定 project → share → head 锁顺序。读操作使用共享锁；写与撤销使用排他锁，保持撤销同步。继续沿用限流、CSRF、幂等结果、审计及事务超时。小数据并发测试不是压力测试，也不证明旧 503 根因已消除。

## API 增量

路径前缀：Owner `/api/projects/:projectId`；Guest `/api/guest/projects/:projectId`。

| 方法与后缀 | 契约 |
|---|---|
| GET `/files/:fileId/annotations` | 标准图 `image{id,width,height,imageHash,normalizationVersion}` + heads；Guest 不含隐藏项 |
| POST `/annotations` | Owner；`id,fileId,imageHash,geometry,metadata`，严格 DTO；201 |
| PATCH `/annotations/:id` | Owner；`imageHash,geometry,metadata` + `If-Match:"revision"`；同一对象恢复也走此接口 |
| DELETE `/annotations/:id` | Owner；If-Match；追加隐藏修订 |
| GET `/annotations/:id/revisions?before=n` | Owner；每页 30，包含更早游标；只读快照 |
| GET `/files/:fileId/issues?cursor=id` | 授权可见文件；每页 30 |
| POST `/issues` | Owner；`fileId,title,description`，201；不接测量回复 |

写入需要 UUID 幂等键；客户端创建 annotation UUID 以支持未知提交结果恢复。相同键同载荷返回原结果，异载荷 409。缺少修订 428、过时修订/图片哈希 409、非法字段/几何 422。所有返回禁止公开缓存。

尺寸是人工正十进制字符串，可留空；线/圆有尺寸和单位，圆有直径/半径、孔深/孔类型/螺纹字段，点/文字没有尺寸。只接受 `source=human`。API、UI 均没有像素转换毫米的计算。

## 编辑会话

标准图从核权 preview 代理读取 Blob，naturalWidth/Height 必须与数据库相符才可编辑；复用 P0-1 Sharp EXIF autoOrient/安全扫描管线和 P0-0 实验，不再次变换方向。Konva 仅客户端加载；DPR 只影响渲染。

桌面工具：选择、线、圆、点、文字、平移；选中后可拖整体、线端点/圆半径控制点或填写工程字段。聚焦画布才接收 Space、方向键、Delete、Ctrl/⌘ Z、Shift Z/Y、S。表单输入保留原生快捷键。缩放围绕指针，窗口变化保持原图中心与相对缩放；适应和原始像素可重置视图。

显式保存，单对象 CAS、逐对象事务；多对象保存允许部分成功，已确认项保留最新头。未确认操作冻结编辑并保留同幂等键重试；409 不自动合并或覆盖，允许复制草稿、确认丢弃后重载。草稿仅在内存，退出/切文件前提示，浏览器崩溃后未保存内容不能保证恢复。会话撤销/重做最多 100 步，不清除持久修订历史。

Guest 只有同图定位、缩放、平移、对象列表与说明，无编辑控件；服务端仍拒绝伪造写入。手机文件列表/单文件详情互斥；双指缩放仅作用画布，图外滚动。触摸手感与真实手机尚需人工。

## 运行与验证（全程无 Docker）

使用现有 `.env.local` 和证书/受限角色，配置说明沿用 [P0-1](../P0-1/02-files-and-migrations.md)。禁止打印或提交本地配置。

```powershell
npm ci
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action start
```

上传新样本时需独立启动现有 ClamAV + worker（已有安全处理完成的图片不需持续 worker 才能标注）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action worker
```

真实集成脚本（需要既有隔离配置；setup 会正常密码登录、创建测试项目并上传 3 个合成样本，不能替代 OTP 注册）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-2/run.ps1 -Action setup
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-2/run.ps1 -Action api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-2/run.ps1 -Action db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-2/run.ps1 -Action browser
```

api 会验证撤销并重新生成最后用于试用的链接；务必先完成 api 再启动 browser/db，不要在人工试用期间运行 api。fixture、cookie、密码和分享入口仅写 ignored `tmp`。浏览器脚本无 trace/HAR，不输出秘密，503 UI 状态用例单独标明模拟，其余读写使用真实服务。

定向重测：`-Action targeted` 检查历史引用删除保护；`-Action recovery` 只测保存失败/冲突；`-Action file-view` 只测文件问题与手机只读实际图片。后两项复用最近一次浏览器保存的线段夹具，不需重建项目。每个独立测试上下文正常密码登录，不复制旧 refresh cookie 跨上下文竞争。图片判定要求加载/错误遮层消失且标准图已知位置具有真实像素；出现图片错误仅通过正常按钮重试一次，单独记录，不当作稳定性通过。

官方文档复核沿用当日已锁依赖清单；本轮补读 [Konva 指针中心缩放](https://konvajs.org/docs/sandbox/Zooming_Relative_To_Pointer.html)、[多点触摸缩放](https://konvajs.org/docs/sandbox/Multi-touch_Scale_Stage.html)、[React Konva](https://konvajs.org/docs/react/index.html)，以及本地 Next 对应版本 lazy loading 指南。没有升级依赖或引入额外许可证；Konva/react-konva/React/Next 均沿用 P0-0/P0-1 已记录许可证。

迁移管理继续使用正式 migration 历史，云端已应用；禁止重复手贴 SQL 或部署 drafts。核对证据为 [migration.json](../evidence/p0-2/migration.json)。回退优先应用代码修复，若必须撤回本阶段，先停止新写入、备份三表及文件关联，再评审补偿 migration；不得 DROP 含历史表或解除 history_protected 作为快捷回滚。没有远程破坏性回滚。
