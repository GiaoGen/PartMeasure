# 后端对齐契约与前端接入说明

2026-10-19。对应交接文档 G-01/G-02/G-03/G-08 及 G-07 的列表修订摘要。本文件描述本轮代码契约；云端是否应用以 [验证记录](02-verification.md) 为准，不能因文档列出接口就推断现有线上构建支持它。

## 文件夹与项目

`GET /api/project-folders`：Owner 私有，返回 `{items, limit:200}`。每项为 `id/name/description/color/revision/createdAt/updatedAt/projectCount`；按创建时间、ID 升序。`projectCount` 是该 Owner 文件夹的全库数量，不受当前项目列表 q 影响。

`POST /api/project-folders`：JSON `{name,description?,color?}`；名称 trim 后 1～60，说明 trim 后不超过 500，默认空；color 默认 blue，仅允许 blue/cyan/green/purple/rose/coral/slate。禁止名称“全部”，同 Owner 按 trim+数据库 lower 不重名；返回完整对象，201。请求需现有 CSRF 和 `Idempotency-Key`。同键同输入返回同一 ID；更改输入需新操作，不能复用旧键。名称重复 `409 FOLDER_NAME_EXISTS`，超过账号 200 个文件夹 `409 FOLDER_LIMIT_REACHED`，输入错误 422。上限为 DAL 创建策略，数据库仍执行所有权/唯一性/格式约束。

文件夹不开放 PATCH/DELETE/移动/排序。“全部”不是实体。颜色只保存七色标识，没有任意 CSS、背景图或额外项目颜色列。revision 当前固定为 1，未来改名/改色如获授权再增加 CAS 契约。

`POST /api/projects`：原 `{name,description}` 兼容，新增可选 `folderId: UUID|null`；省略/null 表示未归类。服务端验证文件夹归当前 Owner，项目与归属同事务创建。未知/其他 Owner 文件夹返回 404，不遗留已创建项目；数据库复合 FK 再拒绝跨账号关系。

Owner 项目列表、创建/编辑结果和详情新增：

```typescript
{
  folderId: string | null;
  folder: { id: string; name: string; color: "blue"|"cyan"|"green"|"purple"|"rose"|"coral"|"slate" } | null;
}
```

旧项目 folderId 为 null，不猜归属、不批量回填。现有 `PATCH /api/projects/P` 仍只编辑名称/说明并要求修订；传 folderId 会被严格校验拒绝，避免擅自恢复已移除的归类操作。Guest 项目 DTO 不带 folderId/folder；Guest 默认主题语义保持原样。

## 搜索、分页与计数

`GET /api/projects?folderId=UUID&q=关键词&cursor=...&sort=created-desc`：

- folderId 省略表示全部，`none` 表示未归类，UUID 表示本人文件夹；空字符串或未知/重复查询参数 422，越权文件夹 404。
- q 默认空，trim 后最多 200；在该 Owner、该分类的全部项目名称/说明中作不区分大小写的字面包含匹配。中文可用，`%`、`_` 和 SQL 片段不被当作通配符/语句。
- 排序固定创建时间、ID 倒序，每页 30。返回 `{items,nextCursor,counts,filters}`；所有计数和本页数据取同一 SQL 语句快照，不承诺跨多次分页请求冻结整个数据集。
- `counts.allCount`：本人全部项目，不受分类/q 影响；`folderCount`：当前分类、不受 q 影响；`searchMatchCount`：分类内匹配 q 的全部数量。`filters` 返回有效 folderId/q/sort。
- nextCursor 是不透明字符串；必须原样传回，不能再用 UUID 校验，也不能拆解。更换账号、分类、q、排序必须从第一页开始。混用返回 `422 CURSOR_INVALID`，不存在的分页锚点同样拒绝。
- 游标绑定查询上下文且服务端在当前 RLS 结果内重查锚点，不承担授权或身份凭证作用。仅无过滤的默认列表兼容旧 UUID 游标；其他查询用新游标。

基于 Owner 和复合 Owner/文件夹索引先约束数据范围；本轮不安装扩展/模糊分词，不承诺大数据性能。substring 搜索在 Owner 范围内评估，实际规模增长后用真实执行计划决定 trigram 等增量方案。

## 提醒摘要与精准关联

`GET B/files/F/issues?annotationId=A&cursor=...`，`B=/api/projects/P` 或 `/api/guest/projects/P`。annotationId 只能用于文件内查询，必须 UUID；按真实已有 `annotation_id` 过滤，不凭标注名称匹配。不属于此项目/文件的 UUID 得到空结果，不返回其他项目存在性。

所有提醒摘要增加 `annotationRef:{id,revision}|null`。measurement 使用发出时的固定修订，文件文字问题为 null；当前标注移动/隐藏不会改变已有提醒位置，也不因此失去该提醒。完整快照仍从详情读取，没有在列表重复返回 geometry/metadata。

返回保持原 `counts` 为项目范围，显式增加 `countScope:"project"`；`filteredCounts` 为本次文件/标注过滤后的全量状态数量，`filterScope` 为 project/file/annotation。缺少状态键表示该状态数量 0，不能用当前页 items.length 当总数。

提醒 nextCursor 同样是绑定角色/会话、项目、文件、annotationId 和优先级排序的不透明字符串；Owner/Guest 不互用。仅默认项目级旧 UUID 继续兼容；文件过滤应使用新游标。每次仍核验真实项目权限和链接有效性，游标不能绕过撤销。

## 文件列表摘要与上传策略

现有文件列表每项追加：

```typescript
{
  previewVersion: string | null;
  annotationSummary: { version: string; count: number } | null;
}
```

只对 material 标准图片生成摘要。previewVersion 对应标准图 hash/normalizationVersion；annotationSummary.version 是**当前角色可读标注集合**的失效指纹，不是递增编号或永久标注号，不能比较数值大小。count 是当前未隐藏标注数。Owner 可读的隐藏历史与 Guest 当前可读集合可能产生不同指纹；不要跨身份缓存复用。

前端发现指纹变化后可重新读该文件 annotations；相同指纹可保留本会话图层。没有新增带标注图片导出、缩略派生规格、批量几何查询或公共 URL；图片仍走现有受控预览接口。byteSize 保持十进制字符串。

`GET /api/upload-policy` 保留原 `maxFileBytes`，增加：

- version、formats（extension / 该部署下有效 maxFileBytes / declaredMimeTypes）、maxBatchFiles=20、maxImagePixels。
- budgets：项目/账号/日源文件预算及图片派生预留；这是总策略，不是用户当前剩余额度。
- transport：6MiB TUS 阈值/分块；processing：必须安全处理、image/webp、标准化版本 1。

格式有效上限取现有格式策略和有效部署限制之小。declaredMimeTypes=null 只表示该附件没有单独的声明 MIME 白名单，不代表允许任意扩展或跳过实际内容/扫描。策略来自与预留校验共用的常量，不改变既有校验、不开放 HEIC/视频、不保证实际供应商支持超过部署限额。

## 本轮不替前端完成的接入

保留当前未完成 UI 和用户改动。下一轮前端可以按既有交互接入：

1. 用真实 folder 列表/创建替换 React 内存 folders，使用服务端 ID；创建 pending 沿用键并在成功/失败时保留正确输入。
2. 新项目传选定 folderId；已有项目不添加未经批准的移动控件。
3. 分类/q 改变先重置分页；用服务端三种 counts 替换“已加载范围”统计，移除内存 assignments 与刷新重置提示。
4. Owner 详情以 folder.color 作为权威外观，逐步去除 theme query 的业务依赖；Guest 保持默认，不读取私有文件夹。
5. 标注弹窗直接按 annotationId 查询摘要，替换逐条读详情匹配的兼容逻辑；仍按需读所选提醒的完整详情。
6. 消费文件指纹和 upload-policy；完成新错误码中文映射。浏览器 File 对象/传输续传、手机弹窗、dirty 汇总和其他前端待办仍按原交接文档处理。

这些接入步骤在本轮未修改的前端文件里仍未完成，不能把“后端已提供”写成“当前页面刷新已能保留分类”。

## Migration、回退和待决策

正式文件：[20261019025932_frontend_backend_alignment.sql](../../supabase/migrations/20261019025932_frontend_backend_alignment.sql)。新增私有 project_folders、projects.folder_id、同账号复合 FK、Owner-only SELECT/INSERT RLS 和查询索引；无业务旧行改写，无未来草案，无 auth/Storage 替身。没有扩大 worker 权限、引入 RPC/SECURITY DEFINER 或公共桶。

兼容应用回退可保留新表/空归属列；不能通过删除表或重置测试库回退。新增分类数据应保留；若未来要删除结构或改变公开修订/批次语义，先审查依赖和历史。

私有标注公开修订、整图/跨图批次边界、永久编号及历史回填仍待业务决策；本轮不替用户决定。Guest 同色、文件夹改名/删除/移动、专用缩略派生、完整历史/反馈/导出不由此次接口对齐顺带开放。
