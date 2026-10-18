# 无 Docker 测试部署与运行

只允许 Supabase `rvysclscetfqicpnzlra` 与 Vercel `partmeasure-staging`（team `messup-s-projects`，project `prj_rf7HXAsGzV6khGK5hxPkadCKhhAC`）。不使用既有生产项目；不推送、不升级套餐。测试数据以 P0-4 标记，脚本不清理已有项目资料。

## 本地可复现运行

Node24/npm11，`npm ci`，从 `.env.example` 准备 ignored `.env.local`。runtime 与 worker 用各自受限账号及严格 TLS CA，不能换成 postgres。本机DATABASE_CA_FILE模式不设置DATABASE_CA_PEM（不要保留一个空字符串覆盖文件选项）；托管只配置非空PEM，不引用本机路径。沿用 P0-1 的 ClamAV/独立图片处理/孤儿清理，不在网页进程内运行扫描。

```powershell
npm run build
# 独立终端：ClamAV（本机已安装时）
& ./tmp/p0-1/clamav/clamav-1.5.4.win.x64/clamd.exe --config-file=D:/PartMeasure/tmp/p0-1/clamd.conf
# 独立终端：安全处理 worker
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-1/run.ps1 -Action worker
# 独立终端：正式构建测试服务器，APP_URL 与端口一致
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action start
# http://127.0.0.1:3001
```

本次恢复后3000端口被其他应用占用，没有停止它。P0-4脚本固定本地3001，基础Playwright仍独立使用3100。旧阶段脚本仍沿用当时3000，不应未经调整指向其他应用。需要试用期间后台运行时，可执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/start-local.ps1 -Web`；窗口隐藏、日志/PID仅在ignored tmp，检查已有监听/worker后才启动，不停止其他应用。它不是系统常驻托管或开机监督服务。

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action browser
# 浏览器前段已经保存成功时的专项继续，不重建前置数据
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action browser-resume
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action workflow
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action transfer
```

正常测试账号位于 ignored `tmp/p0-1/test-passwords.txt`。API脚本创建独立A/B项目；browser脚本另建人工/闭环项目，入口与合成PNG保存在 `tmp/p0-4/manual-entry.txt`、`manual-sample.png`。不上传真实工程资料，不输出密码/分享地址/签名URL。无trace/HAR；截图遮盖登录和分享输入。浏览器的网络中断专项仅模拟传输故障，重试必须访问真实服务且核对下载字节；不把故障模拟当业务通过。

## Migration

本阶段正式文件 `supabase/migrations/20261017162310_p0_4_deliveries.sql` 与增量 `20261018010435_p0_4_worker_purpose_guard.sql` 已应用指定隔离云库，source/hash核对见 evidence/p0-4/migration.json。无本机auth/Storage替身；没有整份部署草案或未来阶段。新增purpose、delivery/delivery_files、权限/不可变/延迟原子校验和索引，旧资产默认material。已应用文件不回写；修复用新migration。真实DB专项通过rollback检验，不保留结构测试写入。

回退优先撤回网页版本，保留新增表和已发布历史；不可通过DROP表或删除发布记录回滚。旧版本网页不认识delivery用途，不能回退到继续混合写入旧逻辑的worker。若需数据回退，先备份、审查依赖并另行授权；本次未演练恢复备份，不宣称恢复能力已通过。

## HTTPS Preview 配置与部署记录

用户已导入 `tmp/p0-4/vercel-preview.env`。核查只读取变量名称/目标，不解密：8项所需变量在Preview，另保留一个无使用的APP_URL导入副本；误勾选的Production目标已移除。Secret/DB/CA都是服务端变量；无worker/admin密码上传。使用受限runtime和provider CA，保持rejectUnauthorized=true。变量存在不代表值和实际连接已经验证。

首次MCP提交显式 `target=preview`，服务返回 `target=production`，部署ID `dpl_82TBioJnTU1Fva1KNAPs2yFu8GC6`。中断后已READY，未用其进行业务验收；它只在新建测试项目且未配置生产业务凭据，既有生产项目未动。先暂停测试站阻止误目标，随后经用户明确批准恢复此站，用户知晓旧无凭据测试构建地址也恢复访问。不要使用该旧构建做验收。

官方REST文档 target支持staging/production，省略代表preview（[官方API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)；[MCP说明](https://vercel.com/docs/agent-resources/vercel-mcp/tools/deployments/create_deployment)）。自动审批曾拒绝省略target/staging源码上传及恢复项目；收到用户分别明确授权后才继续，没有绕过拒绝改用其他通道。暂停期间正确staging请求返回BLOCKED，未把它记成功。本机没有Vercel CLI或其登录凭据；浏览器管理页也未登录，没有假装CLI备用成功。

当前最新非生产部署：`dpl_CpXV93iLkWV9Gm1pFpbD9ABSBfTw`，target已核对staging、READY，入口 [测试登录](https://partmeasure-staging-em72unjso-messup-s-projects.vercel.app/login)。构建 `npm ci`/`npm run build`、Node24；source allowlist排除.env/tmp/docs/.git/.next/worker凭据，清单/hash见deploy-manifest.json。先前staging主闭环通过后，发现If-Match PATCH提交后412，专用X-PM-Revision修复版在这个最新部署专项200/409和未知结果幂等恢复均通过；最终业务结果见03报告，不用READY代替。

复跑使用不可变HTTPS主机：`$env:PM_TEST_URL='https://partmeasure-staging-em72unjso-messup-s-projects.vercel.app'`，再执行api/browser/workflow/transfer/seed。只允许本地3001或已核对staging主机格式；不能随意给测试脚本换成生产。确认Secure Cookie、SSR刷新、CSRF精确Origin、私有Range与>6MiB直传；appOrigin只信Vercel运行时VERCEL_URL，不信请求Host。使用上面的不可变主机，避免别名Origin不一致；若换别名先明确契约，不能降低校验。

当前worker仍是本机受控测试进程；网页部署不等于文件处理常驻托管。电脑/进程关闭时上传停在安全处理，fail closed。持续托管、OS监督重启/告警、资源预算与扫描病毒库更新需在正式上线前落地，未擅自创建收费VM。大陆真机测试期间须保证worker在线。有限重试可恢复短暂依赖错误，不能代替OS监督或证明长时间稳定。

## 下载与隐私限制

下载始终走核权代理；内部签名60秒不返回浏览器。单Range/416，交付按钮每4MiB请求一次，支持进度、取消、失败重试；已收到片段会复用，后续请求仍核权。Blob受当前单文件50MiB供应商上限和100MiB业务硬上限约束；实际低内存手机保存能力待实机验证。正在传输的当前响应不能收回已到达字节，撤销后新请求必须拒绝；已保存副本不可收回。

签名原图/测试账号/Guest能力只在ignored配置中；不打印env、OTP、DB URL、密钥和分享地址。托管访问日志可能记录首次分享路径，需要运行方使用访问日志脱敏/受控保留；应用no-referrer和history替换不能替代托管日志策略。
