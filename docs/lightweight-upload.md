# 轻量上传实施记录

日期：2026-10-20（Asia/Taipei）。用户在[取消Worker提案](no-worker-upload-proposal.md)后明确产品以轻量简历作品、直观交互顺畅为先，并要求“开始简化”。据此采用提案A：**无常驻Worker、无ClamAV，上传完成请求内校验与图片处理**。不采购资源、不部署生产，不自行启动浏览器/E2E。

## 当前行为

- 正常运行只需既有Next.js与Supabase，`npm run dev`或生产构建后`npm start`；不另起扫描器/消费者。不需要额外域名或自租处理主机。
- 原件继续使用现有私有隔离桶直传/TUS；complete/retry仅传小JSON，不把大文件绕经Next上传请求体。
- complete/retry返回200 ready才表示可用，不再入队并返回202。请求内核验实际字节数、SHA-256、扩展/MIME/有限结构；图片复用现有方向归一化和标准图/缩略图函数。独立派生对象并发上传，避免四次串行网络等待。
- 新文件标记`validation_policy=format-only-v2`，上传策略明确`virusScanning:false`，界面明确“不进行病毒扫描”。PDF/CAD/ZIP仍按既有允许范围校验并强制下载，不解析CAD、不解包为业务资料，不宣称附件已消毒。
- 原有已ready文件保持不变，标记历史`clamav-v1`；新增校验政策不可改写。标准图hash、归一化坐标、标注修订、测量和交付历史均不重建。
- 处理前后都验证会话、项目、原上传主体和链接；最终文件/派生元数据/配额/审计/outbox同事务提交。Guest不能管理项目或上传正式成果；同项目其他上传主体也不能冒领完成请求。
- 短期处理权60秒，跨请求代次防止重复/迟到提交；存储I/O总预算45秒，图片解码/编码有独立限制，完成路由maxDuration60秒。客户端仅complete/retry使用75秒网络超时，普通读取期限不加长。期限是上限，**不是期望用户等待这么久**。
- 每进程同时处理一份文件，忙时明确可重试；客户端批量逐文件完成。跨实例仍按数据库现有项目/账号预算与预留约束。没有自动无限重试、常驻轮询或后台“终会完成”的承诺。
- 完成事件沿用原SSE。正常请求直接更新本端成功状态，不必等事件；另一端依据事务事件局部读取。

## 中断、旧上传和运行边界

传输完成后处理失败，可以复用预留与原件继续，不重新上传；永久格式拒绝需重新选择。处理权过期显示可重试，不能一直假装正在处理。页面关闭后不承诺后台持续处理；下次进入可读取权威状态并恢复。

此前已上传但无人领取的queued文件保留。合法原上传者在项目上传列表点击“继续处理”，新请求接管并保留旧job历史；不自动处理其他人的既有资料，不以管理员身份冒充原上传者。撤销/过期会话不能继续提交。

原Worker启动入口已禁用；旧Worker代码只允许一次性本机历史SQL测试，不能运行云端消费者。原systemd包标记退役，旧说明保留历史。浏览器原有hash计算线程不需要安装或后台服务，继续用于避免上传前计算冻结页面。

临时目录在请求结束时清理，正式路径不可覆盖，失败重试只在hash一致时复用部分输出。**当前不新增Cron或常驻孤儿清理**：过期隔离对象/失败输出保留待手工维护，预留在确认删除前不释放；长时间大量失败仍可能占配额。旧ready文件的隔离副本也可能占Storage空间。这是当前轻量版本明确保留的维护限制，不伪装为已有自动清理，不影响已合法处理文件的历史保护。

## Migration与权限

正式文件：[20261020052757_lightweight_request_uploads.sql](../supabase/migrations/20261020052757_lightweight_request_uploads.sql)。新增预留处理令牌/到期与资产政策记录，给runtime增加**受主体与事务内处理令牌限制**的资产/派生INSERT策略；Guest结算项目用量需额外触发器保证不能修改名称/描述等属性。没有复制Worker整套权限、使用definer绕过RLS或开放浏览器表写入。

本机一次性PG验证后已应用原隔离ref`rvysclscetfqicpnzlra`，版本/源码SHA见[migration.json](evidence/lightweight/migration.json)。MCP迁移工具两次返回`Invalid or expired requestState`；只读确认未应用后，通过已有受控连接在一个事务内执行同份SQL并写入标准migration历史。凭据不出本地配置，不操作生产。

不通过回退旧消费者恢复服务：新版本的扫描政策与权限已变化。回退时应暂停新上传并保留已处理资产/历史，再决定兼容修复，不降级为无核验ready。

## 验证与证据

| 检查 | 结果/边界 |
|---|---|
| lint / typecheck / unit / build | 最终检查汇总见[checks.json](evidence/lightweight/checks.json)。153项单测；生产构建包含四个精确complete/retry路由。没有启动浏览器/E2E。 |
| 原生PG | [7组PASS](evidence/lightweight/native.json)：幂等/配额、无job入队、A/B与Guest隔离、处理权抢占/过期/迟到拒绝、旧queued接管、交付草稿私有、派生元数据权限/无令牌拒绝、撤销期间拒绝。仅本机有Auth/Storage替身，不当作真实云服务。 |
| 真实图片转换 | 复用原EXIF1～8横竖实验，现共享生产转换函数；[18组PASS](evidence/lightweight/images.json)，包括像素一致、比例/预算、旧标准图不覆盖、较大高熵样本。不是手机或整站时延证明。 |
| 真实正常登录/私有Storage/事件 | [完整运行](evidence/lightweight/live.json)、[针对性复核](evidence/lightweight/focused.json)和时间戳历史分别保留，最终状态以checks汇总为准；使用正常A/B密码、Guest、独立`LIGHT-*`项目，未启动扫描器/Worker，不修改已有资料。 |
| 历史失败 | [首次脚本路由错误](evidence/lightweight/live-first-script-route-error.json)保留；脚本误用`content`而非现有`download`路由，改后真实下载通过。后续传输/事件分组异常也保留，不删除失败或归为全部PASS。 |
| 部署/大陆真机 | 没有部署新版Preview/生产。真实手机、浏览器手感、大陆网络、平台并发/40MP边界和长期用量未在本轮验证，不宣称整个P0验收或目标p95已通过。 |

本地完整运行曾发现构建器扫描OS临时目录导致EPERM，已将运行时临时目录解析与构建追踪分离；最终生产构建通过，并检查17份函数追踪清单没有纳入`.env`或`tmp`凭据。没有为构建开放浏览器缓存读取权限。

复现命令（只读本地检查与独立测试数据，真实服务需要原ignored配置）：

```powershell
npm run lint
npm run typecheck
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/lightweight/check-local.ps1
node scripts/performance/images-s34.mjs
# 专用服务：设置APP_URL=http://127.0.0.1:3121，按scripts/shared/network.ps1默认Direct策略运行
node --env-file=.env.local --env-file=tmp/performance-s34/events.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3121
# 另一终端，相同Direct策略：
node --env-file=.env.local scripts/lightweight/live.mjs
```

`Direct`仅清理子进程代理继承，不能证明物理大陆直连。测试入口沿用正常登录，没有绕过认证的后门；密钥、Cookie、分享能力和私有下载签名不进入提交或报告。

本地运行旧生产模式服务需重启以加载新构建；若仍打开旧Vercel地址，它尚未包含本次简化。基础命令不需要Worker/ClamAV配置，已有`.env.local`不需删除重建。
