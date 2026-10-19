# 性能方案第 3、4 项实施与验证报告

后续：用户另行授权的统一有界缓存、事件精准失效和热缩略图逐次核权已在[第五项报告](performance-s5.md)继续实现；本页原检查/失败与Worker托管缺口保留，不由缓存检查通过自动关闭。

日期：2026-10-19（Asia/Taipei）。范围：用户授权“执行3，4任务”，依据 [原方案](realtime-performance-plan.md) 第 8 节；延续 [第 1、2 项](performance-s12.md)。仅隔离 Supabase `rvysclscetfqicpnzlra` 与已授权 Vercel `partmeasure-staging` Preview；不操作生产，不重建业务模块，不进入 P1/P2。

**代码和本地验证已具备，真实 HTTPS 同步/权限检查已有通过证据；上传全链路与 Worker 常驻托管仍有未闭合项，性能目标尚未验收。** 本文不替代 P0 阶段报告，不扩展既有人工通过范围。

## 已实现

### 项目级同步

- 事务内 outbox 与 Owner/Guest 独立单调游标，提交才 NOTIFY；回滚没有事件。事件不含正文、图片或能力令牌。工程师私有目录、内部文件与交付草稿不会推进 Guest 游标，避免泄露私有活动。
- 每工作台一条同源 SSE；每服务进程共享会话级 PostgreSQL LISTEN，使用 session pooler5432，拒绝 transaction pooler6543。业务事务池保持独立，不给浏览器开放业务 schema 或数据库账号。
- 先订阅再读取初始快照，游标补齐/去重、超出保留窗口整合重读；事件保留 7 天，超过 100 条追平用 reset，业务历史不因此删掉。
- 每批分发重新核验身份与项目/分享权限，在同一项目/链接锁内核权并排入流；撤销与分发串行。权限失效关闭流、清除本标签页私有缓存；后续 API/文件读取独立核权。此前已发出的字节不可远程收回。
- 正常在线移除多套15/20/30秒轮询和“刷新任务/刷新交付”；事件150ms窗口内按实体合并并有界失效，按文件/任务等范围触发局部读取。断线才启用单一30秒补偿与指数退避重连，恢复关闭；隐藏页面暂停，恢复自动连接。保留明确错误后的重试动作。
- 每连接15秒无 SQL 心跳、240秒轮换、每进程24连接上限、每身份每分钟30次连接限流；有背压/取消清理。长连接消耗、跨实例扇出和实际并发容量仍须目标环境验证。
- 标注、回复、交付的未提交输入不由远端快照覆盖；项目说明固定编辑起始 revision，不能用背景更新后的 revision 静默覆盖别人。交付后台更新不卸载编辑表单；显式放弃重载才重置。

### 图片与处理路径

- 一次有界解码，EXIF 归一化/sRGB 后继续生成既有无损标准图，另生320/640 WebP（单份≤256KiB）。原图归一化坐标、尺寸、hash 和历史引用保持原契约；不压缩标准图换速度，不按像素生成毫米。
- 列表仅懒加载小图；旧图尚未补建时显示等待预览，不偷偷回退下载大标准图。打开高清查看/画布才取标准图。成果图片只生成标准图，不增加无用缩略图。
- 私有预览每次服务端核权，响应仍 private/no-store；标签页内 Blob/ObjectURL singleflight+LRU，最多48份/96MiB、闲置复用60秒、4并发传输，失效中止并释放。不做持久离线/公开桶/CDN能力缓存。
- 文件 hash 放 Web Worker，服务器仍复核。缩略图元数据同现有列表 SQL 一次读取，预览同既有核权文件 SQL 查询，避免为了派生物额外增加数据库往返。
- Worker 按提交 NOTIFY 唤醒，30秒恢复扫描替代2秒常驻轮询；小图优先且有等待公平性、租约续约与失效中止、不可变对象冲突 hash 核验、原件/标准图/缩略图配额一致提交。
- 旧图补建先预留512KiB，校验既有标准图 hash，不替换原标准图；清理确认派生对象不存在才释放预留。独立清理 timer 和签名新鲜度监督入口已提供。
- [无 Docker 托管包](../deploy/worker/README.md) 含 systemd 重启、CPU/内存约束、独立 cleanup timer 和 ClamAV 每分钟新鲜度/加载版本检查。**尚未有目标主机，不是已部署的云 Worker。临时磁盘硬配额与 Linux 资源故障演练仍待落实。**

## 正式迁移与隔离边界

两份 migration 已应用到指定隔离项目，无 Auth/Storage 替身、无生产操作：

| 本地正式文件 | 云 migration 版本 | SQL MD5 |
|---|---|---|
| `20261019082939_performance_realtime_thumbnails.sql` | `20261019085929` | `380ffb17ebfc9e98f262514b84f53ee4` |
| `20261019093029_performance_event_visibility_hardening.sql` | `20261019093322` | `7e55ac3da4c7ad01fa98a700af16a76b` |

新增私有事件、游标、派生物及补建作业关系；RLS 默认拒绝，anon/authenticated 无直接表权限。函数 INVOKER、固定 search_path，runtime/worker 分权。云端 advisor 未见本轮新增暴露表，保留原有 leaked-password-protection 未开启提醒；不能扩大为全库安全认证。

回滚优先回退应用构建，保留新增表和不可变对象；不要直接 drop 或反向重写旧资产。迁移不会替换旧标准图，但会为旧物料图片排队补建缩略图，只有 Worker 成功处理后列表才出现小图。

## 实际检查与证据

| 检查 | 实际结果/边界 |
|---|---|
| `npm run lint` | PASS；本次复跑无 warning/error。 |
| `npm run typecheck` | PASS；strict 编译。 |
| `npm test` | PASS；23文件/123测试，包含游标/去重/合并、私有图片缓存、SSE初始快照/取消/权限失效、病毒库时间与版本等。SSE 单元 mock 只是单元证据。 |
| `npm run build` | PASS；Next.js 16.4.2 生产构建，含两个 SSE 精确路由。 |
| `scripts/performance/check-local-s34.ps1` | PASS；9项本机一次性 PostgreSQL18检查：提交/回滚、并发顺序、追平/保留、权限隔离、私有活动过滤、派生不可变/比例约束、真实清理函数及撤销；[native.json](evidence/performance-s34/native.json)。仅本机有合成Auth/Storage结构，永不部署云端，不算真实 Auth/Storage 通过。 |
| `scripts/performance/run-s34.ps1 images` | PASS；18项实际图像子进程：横竖 EXIF1～8逐像素等价、缩略图方向/比例/预算、补建不覆盖、3MP高熵样本、成果标准图分支；[images.json](evidence/performance-s34/images.json)。3MP样本本机约1.66秒，标准图约7.6MB、640预览约105KB；不是上传到对端显示的 p95。 |
| 真实云文件旧图补建 | 本机监督入口 `backfill --once` 首次exit0；云查询确认1个ready作业、2份派生物、0处理中/0预留，随后诊断补建再次exit0。是本机Worker+真实云Storage实验，不代表云常驻；其余旧图未全补建。 |
| 真实 session pooler | 受限账号曾分别 strict TLS/current_user/LISTEN 成功，但整体不稳定；[cloud-connections.json](evidence/performance-s34/cloud-connections.json)含FAIL，不能写连接稳定PASS。 |
| 真实本地应用 HTTP/SSE+云服务全链路 | **FAIL/未闭合**；最后纠正后的运行在准备阶段返回 `HTTP_503_DEPENDENCY_UNAVAILABLE`，见[历史本地运行](evidence/performance-s34/live-PERF-S34-1792403364526.json)。早期脚本混用了原生Fetch `.ok/.status` 属性与Playwright方法，已纠正；保留旧失败报告，不能将那些脚本错误断言为服务缺陷。后续独立云Preview运行单列。 |
| 浏览器/E2E、UI截图、真实手机/大陆移动数据 | 未执行，遵守当前不自行启动浏览器/E2E约束。待[集中人工检查](performance-s34-manual.md)，不以HTTP客户端替代交互/真机通过。 |

检查汇总、Preview与密钥扫描结果在同目录继续追加；任何失败记录不删除。不同环境不合并为大陆直连通过。

### 本次恢复后的 HTTPS 增量

- 正常两名测试工程师以真实密码登录，真实 Supabase 和私有桶；未使用管理员登录、mock或浏览器。连续多次独立标记运行中，SSE初始游标、B账号拒绝、Guest管理接口拒绝、事务提交后双端事件、Guest私有草稿游标不变、断线追平/重放、撤销后旧流与后续预览拒绝，**6组检查PASS**。原始分组见[东京已运行样本](evidence/performance-s34/live-PERF-S34-1792419190508.json)；其中上传仍FAIL，并非整个文件全部PASS。
- 美国API样本写入开始到双端收到事件元数据5912ms；东京的两个独立样本2595ms、1064ms。包含写操作和网络，不含UI绘制，样本数不足以统计p95，不能写成目标已达成或大陆已通过。
- 旧的逐次启动 `--once` Worker 的端到端脚本出现120秒 `WORKER_TIMEOUT`；云查询目标文件仍queued、attempts0，不能归为图片解码失败，也不能写上传成功。禁用该实验里的附带旧孤儿清理后仍复现，**不能断言清理是根因**。独立同一安全监督入口可完成真实旧图补建；独立普通任务处理在撤销后发生最终事务回滚并记录错误/退避，不能单凭exit0视为新文件发布成功。最后改为单个常驻安全Worker+有界状态观察，仍保持120秒门槛，最终运行在setup阶段失败（白名单归类 `ASSERTION_OR_DEPENDENCY_FAILED`），未到处理测量，**尚无证据证明改变实验启动方式解决了超时**。[最新完整运行](evidence/performance-s34/live.json)保持FAIL。开发机和云环境的历史瞬时失败仍须诊断，不能以旧6组PASS宣称持续稳定。
- [最终测试入口](https://partmeasure-staging-la7ndk7wa-messup-s-projects.vercel.app)，部署 `dpl_85KpgskuFtkjYHV5zieWMdF14g3v` 已READY，`target=staging`、region=`hnd1`；源码SHA256见[部署manifest](evidence/performance-s34/deploy-manifest.json)。此入口用正常登录；分享能力不写报告。仅在指定测试项目上传97份应用文件；排除env/tmp/密钥/Worker配置，未购买新资源。
- 第一版API部署参数和随后仅加vercel.json的部署仍实际在iad1；通过指定测试项目的 `resourceConfig.functionDefaultRegions=[hnd1]` 配合源码配置后，部署元数据确认hnd1。没有改已有生产项目；旧的测试构建保留为历史证据，不作为推荐入口。
- `EVENT_DATABASE_URL` 经用户本轮明确批准作为敏感变量保存，工具元数据确认 **仅Preview**。没有把worker/master连接上传网页环境。

最终部署的 `/api/health` 返回200，`x-vercel-id`观测到`hnd1`，仅证明存活及区域，**不代表最终部署完整业务通过**。检查汇总见[checks.json](evidence/performance-s34/checks.json)。按当前约束未自行重跑浏览器/E2E、截图或真机，不删掉这些待验项。

## 已确认的连接故障与尚未确定的根因

本机从同一 pooler 的SSLRequest阶段有时得到正常 `S`，有时返回 SQLSTATE `08P01` / `(ESTARTUPMESSAGE) Invalid startup message: :bad_startup_payload`；这发生在证书校验/账号密码/SQL之前，没有发送凭据。[原始协议脱敏采样](evidence/performance-s34/pg-ssl-request.json)、[错误分类](evidence/performance-s34/pg-startup-errors.json)。`pg` 将其归为建立SSL连接失败，本轮只增加固定脱敏诊断类别，不关闭TLS、不盲目重试写入。

开发机 DNS 曾把 pooler 解析到 `198.18.0.244`（虚拟/fake-IP地址段）。脚本清空进程代理变量、禁用env-proxy **不能证明系统TUN/VPN/DNS路径已直连**；本轮未修改它们，也不能仅据此归责 Supabase 或某个本机软件。此问题与 Auth/Storage/网页域名的可用性要分别测量。

## 运行命令与配置

常规开发仍用 `npm run dev`；生产本机 `npm run build` → `npm start`。不得为方便测试增加绕过登录的入口。

测试专用入口（PowerShell，仓库根目录）：

`live`/`worker`/`backfill` 需要先正常启动已有loopback ClamAV并更新/加载病毒库；runner不会绕过此条件或自行安装。此次自行启动的3111测试服务与扫描器已清理，未停止原有3000服务。云Preview仅网页/API已部署，尚无常驻Worker，不能把它当作上传能力已验收的稳定环境。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/check-local-s34.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s34.ps1 images
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s34.ps1 probe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s34.ps1 start
# 另一终端，仅HTTP/API/SSE，不启动浏览器
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s34.ps1 live
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s34.ps1 backfill
node scripts/performance/secret-audit.mjs
```

验证指定Preview时，先在当前测试终端设置 `PM_LIVE_ORIGIN` 为上文明确的测试URL，再执行 `run-s34.ps1 live`。脚本只接受本机3111或指定测试项目URL格式，使用原有正常账号、真实服务；新数据以 `PERF-S34-*` 独立标记，未删除或撤销用户已有项目资料/分享。最后一次实验的常驻Worker只在脚本生命周期中存在，由finally终止自身进程树，不代表部署；处理中观察是实验脚本，不是重新给正式UI加轮询。

本机PG检查需要安装PostgreSQL18/Git OpenSSL并启动新建的localhost55448集群，finally关闭；不得指向现有数据库。sandbox阻止 initdb 时只提升该隔离命令，不能用生产库替代。

`.env.example` 提供非秘密配置名；真实变量只存忽略的 `.env.local` / `tmp/performance-s34/events.env` 或受控平台。专用生产模式测试端口3111，正常开发3000不动。`run-s34.ps1`只改变子进程变量并恢复，既不读写Windows系统代理，也不安装转发层。

## 剩余门槛与交付状态

- 第3项：实现、本地检查与6组真实云HTTP/SSE同步/权限检查已有通过证据；跨实例扇出压力、持续多轮连接轮换、双端渲染及实际p95仍须验证。移除按钮并不等于已达实时性能目标。
- 第4项：图片/缓存/队列/监督代码及托管包已具备，真实云旧图补建成功；新Guest上传→扫描→派生→受控读取完整回归未闭合，靠近Storage的常驻主机、独立清理与更新告警、硬磁盘配额、故障恢复演练仍未落地。缺托管资源不通过购买或本机进程冒充解决。
- 无新增业务架构待审批。凭据传送曾被自动审批拦截，用户随后明确批准**仅隔离runtime账号的EVENT_DATABASE_URL到指定Preview**，现已保存；不授权管理员或worker凭据进入网页。
- 大陆真机整站、OTP注册及其他P0历史待验保留，不由本轮单元/图片结果代验。不得据此宣布整个P0验收通过。
- 保留任务开始时已有前端及第1/2项未提交工作；基线备份只在忽略目录。本轮不将混合变更整批提交/推送，最终以Git差异和部署manifest标记实际源码，不写成已产生独立提交。
