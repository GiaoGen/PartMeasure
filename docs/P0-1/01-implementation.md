# P0-1 实现与运行

授权依据见 00；仅测试 ref `rvysclscetfqicpnzlra`，不部署生产，不使用 Docker。`partmeasure-p0-0-lab` 是长期复用的隔离测试环境，名字不表示本阶段结束销毁。旧 `p0_lab_records` / `p0-0-service-lab` 实验对象保留、严格隔离；业务只使用私有 `pm` schema 与 `partmeasure-quarantine` / `partmeasure-private`，不复用实验策略。

## 认证与服务边界

注册 `signUp(email,password)` → `verifyOtp(type:signup)`；之后 `signInWithPassword`。至少 12 位密码。项目页在 Server Component 验证；每个 Owner API 用 Auth `getUser()` 重新确认，浏览器的 ownerId/user_metadata 不参与授权。SSR HttpOnly/SameSite Cookie；Proxy 只做验签/刷新与 nonce CSP，不是授权边界。API 自行刷新 Cookie，避免重复远程 getUser。logout 调用真实 Auth signOut。所有私有页面动态渲染、no-store、no-referrer、noindex。Next incoming request 日志关闭，防止分享路径进入开发访问日志。

2026-10-16 两次真实注册被 Resend `550 / domain not verified` 拒绝；用户随后明确暂缓注册，授权 Admin 建两名测试夹具。真实密码登录/会话测试与 OTP 分开，绝不把 Admin email_confirm 当数字码确认。再次验证注册前须修复 Resend Sender 域名并取得用户恢复测试的决定，不自动重发。

Cookie 写接口同时校验精确 APP_URL Origin、Sec-Fetch-Site 与双提交 CSRF（HttpOnly Cookie + 请求头）；JSON 流式限制 64 KiB、Zod strict，标识 UUID。错误仅输出白名单业务码/requestId，不输出 SDK 错误、SQL、绑定参数、Cookie、签名 URL、分享令牌。未授权对象 404，Guest 链接失效统一 LINK_UNAVAILABLE。

## 数据与事务

`pg@8.23.1` 单连接 BEGIN/COMMIT，事务内 set_config 身份，池每进程 2，验证实际 current_user；拒绝 postgres/service_role 作为业务身份。runtime/worker 都非 owner、NOINHERIT、NOBYPASSRLS；TLS rejectUnauthorized=true + Dashboard CA。statement_timeout 5s、lock_timeout 2s；40001/40P01 最多两次退避，未知提交不盲重试，用原幂等键查询/重试。ROLLBACK 失败销毁连接。网络 Storage/扫描/解码均在事务之外。

`pm.projects`、`share_links`、`guest_sessions`、`owner_usage`、`upload_reservations`、`file_assets`、`jobs`、`idempotency_keys`、`rate_limits`、`audit_events` 是本阶段必需表。所有启用 RLS；schema 对 public/anon/authenticated REVOKE，浏览器无业务 Data API 写入口。与原提案 public Owner SELECT 相比，实际更收敛为私有 schema、全部经 DAL；没有新增客户端数据库入口或业务 RPC。

RLS 对 project/assets/reservations 按已验 Owner 或有效 Guest 约束。share/session 摘要查找、内部配额/幂等/限流由可信 runtime 在私有 schema 内操作；这些内部表的 runtime 策略不是浏览器可用权限，HTTP 每个动作仍显式核项目/动作。worker 只授处理所需读写；不授 DDL/物理 DELETE。原件、标准图路径不可覆盖；DB trigger 拒绝修改资产归属/hash/path。history_protected 拒绝隐藏；P0-2～4 接入实际引用时必须同事务维护该保护标志及外键，不把目前尚不存在的历史实体算作已实现。

项目修改需 If-Match revision，过期 409。创建/修改/轮换/撤销/预留/完成/删除用 UUID Idempotency-Key；相同主体/动作/键+载荷返回原结果，异载荷 409，结果与业务行同事务。分享轮换的幂等记录仅存摘要/元数据；重放不能重新取明文，响应丢失需显式重新生成。审计只存动作/随机 ID/主体类型，不存正文或令牌。

配额锁顺序 owner_usage → project → share → reservation/job，跨项目账户总量有统一 owner 行锁。预留包括图片 80 MiB 派生预算；项目 1 GiB、账户 5 GiB、日预留原件 500 MiB；同时处理每主体 2/项目 4，单批 UI 20。额度包含未处理/失败/软删除保留对象。数据库限流独立提交：读 120/分钟，写 60/分钟，预留 10/分钟，Auth 5/10分钟、verify 10/10分钟，bootstrap 全局100/分钟和每 token 10/分钟。部署代理 IP 信任未配置，未冒充已实现按真实 IP 限流；当前全局+主体桶是保守限制，生产前需绑定可信入口并加匿名 IP 桶。

## 分享与下载

32 字节随机 capability 和随机会话，DB 只存 SHA-256。链接 30 天，Guest 会话至多 24h 且不超链接。`POST /api/guest/session` 验证后写每项目独立 HttpOnly Cookie，进入 `/s/session?project=UUID` 清除 URL 明文。项目 UUID 仅选择器，仍须校验对应会话。每次列表、读取、预留、完成、worker finalize 联查会话/链接有效、项目、可见性及动作。撤销/轮换与 Guest 写锁同一 share 行，旧 Cookie 不能绕过。已下载副本/请求开始前已核准传出的字节无法追回；界面定时重新核权后清空失效内容。

下载/预览是每请求核权的受控代理，不把下载签名返回浏览器；内部 60 秒签名只供服务器 fetch。Range 转发、固定 Content-Type、attachment、安全 filename、nosniff、private/no-store。仅标准图片可 inline，原件只准 Owner 下载；Guest 不能猜 ID 取别项目文件。两桶均 private，无任何浏览器角色 Storage 策略。上传签名只对固定 quarantine UUID 路径签发，upsert=false。

## 无 Docker 运行

Node 24.15.0 / npm 11.12.1，`npm ci`。按 `.env.example` 配置 ignored `.env.local`；不要提交凭据。首次本地测试配置工具 `scripts/p0-1/provision.mjs` 只读取 ignored 文件，生成受限角色密码和 generated-env.local，不自动覆盖现有配置。管理员数据库连接只用于这一步，业务连接始终是受限角色。密码设置事务禁止 statement/parameter/error 参数日志。CA 不是密钥，但本任务仍只留本地。没有重置/清理任何生产数据。

```powershell
npm run dev
# 本机须使用 Windows 系统代理访问 Supabase 时，用以下包装器（仅子进程环境）：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action dev
# 独立终端启动本地 ClamAV，随后运行 worker：
# 本机已验证的 portable 路径；其他机器先安装官方包/更新签名，按 clamd.example.conf 配置：
& .\tmp\p0-1\clamav\clamav-1.5.4.win.x64\clamd.exe --config-file=D:\PartMeasure\tmp\p0-1\clamd.conf
# 另一个终端：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action worker
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

test:e2e 端口3100，仅基础公开 UI/拒绝用例；真实业务脚本以3000为 APP_URL，单独运行，不能混称同一覆盖面。真实业务脚本不启用 trace/HAR，避免凭据/令牌进入录制；截图在明文链接收起后采集。物理手机与大陆网络另记待验证。

## 依赖与官方兼容记录

复核 Supabase changelog（2026-10-16）：近期 CBC TLS 弃用、PG17.11 更新；Node24现代 TLS，不依赖旧 cipher，云端真实PG17.11。参考 [changelog](https://supabase.com/changelog.md)、[密码注册](https://supabase.com/docs/guides/auth/passwords)、[SSR](https://supabase.com/docs/guides/auth/server-side/nextjs)、[TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[Free限制](https://supabase.com/docs/guides/storage/uploads/file-limits)、[CA验证](https://supabase.com/docs/guides/database/psql)、[node-postgres事务](https://node-postgres.com/features/transactions)。实施前读取 bundled Next16 route/cookies/proxy 文档，不沿用旧同步 cookies。

npm 官方元数据核对并精确锁定：pg8.23.1 MIT / Node>=16，tus-js-client4.3.1 MIT / Node>=18，@types/pg8.23.1 MIT，tsx4.23.15 MIT，server-only0.0.1 MIT；Sharp0.35.5 Apache-2.0 从实验 dev 依赖转正式 worker 依赖，libvips 通知保留。完整锁/许可证清单见 docs/evidence/licenses.json。ClamAV1.5.4 为独立 GPL-2.0 扫描进程，不捆绑入前端；官网下载包以官网 Talos 公钥验证分离签名，fingerprint `5BAD CA26 65EF 59DC F8A2 3D8B 707F 0DB4 8083 6771`；二进制/病毒库不提交。官方包 SHA256 `0D9E0228B2674137EA1A2853566C98A0278AD52AB2582C3D6DBD75373848C395`。
