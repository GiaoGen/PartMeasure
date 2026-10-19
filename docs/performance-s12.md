# 性能整改第1、2项实施与验证

日期：2026-10-19。授权：用户在审阅《大陆直连、实时协作与性能整改方案》后明确要求“执行1，2项”。本次没有实施实时事件流、迁移 worker、购买服务或部署。本报告不代表整个 P0 验收通过。

## 已实施

### 默认直连与分段基线

- P0-0 云实验、P0-1～4、后端对齐的启动脚本统一使用 `scripts/shared/network.ps1`。默认清除子进程 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 和 Node 自动代理开关，移除 Node options 中的代理启动标记；结束时恢复调用进程环境。不读取或改写 Windows 系统代理，不改全局 DNS/路由/TUN；保留原脚本已有的 IPv4 优先配置。
- 原有六个 Chromium 实验脚本统一使用 `browser-network.mjs`，默认显式 `--no-proxy-server`。只有明确的 DiagnosticProxy 模式和显式地址才采用诊断代理，不能因系统或环境存在代理便自动使用。本轮只检查启动参数，没有启动浏览器。
- 代理诊断与直连不能混报。进程禁用 HTTP 代理仍不能证明机器不存在系统 VPN/TUN；本轮报告明确记录这项未知条件，更不能充当大陆真实手机网络结果。
- 新增 native HTTPS/PG 探针：DNS、TCP/TLS/响应头累计阶段、连接复用、Auth settings、REST 拒绝响应、两个 Storage 域名、TUS 无凭据路径、已有测试站登录 HTML、PG 建连/SELECT 1，以及不发送登录凭据的 PG STARTTLS。全部保持证书验证。
- 服务端增加可关闭的 Server-Timing：auth、pool、sql、preflight、storage_sign、storage_fetch、app 及次数。只有 `PM_SERVER_TIMING=1` 时收集；默认关闭，不引入遥测网络请求。标签固定，不含 SQL、参数、URL、Cookie、令牌或正文。错误日志只增加固定依赖分类。

`sql` 是客户端等待 SQL 请求的总时长，包含网络、排队及数据库工作，不等同于数据库执行计划耗时；`preflight` 与 sql/pool 有重叠，不能相加。`app` 和 Storage fetch 均截至响应头/流建立，不能代替完整文件下载耗时。当前客户端画面/worker/实时事件阶段尚无本轮计时。

### 请求与缓存减负

- 标注提醒直接使用 `files/F/issues?annotationId=A` 与摘要 annotationRef，移除业务组件逐条查详情的调用。详情仅在打开具体提醒时读取；没有按标题猜关联。旧兼容 helper 保留现有用户文件，但已不被业务组件调用。
- 文件列表的 annotationSummary 指纹接入缩略图图层：无标注且没有本地待更新信号时无需读取完整标注；指纹改变会重新读取。没有新增缩略图派生物，也未改变标准图坐标。
- 新增统一、内存内 QueryCache：精确 URL、Owner/Guest 路径、项目、查询及版本分键；并发 singleflight；最多64条/约2MiB的保留数据预算。列表复用窗口1秒，已知版本图层最多5秒；默认普通读取不保留结果，显式零TTL重新载入绕过已有结果。
- 写入前后清空数据缓存；退出/登录/账号或分享会话切换、401、页面离开时清理；同源标签通过不含身份内容的 BroadcastChannel 失效通知协调。前后台/焦点变化清数据缓存，不触发额外网络轮询。失效前发出的旧请求不再写回缓存，旧身份的迟到结果被拒绝。缓存只复用此前获得的数据，不能授予任何服务端权限。
- CSRF 凭据仅存当前会话内存，并发请求合并获取。仅服务器明确返回 `403 CSRF_INVALID` 时重新获取并重试一次，保留相同操作正文及幂等键；权限拒绝、503和未知写入结果不会被自动重试。
- 文件列表增加请求代次保护；新上传后的重新读取不会因旧请求尚在进行而被直接丢掉，旧结果也不能覆盖较新的读取。
- 交付列表及所选附件合为一条有界领域查询，继续保留 Owner 草稿过滤、Guest 权限、附件顺序与最新发布版本。在有已发布成果时，原领域读取为 `4 + 2×草稿数` 条SQL，现为1条；不包含原有核权、限流和事务控制语句。实际本轮该接口总SQL调用数仍为9，未宣称只需一次数据库往返。
- 回复证据的可用性校验与关联插入各改为有界批量操作，继续验证同项目、用途、可见性和处理后的文件实体，仍与回复、状态及审核记录按原业务事务提交。
- 回复/审核返回已提交的单次增量，包含 issueId、state、revision、updatedAt 和 canonical response 或 review，保留原 responseId/reviewId。幂等重放返回相同增量，不将整份增长的历史复制进幂等表。前端直接追加已保存历史并更新状态，避免成功后必定再读详情；修订断档或旧部署/旧幂等结果缺少增量时才正常重新读取。旧结果不会降低当前修订，原回复与人工修正均保留。

权限/RLS/私有桶/链接撤销保持原机制；未用裸 getSession 替换 getUser，也未启用长期授权缓存或放宽权限。连接池上限与空闲策略未盲调。限流与业务读取仍保留短事务边界：直接合并会延长限流行锁、使同账号并发读取串行，而且失败请求仍需计数；本轮没有冒这个回归风险。

## 实际结果与证据

| 检查 | 结果 | 边界/证据 |
| --- | --- | --- |
| lint | PASS | 最后一次检查175个文件；`npm run lint` |
| TypeScript strict | PASS | `npm run typecheck` |
| 单元测试 | PASS，110项/19文件 | `npm test`；包含缓存/身份/CSRF/增量/计时隔离及安全错误分类 |
| 生产构建 | PASS | `npm run build`；现有全部应用路由构建成功 |
| 进程网络策略 | PASS | `scripts/performance/network-policy-test.ps1`；继承代理被清理、环境恢复、TLS选项保留、显式模式验证；不发网络请求 |
| 浏览器启动策略 | PASS（配置层） | `browser-policy-test.mjs`；不启动浏览器，不等于浏览器直连已实测 |
| 真实业务回归 | PASS，11项 | [regression.json](evidence/performance-s12/regression.json)：正常密码登录，A/B隔离，交付批量/详情一致，Owner草稿/Guest不可见，撤销拒绝，标注精准筛选，跨项目证据拒绝且不写历史，回复与审核幂等、原值/人工修正及恢复，私有图片206和跨项目拒绝 |
| 实际前端 API 模块连接真实服务 | 最后一次PASS，4项 | [client.json](evidence/performance-s12/client.json)：不是mock；Node Cookie jar仅补齐浏览器传输行为，不是浏览器验收。A登录与后续写入共用一次CSRF；两个并发读取加一次短时复用共发1次HTTP；写后失效；切换B后A项目404。前两次有冷连接503，中断记录保留。 |
| API 分段样本 | 成功；性能目标未达到 | [api-after.json](evidence/performance-s12/api-after.json)：每组三次列表、正常A/B登录和越权拒绝；该fixture没有任务详情列表样本，不扩展为全部接口基准 |
| 无HTTP代理的传输探针 | 有成功，也有PG建连失败 | [transport-after.json](evidence/performance-s12/transport-after.json)及时间戳历史；不能把服务可达性当业务验收 |
| 密钥扫描 | PASS | [secret-audit.json](evidence/performance-s12/secret-audit.json)，匹配已配置密钥、DB/测试密码、既有分享能力以及浏览器静态产物；不等于所有历史/图片OCR安全审计 |
| 原有工作保护 | PASS | [preservation.json](evidence/performance-s12/preservation.json)：56份原有未提交文件中，50份字节未变，6份仅在本次授权范围内增量接入；next-env生成改动已恢复；`git diff --check`通过 |
| 浏览器/E2E、实机、大陆运营商网络 | 未运行/待外部验证 | 遵守当前不自行启动浏览器/E2E的限制；没有模拟结果冒充真机 |

网络样本的重要事实：

- native HTTPS 无显式HTTP代理时，Auth settings为200，REST schema为401（只说明收到拒绝响应），Storage桶列表为200空结果；它们均不能说明用户登录、真实上传或私有下载业务已通过。真正的业务检查见 regression/client。
- 实际大文件上传使用的 `.storage.supabase.co` 独立域名也收到响应；TUS无凭据GET为404，只证明路径/主机响应，**没有执行本轮真实TUS上传验证**。没有据此换域名或改变上传协议。
- PG成功样本包含STARTTLS证书校验通过、建连约2.6秒、SELECT 1约351～486ms；另一次成功为建连约1.1秒、SELECT 1约177～234ms。另有无错误码的连接异常与登录前503，故稳定性尚未通过。
- 优化后交付列表三次约3.28/5.97/5.14秒；文件列表约3.26/4.85/4.79秒；任务列表约6.15/5.16/3.61秒。样本少、网络波动大，**不据此计算可信p95或宣称普遍提升百分比**。尚未达到“热态普通元数据p95≤1秒”的提案目标。
- 优化前首轮成功样本曾在终端记录；后一次同名诊断JSON覆盖了原文件。已将后续探针改为同时保存时间戳历史，失败与成功并存。优化前成功终端观察不作为可复现的受控对比证据；[api-before.json](evidence/performance-s12/api-before.json)保留后一次冷连接失败，而不是伪造缺失的成功基线。
- [transport-sandbox.json](evidence/performance-s12/transport-sandbox.json)是最初沙箱EACCES，不是运营商或Supabase故障。后续连接在获准网络执行环境下完成，仍没有配置代理。

## 运行方式

先按现有README准备被忽略的 `.env.local`，继续使用隔离ref `rvysclscetfqicpnzlra` 的受限runtime连接与官方CA。不要把密钥放进命令行或文档。现有测试账号/fixture放在忽略的tmp目录；脚本缺少它们会失败，不能用管理员创建或mock代替本轮检查。

```powershell
npm run lint
npm run typecheck
npm test
npm run build

# 第一终端：专用本机3110，默认直连、显式打开脱敏计时
.\scripts\performance\run.ps1 -Action start

# 第二终端：均不启动浏览器
.\scripts\performance\run.ps1 -Action transport -Sample after
.\scripts\performance\run.ps1 -Action api -Sample after
.\scripts\performance\run.ps1 -Action regression
.\scripts\performance\run.ps1 -Action client
.\scripts\performance\network-policy-test.ps1
node scripts/performance/browser-policy-test.mjs
```

regression/client 会在既有隔离测试fixture中追加带 `PERF-S12-` 前缀的任务，或创建同前缀项目/空交付草稿；不删除已有资料，不轮换已有项目分享。撤销测试只作用于本次新建项目的分享。测试数据为验证保留，位置索引位于忽略的 `tmp/performance-s12/` 或按项目前缀查找。反复运行会创建额外测试资料，不应无限循环执行。

计时默认关闭，普通 `npm run dev/start` 不会因为此变更自动访问代理或输出分段头。若只需读取现有应用，使用原启动命令；无需新建 Supabase、Redis 或事件服务。诊断代理模式仅在旧阶段包装脚本通过显式 `-NetworkMode DiagnosticProxy -ProxyUrl ...` 指定，结果不能归入直连基线。

## 遗留与停点

1. 默认直连、计时、缓存减负的代码已落地；依赖与schema未改，无migration、远程结构调整或部署。本轮测试的应用在本机3110连接真实云服务；已有HTTPS测试构建尚不包含本轮修改。
2. PG冷连接503仍是已记录的稳定性问题，尚未定位到供应商、路由或客户端的确切原因；不再猜密码、不降低TLS、不自动切代理、不通过长超时或写入重试掩盖。最终客户端流程成功不能抹去之前失败。
3. 当前本地API到远程DB存在多次可观网络往返；计时不能证明SQL服务器执行本身慢。还需同部署区域的分段对照及必要的实际执行计划，才能决定下一项后端优化；尚未验证并发负载下的延迟回归。
4. 第3项实时事件与移除正常刷新入口、第4项worker就近托管/缩略派生没有执行，因此不宣称对端已经秒级同步。图像字节缓存、长期离线与公共CDN缓存也未引入。
5. 大陆真实手机的登录、分享、照片上传、回复和私有下载仍待外部验证；真实注册OTP仍按既有P0记录单列。整个P0及流畅度均未因此验收通过。

当前前端已有大量其他工作，本次仅在相应组件内增量接入。未对其他页面做重设计，也未把他人的前端变更打包提交；工作树保留可审阅变更及任务开始时的本地备份。收尾关闭本任务专用服务，不停止其他本机进程。
