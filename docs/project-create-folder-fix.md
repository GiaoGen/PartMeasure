# 项目创建被拒绝与文件夹刷新消失

日期：2026-10-20（Asia/Taipei）。检查起点：`90c4e1a`，该版本确实包含下面两处缺陷。

## 原因与修复

1. 正常 Owner `POST /api/projects` 的 `FORBIDDEN` 可以在进入认证/数据库之前由 `sameOrigin` 抛出：原实现只接受单一 `APP_URL`（本机配置 `http://127.0.0.1:3000`），同端口 `localhost` 不匹配；Preview 分支别名也可能与唯一部署域名不匹配。清缓存或重新登录不会修复地址配置。现允许非 Vercel 本机 HTTP 同端口的两种 loopback 名称；Preview 只额外接受可信运行变量 `VERCEL_BRANCH_URL` 的准确 Vercel 域名，不从请求 Host 扩大信任。来源拒绝单列 `ORIGIN_MISMATCH`，避免误导成账号权限不足。不同端口、外站、cross-site 和缺少/伪造 CSRF 仍拒绝。
2. 前端文件夹使用 `setFolders` 和临时 UUID，未调用已有 `POST /api/project-folders`；项目分类仅存在 `assignments` 内存，创建项目未传 `folderId`。现接入真实保存，成功后才显示；失败保留输入/幂等键，提交期间禁止重复及关闭。项目提交真实文件夹 ID；页面服务端并行读取项目和文件夹，局部失败可单独提示/重试，分类恢复使用服务器 `folderId`。没有新增数据库迁移或修改权限。

此前已经刷新丢失的临时文件夹未写入数据库，无法从数据库恢复，需要重新创建；不根据浏览器临时 UUID 猜造或回填关联。现有已持久化资料保留。

## 验证

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`：PASS；26文件/151项单测，含11项来源/CSRF回归。
- 真实隔离 Supabase + 本机生产构建 + 正常密码，四组HTTP/API/SSR检查PASS，见[脱敏结果](evidence/project-create-fix/http.json)：localhost来源登录/文件夹和项目创建、幂等重放；清除客户端会话后正常重新登录恢复文件夹/归属及服务端页面；外站写入拒绝；B账号不可列出或使用A的文件夹/读取其项目。
- 首轮受限进程环境返回503，记录保留于[初次失败](evidence/project-create-fix/http-initial-sandbox.json)；切换至可联网的测试服务执行环境后复测通过。未通过修改密码、证书或系统代理重试。
- 按 React 检查清单复核：独立服务端读取并行、失败状态分开、无新增挂载后重复读取、提交禁用及错误可重试。没有增加库、轮询或业务UI重设计。
- 未启动浏览器/E2E或实机；HTTP Cookie jar不代替浏览器触摸/动画验证。未部署Preview、未修改远程schema、未发OTP、无Docker、无系统代理修改。整个P0验收状态不因此改变。

复现：生产构建后，在专用终端设置 `APP_URL=http://127.0.0.1:3120`，使用忽略的 `.env.local` 启动 `next start --hostname 127.0.0.1 --port 3120`；在使用 `scripts/shared/network.ps1` 默认Direct策略的测试终端，以相同APP_URL执行 `node --env-file=.env.local --import tsx scripts/performance/project-create-regression.mjs`。脚本仅接受原隔离项目，创建 `FIX-PROJECT-*` 独立资料，不清理既有项目。不打印正常账号或Cookie。

**版本生效边界**：修复在当前源码与本机新生产构建中验证；仍运行旧进程需重启，已部署网页需更新测试部署。GitHub源码、构建产物和正在运行的网站是不同检查对象，不能将源码更新直接称为网站已生效。
