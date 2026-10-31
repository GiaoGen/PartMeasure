# PartMeasure V1 Release Gate

更新：2026-11-01（Asia/Taipei）。P3-05唯一持续维护的Release Gate；FIX-A～E只作原证据，不新建FIX包、不以历史编号清绿为目标。

2026-11-01 后续交互优化已完成本地实现和验证，**尚未提交／推送／部署**：[交付记录](frontend-polish-2026-11-01.md)。用户审查收纳方案后明确实施；10 个前端文件涉及筛选／菜单进出场、连续绘图保留工具、统一待办收纳、菜单空白收起与防误绘、返回 icon 和文案精简，无需后端变更。458 源码 lint、类型、488 单测、最终 build、6 组实际 Workspace 离线检查及14组原生鼠标／触摸 Canvas 检查通过；非真实手机／软键盘验收。main 已关联 Production，本批没有推送或触发自动部署，当前线上版本仍见下一段；既有 V1 验收状态保持。

2026-10-31 前端维护更新已正式发布：用户批准示例实施，并批准同一正式项目的一次Production暂存、检查及同构建promote。当前部署为 `dpl_Eu58HPg6gsWrmhmXp9MAnhxqq1nB`（READY），入口仍为 https://partmeasure-production.vercel.app；commit `9fd5d2e1a7c530f0c2f3e9a65008a21069e3c543`，220输入 `bb69f1b956aae843eae32736bb7a8b4bb6d62148f1f253b9678598c2ad06f49d`，托管摘要 `797831db2ba98941f509f85adea411e31be853a102be310974ad70a040da3e10`。仅已审查8个前端文件改变；220输入逐项核对，Vercel生成配置补项目名、version 2及末尾LF后完整摘要精确重现。后端、锁、原配置和10个Production环境变量版本未变；无应用登录或业务写入、迁移、发信、分享、上传、清理、新项目／服务。

[本批记录](frontend-mobile-optimization-2026-10-31.md)与[发布回执](evidence/frontend-mobile-2026-10-31/publication-result.json)包括暂存前预演、候选检查、完整来源对账、同构建提升及公开匿名检查。正式alias状态completed；health/home/login200，实际新buildId匹配，projects401/AUTH_REQUIRED，安全头、原生POST及无feedback脚本通过。458源码lint已通过；原488单测／类型／build和7组本地实际组件证据按范围复用。15分钟内所选入口运行错误聚合无记录，不代替全量日志或监控。真机软键盘本次未验，不重开此前手机几何、导出、恢复验收。旧 `dpl_8ibkHBdHhn1QzePSXUPiZbUozPsM` 保留作应用回退，本批完成；下方首次V1验收仍按原版本范围留存，未被本次维护更新覆盖。

最新验收关闭：2026-10-30（Asia/Taipei）。用户已明确批准正式部署及首次流程，现又确认第1–5步正常、撤销后Guest“已失效”。

**最终判定：READY_FOR_RELEASE。P3-05：COMPLETE；V1已正式发布并通过本次约定范围验收。尚未满足的硬性门槛：无；剩余必要授权/资源/人工动作：无。**

正式入口：[PartMeasure V1](https://partmeasure-production.vercel.app)。首次发布的Production部署 `dpl_8ibkHBdHhn1QzePSXUPiZbUozPsM` 为READY，应用commit `8100204baec13d092eb3bbe58ef06e6e6af2d67e`，219输入 `cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2`；托管完整摘要 `a2a3658eb9dcd068b3f22b86cebc61da73ec66bbcd5921ee105618821ccaf9d3`，buildId `p3-05-a2a3658eb9dcd068b3f2`。正式Supabase仅 `qjiifweyhahowjdluqys`；旧lab/恢复目标保持暂停、数据保留。首次发布批次没有第二次部署或旧测试数据迁入；当前维护部署见本页顶部。

- [完整来源对账](evidence/p3-05/production-provenance.json)：原预测6925ea…漏计Vercel规范化vercel.json末尾LF；初见不符先暂停，219输入仅替换该配置hash便精确重现实际全摘要，204可见日志逐项吻合，随后恢复同一部署。没有忽略指纹放行。
- [公开匿名检查](evidence/p3-05/production-public-smoke.json)：首页/登录/health200，实际buildId匹配，projects精确401/AUTH_REQUIRED；no-referrer/DENY/nosniff、原生POST、无意外feedback脚本通过。health标明database:not-probed，不代替业务验证。
- [首次真实流程](evidence/p3-05/production-first-use-acceptance.json)：用户真实注册/邮箱确认/登录、项目/图片/标注/Guest回复/Owner读取均正常，撤销刷新已失效。Agent只读证实1个已确认Owner、1项目、1图片、1标注、1分享且已撤销、1Guest；实际2条Guest数值回复并有一次补测历史，全部保留。实际原图13,672字节/447×447，与预备1,676字节图片不同，如实记载，不声称上传了预备图或本轮另做文件回读hash。2条回复为用户实际操作，不隐瞒成1条；Agent无业务写入或额外邮件/分享/上传/部署。
- [发布关闭回执](evidence/p3-05/production-publication-result.json)：关闭时219源码摘要、依赖锁及维护源码hash与已验基线完全一致。20迁移/正式配置及此前手机、四线业务、导出、完整云恢复的有效证据复用，未重复已通过测试；原暂存/未提交成果保留，无reset/提交/推送。

运行边界沿用已接受的人工备份、Free无泄露口令检测及受限供应商路径日志风险；不新增常开机器、费用或虚构RPO/RTO承诺。CV精度、栅格PDF及其他已接受限制见下文。没有为发布延期的安全/权限/恢复硬门槛。

可安全延后：小范围前端优化、额外设备支持、CV精度研究、无依据性能工程和旧资料另批清理。前端优化可在此基线上继续；先明确具体范围，交互方案仍先获用户批准，只做受影响验证，任何新生产部署单独落实范围，不自动覆盖本次发布验收。

工期结果：必要技术与人工验收均按结果完成，本轮无剩余验收工时；未记录精确有效人时，不将跨日经过时间充当精确工时。没有按预算耗尽结案。

以下已完成阶段、准备审批停点和执行中记录均为历史；凡“未部署/待批准/IN_PROGRESS/BLOCKED”以本节最终结果为准，保留失败原因及证据不删改。

每日RPO≤24小时及调度是原试运行目标，未落实，不能填已达成；2026-10-29用户按学生作品定位，明确回复“接受人工方案，按此继续”，接受由项目所有者按需执行人工备份、无每日备份承诺及故障可能丢失最后成功备份之后数据的运行取舍。不要求常开电脑/服务器，不新增服务或费用。RTO≤4小时仍是工程目标，本次从首次暂停源到目标全部检查通过为4小时2分42秒（包含额度中断和脚本诊断），不能写已达成或外推5GiB。该决定不扩大为其他安全风险或生产部署授权，不以时间到点宣布整体完成。

## 候选身份与自动检查

- 固定起点：`96c1b82f0f4a609449ae672c485ea27edf698762`，分支`P0`，原开工工作树干净。保留全部实际成果，无reset/覆盖/推送。分享提示修复固定于`adf2b6e59a26d3e85e63f470acf9481fbd315c31`；当前触摸修复候选commit为`8100204baec13d092eb3bbe58ef06e6e6af2d67e`。后续报告身份追加不改变已验应用输入。仓库作者仅命令内使用Codex本地身份，未改全局Git配置。
- 当前应用/公开资源/依赖锁/构建配置的219文件输入摘要：`cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2`；本机构建`p3-05-cebeecad8acca20add77`。[逐文件源码、锁、20份migration及环境指纹](evidence/p3-05/candidate-cebeecad8acca20add77.json)。验证驱动独立计hash；环境只记录摘要/键名/隔离目标/CA指纹，不公开值。自动检查结果及私有原日志摘要另见[检查证据](evidence/p3-05/automatic-checks.json)。
- Node24.15.0/npm11.12.1，Next16.4.2；无依赖升级、无migration增量。锁文件SHA-256：b6007dcaf0ed5ddcc915816973c87f8f6917829bd81d9010df4b46ff30cabd73；20份migration清单摘要：1f6adf770c56d8fdb0224464f376f2fd4249059c87c8b9e0254fb4735b5626b6。唯一隔离Supabase：`rvysclscetfqicpnzlra`。
- 首次完整检查：lint/typecheck通过；沙箱单测467/472，5项是备份私有ACL的EPERM，正常本机身份472/472通过；沙箱构建无有效编译错误，正常身份构建通过，未削弱ACL。首轮E2E2/6；修复过时首页/密码定位和错误权限断言后6/6通过。
- 数据库租出client断连修复后完整单测78文件475/475通过，生产构建通过。最后一行AuthForm安全修复：lint/strict typecheck、受影响8项单测、生产构建、入口/安全E2E8/8通过。未因只改断言把503算权限通过：匿名必须精确401/AUTH_REQUIRED，CSRF必须403/ORIGIN_MISMATCH。
- E2E默认套件仅入口、安全、原生表单；不代表全部业务自动覆盖。实际业务驱动`scripts/release/business.mjs`单独限定授权，使用真实普通Owner/Guest、Auth/runtime/Storage；它不是CI自动写云数据的测试。

上一轮必要修复四处：OTP依赖故障/限流分别503/429（真实无效码422，未发信）；租出pg client异步error被捕获并丢弃、禁止失败后commit；构建身份改为真实输入摘要；AuthForm原生`method="post"`。最后一项来自实际Edge156、无JS、全离线拦截的SSR复现：修前GET把合成凭据写进query，修后POST、query无凭据。[修前](evidence/p3-05/auth-native-before.json)/[修后](evidence/p3-05/auth-native-after.json)。只增加不可见表单属性，不更改UI或已批准交互方案。

[真实远程配置](evidence/p3-05/environment.json)：20条云migration；17条业务编号直接对应，两条历史时间戳别名的实际SQL归一化SHA一致；本地空infra marker不需云业务回放，云实验lab另列。没有缺失业务migration、没有repair/重放。runtime/worker均非superuser、非BYPASSRLS、NOINHERIT，3桶公开桶0。此项是管理员只读配置核对，普通角色能力另以业务证据证明。

## 已满足发布条件与证据边界

| 范围/分类 | 真实结果、版本与证据 |
|---|---|
| 连接稳定性：必要技术修复完成 | 实际本机服务曾两次未捕获“Connection terminated unexpectedly”；定位为租出client查询间隙缺error listener，已修并有2项回归。一次SSLRequest失败发生在TLS/认证/SQL前，不能归因密码、权限或供应商。用户需要系统代理；停止同条件直连重试，不修改网络。[SSL阶段](evidence/p3-05/ssl-request.json)。获准托管8044849d…代表Owner会话/项目/照片/标注/V2连续读取200；测试流未观测5xx，不扩大为SLA或手机通过。 |
| 桌面UI/输入：发布必验通过其范围 | Chrome155真实托管：未保存标注在Tab/前后退/主题切换后保留，帮助/CV取消/手动回退/撤销重做；内联交付草稿/历史选择器及Tab保留通过。[桌面](evidence/p3-05/batch-c82d9295-c010-4fd9-8a7d-e58c0c6d7cef-read-1793116256376.json)/[内联预检](evidence/p3-05/batch-c82d9295-c010-4fd9-8a7d-e58c0c6d7cef-preflight-1793116795665.json)。首批因驱动误用旧按钮提前结束，属于Agent定位错误，已修驱动，未伪记产品通过。 |
| 实际导出：四种输出通过其范围 | PNG1,221,839B、JPG1,268,706B，均1280×3035；PDF3,336,014B、5张A4栅格页，逐页实际渲染目视核对中文/7类标注/空尺寸/来源；ZIP517,337B、9项，独立CRC/UTF8/逐项hash及固定版本/私有内容排除核对。[独立结果](evidence/p3-05/batch-c82d9295-c010-4fd9-8a7d-e58c0c6d7cef-exports-independent.json)。前三格式源05c6…；ZIP托管804…；后续DB错误防护/build元数据/Auth原生method未改变渲染/快照/导出核权，按兼容范围复用。原图447×447，不声称手机保存、高清源图阅读通过。 |
| 事件、缓存与撤销：发布必验通过其范围 | d700…批真实V1留言事件后Owner草稿和Guest未保存输入保留；IndexedDB实际字节/hash、重开先image-access200；撤销后精确LINK_UNAVAILABLE401、UI不可用、同浏览器IDB清空。[真实闭环](evidence/p3-05/batch-d700b91c-ea96-4114-8fad-d5f14f1b25b0-increment-1793117118257.json)。503/超时不算拒绝成功。 |
| 长流撤销：独立补验完成 | d700…首轮首块前失败，保留NOT_PASSED；Owner分段读取诊断成功后，另获6f9372ed…一次授权：Guest真实PDF API预检200，实际fileResponse/fileAuthorizer/RLS/私有Storage首块36,875B；Owner撤销后真实等待8,603ms，下一块精确LINK_UNAVAILABLE401，额外块0。[证据](evidence/p3-05/batch-6f9372ed-0b29-460e-9740-dbc22fbd528e-inflight.json)。这是服务层受控消费者与真实时钟证据，不冒充托管HTTP慢网或手机。 |
| 既有能力：已解决、复用 | [FIX-C](FIX-C-real-flows-2026-10-27.md)普通角色API、两版/私有草稿/固定历史、归档只读/恢复、私有原件hash及CAD只读；[FIX-B](FIX-B-frontend-2026-10-27.md)双Owner隔离和已测交互；[FIX-D](FIX-D-security-maintenance-2026-10-27.md)限定批次精确删除/失败额度/ready文件保留。只复用未受影响范围，旧44项不自动清理。 |
| 恢复工具与真实演练：已解决 | [FIX-E](FIX-E-backup-recovery-2026-10-27.md)本地恢复/损坏拒绝证据复用；第二关后来已补齐完整24表/192文件云恢复、Drive独立下载/手机key及真实Auth/权限核对，见第二关关闭结果。早期FIX-E失败不再是当前欠项。 |

### 非生产部署与源码对账

既有`partmeasure-staging`、项目`prj_rf7HXAsGzV6khGK5hxPkadCKhhAC`、团队`team_HdERlM3ZEizexkGrjPNJ8sZq`，Node24.x、hnd1。仅Preview；无生产alias/promote、无环境变量/域名/套餐变更。

1. 首次`dpl_DuQFKPE5r5AR1ZRX1sR3g91MojFN`：初始健康指纹不一致，停止业务；[失败证据](evidence/p3-05/preview-provenance-mismatch.json)保留。
2. 诊断`dpl_9qSc7XTQF3zaUFhrJjYqJ3bSJ8hV`：本地8044849d…，托管7b3bf18b…；真实业务证据在这次Preview。平台仅将vercel.json加入既有项目name并紧凑序列化，配置hash为13f7ed724fd0c18d4588bf3df70f795eebac23fc4f85d11fc6368d1ba8c87e2f。在完整219文件清单中只替换这一hash，精确重现两个部署各自完整摘要；不以忽略buildId放行。216份上传+3份prebuild固定CV产物，worker/许可远程hash匹配，vendor构建有固定SHA校验。
3. 登录修复`dpl_9DbeFcnX6Fm6WpvZn5XT2HBxipSj`：本地290f63ef…，已独立批准一次并创建。[授权](evidence/p3-05/auth-fix-authorization.json)/[部署](evidence/p3-05/auth-fix-deployment.json)。READY（Preview），托管构建p3-05-477226bc7c4011e1a96f，完整输入摘要477226bc7c4011e1a96fc98f9dcea04b06658b387f8dcc9cb944ab9b2a6cc36d；同一配置变换精确重现全摘要，可读218份日志hash逐一匹配，另1份所在行被连接器截断，不声称日志219份全部可读。[对账](evidence/p3-05/preview-provenance.json)，旧804版对账另存。真实Edge正常UI登录200/项目200、POST属性及hydration先检查、页面错误0，通过[验收](evidence/p3-05/auth-fix-edge-login.json)。驱动最后误把两次已拦截站外GET计整体失败；原记录保留，匿名只读补查复现vercel.live反馈脚本，不扩大为已知原两次精确路径，也未重登。原生POST修复只影响登录退化安全，既有四线业务证据按未受影响契约复用。

Preview环境可回读URL/ref/runtime6543/CA已私下核对，事件凭证为不能回读的sensitive变量。新部署前10个变量的完整版本元数据与已验记录相同，摘要`9ca006929eb7c8989c459d0915c2c552c9d38f43fef9bab83d2df71e39790b73`；804…真实SSE已通过，不能只凭环境元数据声称业务就绪。[版本](evidence/p3-05/preview-environment-version.json)。

本轮分享落地修复已获用户明确开始修复批准：仅精确401/LINK_UNAVAILABLE显示链接失效，其他故障显示暂时无法打开；沿用状态页/隐藏令牌，无新按钮/自动重试。lint、strict类型、生产构建通过，新定向E2E10/10（桌面/模拟窄屏各5）通过，[证据](evidence/p3-05/guest-bootstrap-after.json)。原默认入口/安全8项按未受影响代码复用，不冒称本轮重新全跑。第四次Preview获准创建一次，[授权](evidence/p3-05/bootstrap-fix-authorization.json)/[部署](evidence/p3-05/bootstrap-fix-deployment.json)，READY且全摘要/218份可读hash/真实健康buildId吻合，托管5项全API拦截回归通过，[托管证据](evidence/p3-05/bootstrap-fix-hosted-e2e.json)/[健康身份](evidence/p3-05/bootstrap-fix-health.json)。入口：https://partmeasure-staging-m3tkvhwsb-messup-s-projects.vercel.app。当前本地源码f4f32f8d…、托管a25bf8d4…，只应用已验证vercel.json变换。旧三批分享仍全部关闭；现无新云业务写入，该候选手机登录、项目读取及1/3/4/5/6已获用户确认，触摸2项由第5次Preview修正补验。

### 授权与实际消耗

| 独立批次 | 实际操作及结束状态 |
|---|---|
| c82d9295… | 1分享、1Guest、0留言、1撤销；读取/导出保留，旧按钮定位错误导致首次增量提前结束。已关闭。 |
| d700b91c… | 1分享、1Guest、1条≤200字符V1合成留言、1撤销。事件/缓存/失权通过，首次长流未过。已关闭。 |
| 6f9372ed… | 仅长流：1分享、1Guest、0留言、1撤销；精确检查点通过。已关闭。 |

此前3个Agent执行批次合计3分享/3Guest/1留言/3撤销，无上传、旧资料清理、资源创建、邮件、迁移或恢复。额外手机11fb8cb2…批由用户执行，报告规定流程及撤销正常，按额度已用关闭；未独立捕获资源ID和保存草稿数量。前4次Preview均已消费，本轮第5次依据后续必要验收预授权先记录最小触摸修复范围并仅创建一次；不重开已关闭批次。用户2026-10-28明确预先批准后续必要验收操作，不再重复索取同类批准；执行前仍记录具体最小范围/对象/风险。设备、恢复位置、付费金额和运行取舍缺的是事实/选择，不能靠授权捏造；正式生产仍保留最终发布审批。

已撤销链接的日志探测另行精确授权一次：[请求](evidence/p3-05/share-log-request.json)/[检查](evidence/p3-05/share-log-review.json)。GET200、无JS/bootstrap/新Guest；只保留token hash/requestId。平台runtime5/20分钟窗口为空，命中0，**不能证明所有平台/导出目的地均脱敏**。团队1个OWNER；Observability读API404，没有启用收费采集。新增只读Drains核对也返回404/not_found；浏览器控制入口初始化失败，已安装computer-use回退仅找到Remote Desktop而无托管控制台窗口，未作UI输入。[具体证据与下一动作](evidence/p3-05/operations-read-access.json)：有可访问的已登录控制台后，Agent只读核对Drains/Integrations、留存/访问及Usage，不重复同一失败API。自动审批最初因令牌进入日志目的地拒绝，此后用户单独明确批准才发送一次；当前无未解决的自动审批拒绝。

## 到上线的三道关口：责任、下一动作、停止条件

2026-10-28第一关执行：既有Preview只读状态仍READY/target=null，工作区开工干净、应用候选仍f17b81c。用户用OPPO Find X8s、Chrome155.0.8059.84亲自打开既有候选，明确反馈“首页和登录页正常显示”，仅这两页记PASS，系统为Android17/ColorOS17；未记手机认证/核心业务通过。[原始分享错误分类复现](evidence/p3-05/guest-bootstrap-before.json)证明401、503与断网均显示“链接已不可用”，属于必要技术修复，不是权限通过。最小方案已获用户批准并实现，仅区分精确401/LINK_UNAVAILABLE与临时错误，沿用状态页/隐藏令牌、不新增按钮；修后定向检查和唯一一次Preview均通过，手机分享步骤绑定新的f4f32f8d…候选。第一关原估45–90分钟；新增缺陷的修复/构建/部署原估45–75分钟，本轮已完成这些验收条件。手机后续已全部按已测范围通过，无剩余手机工时。新增手机批次11fb8cb2…由用户执行，已反馈上传/分享/Guest/回复/下载/撤销正常；按已撤销批次关闭，不复用其额度。实际资源ID和错误图形是否保存未独立捕获，不编造数量或自动清理。

手机整轮原定范围（用户已反馈完成，保留作消耗记录，不重跑）：已有测试Owner手机正常登录；同一FIX-C项目上传1张≤2MiB无敏感内容的测试照片、保存1个线段标注以产生1个待补项；新建1分享/正常1Guest，手机原始落地及原位填写1条合成测量回复；保存并打开PNG/JPG/PDF/ZIP及现有私有附件；最后仅撤销这1分享并核对原手机访问被拒绝。实际业务增量执行前绑定修后源码、精确项目/新资产/新分享ID并记账，使用用户本轮预授权，不复活三个已关闭批次。不新增版本、不发留言/邮件、不清理文件、不改域名/网络/套餐。若已有合适待补项，可省去新标注，但不因故障循环建分享或上传。设备操作由用户完成，Agent负责准备、后台只读核对及技术排查；已通过导出算法/事件/缓存/长流矩阵不重跑。

| 关口/状态 | 尚缺真实条件与下一步 | 责任与验收停止条件 |
|---|---|---|
| 同候选真实设备COMPLETE（已测范围） | OPPO Find X8s、Chrome155.0.8059.84、Android17/ColorOS17；用户整轮1/3/4/5/6正常，并明确确认8100204角度/圆弧复验通过。[设备证据](evidence/p3-05/phone-acceptance.json)。 | 第一关按该设备/浏览器范围关闭；其他设备/Safari及最终公开支持范围未扩大。已通过项目不重跑。 |
| 完整真实备份与云恢复：COMPLETE（本次功能范围） | 完整源集/Drive下载副本/手机返回key/24表及192对象真实云恢复均通过；真实Auth、Owner历史版本、跨Owner/匿名/旧Guest核权通过。源回切后24表逐一hash一致，原Preview健康200且buildId未变；恢复目标已暂停。 | [工作流结果](evidence/p3-05/recovery-workflow-result.json)、[目标端](evidence/p3-05/recovery-cloud-target.json)、[源保全](evidence/p3-05/recovery-source-resume.json)。本机原生PG连接未记通过；云权限用真实服务端角色SQL，绑定实际Auth用户。每日RPO及RTO运行目标留第三关，不虚称SLA。 |
| 安全运行、生产隔离及初始化：COMPLETE（发布前准备） | 人工备份及两项安全风险已明确接受。正式空目标/20迁移hash/24空表RLS/2私有桶、实际角色与事件连接、生产维护及本机备份、10项Production配置和独立正式配置构建通过；秘密扫描0命中。精确控制台未回读值不补写，没有生产网页或邮件送达新实测。 | 候选材料已准备，独立提交最终发布审批；发布及发布后真实主流程冒烟尚未执行，不能填已发布或整个P3-05 COMPLETE。新故障仍由Agent负责，不按工时交回。 |

三关的发布前准备均已关闭，没有重跑手机、导出或旧192文件恢复；正式库没有测试账号/资料。剩余路线只有：批准具体候选部署 → 实际部署/指纹对账/必要冒烟 → 按真实结果关闭P3-05。准备完成不等于已批准或已上线。

### 第三关：备份与维护的范围调整（2026-10-29）

**执行频率与维护责任选择、最终生产目标绑定：COMPLETE。** 用户明确接受人工方案；随后仅对新正式空库验证了一次本机备份入口，没有上传Drive、恢复或安装调度。用户按学生作品定位，不新增运维平台。

具体最小方案见现有[运行手册§4.1](operations/runbook.md#41-学生项目的最小人工维护方案已确认)：项目所有者在正式数据迁移/破坏性维护前、或当次产生需保留的真实业务资料后人工备份，并负责查看执行结果；完整集认证、Drive密文副本、手机独立key沿用原安全标准。没有需保留的新内容不强制每日备份。按需运行现有只读巡检，删除/暂停/付费仍须准确范围授权。

已确认的备份运行取舍：采用上述人工方式，由项目所有者负责；不承诺24小时RPO/全天监控，故障可能丢失最近一次成功快照之后的数据。确认依据是用户对完整具体方案的明确接受，不是仅凭其反对新增设施推定。本项无需再造调度器或重复请求确认；生产目标绑定仍随生产隔离完成，现有仅测试源CLI不冒称支持生产。

本轮核查：现有CLI的源/manifest精确固定测试ref；没有放宽保护。Task Scheduler的CIM接口失败，COM连接返回0x80070005；后续脚本误输出的schedulerAccessible=true来自未终止错误，**不是成功访问证据**。不因该失败要求用户修电脑或继续重试，范围调整后不再需要访问调度器。未发现常规Google Drive for desktop安装位置，不能推定有本机自动云同步；已通过的Drive独立下载证据不受影响。

本项停止条件已满足：人工取舍明确、生产工具精确绑定及适用检查通过；没有安装自动任务或重跑恢复。原自动方案估算已取消，不为凑工时继续实现。当前候选READY_FOR_RELEASE。

### 第三关：安全与运行边界结果（2026-10-29）

**COMPLETE（当前学生项目范围）；后续生产准备亦已通过，当前只待最终发布批准。** [机器证据](evidence/p3-05/operations-boundary.json)区分Agent实测、官方规则、历史复用与用户回报，不把风险接受记成技术能力已启用。

- Agent实测：组织仍Free，security advisor仅`auth_leaked_password_protection`一项WARN。正常本机一次公开Auth settings GET200：允许邮箱注册、邮箱自动确认关闭（需要邮箱确认）；该端点不返回密码长度或HIBP配置，不据此伪造12位供应商策略。首次沙箱ENOTFOUND后仅换正常本机执行一次成功，不改代理/TUN/DNS、不登录/发信。
- 当前测试源只读容量：数据库17,503,923字节，Storage元数据250对象/99,172,191字节，3桶/公开桶0；应用used70,227,973字节、reserved755,695,065字节。它们不是计费周期egress或可用套餐余额，旧测试预留不自动清理、不迁入生产。既有实际权限及恢复证据复用，不以管理员计数代替普通角色验收。
- Agent实测Vercel团队仍1个OWNER。集成配置GET403/forbidden，费用GET404/costs_not_found；本机没有可用Vercel CLI及标准登录文件，不安装或绕过权限。旧Drains404及已授权日志探测空窗口复用，不再请求含token的路径、不重试同一失败接口；这些失败或空结果均不证明无外发/零费用。
- 用户一次人工核对：对Supabase Email设置、组织Members/Usage和Vercel套餐/Drains/Integrations/Usage统一回复“都正常的”。按人工无异常回报记录；没有提供逐项密码长度、套餐标签、成员明细或周期用量分子分母，Agent不补造精确值、不声称亲自查看控制台。此范围不再反复追问数值，最终生产目标另做精确配置基线。
- 风险决定1已明确接受：“接受 Free 的这项剩余风险”。继续使用Free、保留现有认证/邮箱确认/限流/权限和独立强密码，不为消除WARN升级；WARN保留，不冒称与泄露口令库检测等价、不新增自制检测服务。
- 风险决定2已明确接受：“接受上述受限的日志风险”。限定控制台受限访问、无外部原始日志转发、当前套餐最短可用留存、不把有效链接放报告；发现暴露由Owner撤销受影响分享。官方Hobby运行面板留存1小时、Request Path可包含实际路径；**这不是供应商全部底层/安全日志的一小时删除保证**，也不宣称完整分享路径在所有平台日志中都已脱敏。后续发现额外访问/转发时先处理差异，不套用本决定。
- 源码侧：复核应用日志只保留固定阶段/白名单分类，Next incomingRequests/serverFunctions/browserToTerminal日志关闭；`Referrer-Policy:no-referrer`、私有响应no-store保留，未发现外部日志SDK。本轮应用/锁/配置/20迁移相对已验8100204无增量；最终秘密扫描1240文件/命中0（包含新增脱敏证据）。仅文档及脱敏证据更新，无依据重构或重复全套测试。

安全子阶段当时没有云设置修改、注册/密码登录、邮件、新分享/文件请求、清理、资源创建、部署或费用变更。读取失败路径、用户回报及风险决定已记录；随后生产目标在单独精确授权下建立并通过准备验收，不复用或扩大安全子阶段授权。

诊断规则：同因失败保留阶段、错误码、已排除项和下一可证伪动作；没有新条件不重试。此次本机握手阶段失败已排除SQL/业务权限阶段，获准托管读取成功提供路径差异证据；已过导出/事件/缓存不重跑。新修复只补受影响面。若新故障仍能由Agent修，继续处理，不以预算耗尽交回。

### 生产准备关闭结果与最终审批停点（2026-10-29）

**生产隔离与初始化COMPLETE；候选READY_FOR_RELEASE；没有部署、注册、发信、分享或业务资料写入。** [最终指纹](evidence/p3-05/production-final-fingerprint.json)固定应用commit `8100204baec13d092eb3bbe58ef06e6e6af2d67e`及219输入`cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2`。实际HEAD为`0d1828a90814f2e2cbf830eb97f4530f5712bfab`，维护源码另列逐文件及聚合hash，不冒称工作树已全部提交；全部原暂存/未提交成果保留。

- [初始化](evidence/p3-05/production-initialize.json)在新正式目标单事务提交既有20迁移、24空表、2私有桶及独立凭据。[独立对账](evidence/p3-05/production-isolation-verification.json)确认20份云SQL hash与审批源一致，匿名和浏览器authenticated无pm schema权限，用户/对象均0；lab/恢复目标暂停，其他项目及旧staging变量版本未变。
- [真实验证](evidence/p3-05/production-verify.json)：runtime6543、事件5432的LISTEN/UNLISTEN、维护角色均以正常密码和严格TLS连接成功；非superuser/NOBYPASSRLS/NOINHERIT，24表全RLS，手机返回新正式key实际匹配。旧恢复key/目录保留。公开Auth确认开关已实测；QQ SMTP/数字码模板/Site URL/12位策略依用户明确完成B的回报，不伪造新邮件送达或控制面回读。
- [环境配置](evidence/p3-05/production-environment.json)：新Vercel项目10变量仅Production，7项可回读值精确匹配，3项服务端凭据Sensitive。没有上传管理员/维护角色/备份key，Preview/Development无生产变量。Sensitive按API创建回执及私有已验证请求指纹计证，不声称可再次解密回读；还没有生产网页实测。
- 正式维护巡检实际0占用/0告警；生产CLI生成并完整认证1份**新空库**本机备份，set `334d15cc-350f-4778-86cb-124e0b663011`，24表/0对象，未恢复或上传Drive。该集`offDeviceCopyVerified=false`如实保留；完整真实数据的副本/恢复证据沿用第二关，未来重要正式资料按已接受的人工副本流程执行，不虚报自动异地备份。
- 正式配置下独立本机构建PASS，原.next保留，前后219输入hash不变；12文件lint零告警、strict类型PASS，适用维护测试及原应用475单测/构建/E2E/真实业务/真机证据按未变源码复用。[秘密扫描](evidence/p3-05/secret-audit.json)含新生产浏览器产物及生产凭据/key，0命中；数量与范围按机器记录，不覆盖历史Git或像素OCR。没有依赖升级、UI方案变更或无依据重构。

**候选准备的硬门槛已满足；剩余为最终发布授权及发布后的执行验收。** [部署材料](evidence/p3-05/production-deployment-scope.json)固定219份公开输入及包hash，排除.env/密钥/备份/账号/文档/测试资料。拟仅在新`partmeasure-production`最多1次Production构建部署，使用已验正式配置和现有平台默认域名，不改DNS/套餐/迁移、不迁入旧数据。预期托管buildId为`p3-05-6925ea6ac5647fda32a8`，仅对应已知vercel.json项目名/序列化变换；这是**预期**，必须部署后真实对账，尚未提前通过。

批准后Agent负责部署、构建/健康指纹、匿名入口与精确401核权检查，503不算权限拒绝；失败不循环部署或删库。PRD要求的发布后真实主流程冒烟仍未执行，首次Owner必须正常注册，旧测试账号不迁移；涉及新邮件/业务增量先给最小范围，整轮一次交付。实际发布及冒烟完成前P3-05保持IN_PROGRESS，READY不等于已上线。

[最终审批的具体范围](evidence/p3-05/production-publication-scope.json)尚未批准：最多1次Production部署（219固定输入，其中216上传、3份CV由已验证固定prebuild再现），匿名入口/指纹/401核对；若失败仅暂停该新Vercel项目，不删库、不恢复测试数据、不自动第二次部署。可同时批准首次正常Owner注册最多1次/确认邮件1封（由用户正常操作）、1个项目/1张1676字节合成图/1条标注/1分享/1Guest/1条≤200字符回复，最后仅撤销该分享，记录保留。也可只批准部署/只读核对，把首次主流程另留；不混淆这两种授权或自动发信。部署与必要核对预估30–60分钟，用户首次整轮约5–10分钟；平台构建/连接故障有不确定性，发生时保留具体阶段继续诊断，不以估时到点结案。

## 可接受限制与发布后优化


- 用户允许当前QQ SMTP，后续自行换服务商；本轮不再OTP/SMTP排查或发信。用户自行处理大陆直连/真实域名，不再要求修代理/TUN/DNS；也不将域名视作手机业务已通过。
- 用户2026-10-29明确接受学生项目人工备份方案：项目所有者按需执行/查看，无每日备份或全天监控承诺，故障可能丢失最后成功快照之后数据；不因此新增常开主机或费用。加密/副本/key与恢复、权限标准保留；不扩为泄露密码WARN、供应商日志风险或生产部署的授权。
- 用户随后在安全与运行边界阶段独立明确接受：Free无泄露口令库检测的剩余风险、受限控制台/无原始日志外发/最短可用留存下的供应商分享路径日志风险。接受依据及证据边界见上节；不是把前条人工备份授权泛化，也不是生产部署授权。
- 已批准：椭圆CV精度有限/手动回退、PDF约192dpi栅格不可搜索、无常驻Worker、format-only-v2、已经交付的字节无法收回。按既定范围保留。
- 可安全延后：识别精度研究/模型、无依据性能工程、额外缓存、UI重设计、历史编号清绿、旧44项另批清理。不得借限制削减权限、安全、历史、数据恢复或核心流程。

## 工期与阶段结果

| 阶段 | 实际结果/剩余 | 更新估算 |
|---|---|---|
| 候选准备与首次完整检查 | 已完成；指纹/锁/migration/环境和测试断言已核对 | 后续只更新最终commit/受影响检查，不重复首轮 |
| 四线技术与安全补修 | 四线在明确范围通过；登录安全修复本地、托管对账、真实Edge登录只读通过 | 本段原估45–90分钟；新Preview对账、Edge登录、报告和本地候选已完成，无技术尾项按工时转交。新故障仍由Agent处理 |
| 同候选真实设备 | COMPLETE；用户已确认角度/圆弧修后复验通过，1/3/4/5/6证据复用 | 无剩余手机动作，不重跑 |
| 完整备份/云恢复 | COMPLETE（已记录功能范围）；目标16:08:41全通过，源16:24:09保全通过 | 首轮文件续传14:48:39–15:05:20约16分41秒、92文件；第二轮约15:59–16:05:48完成余量及Auth。此前5–10分钟收尾估算失准；按实际时间结案，不继续增加本关测试 |
| 人工备份频率与责任 | COMPLETE；2026-10-29用户明确接受人工方案及最后成功备份之后数据可能丢失的取舍，手册同步 | 无需再安装调度/配置常开主机；生产工具绑定随生产隔离完成，不因此重开本项或重跑恢复 |
| 安全与运行边界 | COMPLETE（当前学生项目范围）；只读技术核查、当前秘密扫描通过，用户统一控制台回报正常并明确接受两项具体风险 | 原估1–2小时并非必需消耗；已无本子阶段独立技术尾项。用户未提供精确控制台数值如实保留，生产目标配置不计本项已过 |

当前候选公开证据中的配置/锁/迁移/源码均已固定；[秘密比对](evidence/p3-05/secret-audit.json)当前候选秘密命中0，扫描数量见机器记录（不声称覆盖历史Git或像素OCR）。

首轮检查起于2026-10-27 22:09:58台北时间；跨日持续工作，含网络、构建和授权等待，未记录精确有效工时，不能把约3小时经过时间冒充精确人时。每阶段按结果更新；时间耗尽不等于完成。

`IN_PROGRESS`：仍有获准工作或待发布/冒烟；`BLOCKED`：具体条件缺失，技术责任仍属Agent；`COMPLETE`：对应阶段验收真实满足。当前候选判定为**READY_FOR_RELEASE**；P3-05整体已**COMPLETE（正式部署、技术核对及首次真实业务验收通过）**。

2026-10-28手机修复历史（已关闭，非当前欠项）：[设备反馈](evidence/p3-05/phone-acceptance.json)1/3/4/5/6已通过，2角度/圆弧未过；后续改为整轮一次交付、用户统一反馈，不再逐项打断。生产Canvas隔离复现[修前](evidence/p3-05/touch-before.json)：触摸提交数0/1/1，鼠标0/0/1，匹配真实手机二次结束。最小修复仅取消画布原生touchstart默认行为以抑制兼容鼠标链，无定时防抖/依赖/三点语义变更。[修后](evidence/p3-05/touch-after.json)两工具鼠标/触摸均0/0/1；线段/圆拖画、平移、取消/双指检查通过，均仅离线组件证据。用户后续明确回复“通过了，进入下一步吧”，角度/圆弧已通过。

触摸修复候选本地cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2、托管0471aea08e0bf49d68d41d5131d69315da22aaafa912e8b64c58efdd7975dd70；dpl_9u42aZAn9GgstP6Sg3JcCw6Us5ho，入口https://partmeasure-staging-gpv3og6c5-messup-s-projects.vercel.app。相同vercel.json变换精确重现全219输入摘要，218份可读日志逐项匹配，[对账](evidence/p3-05/preview-provenance.json)/[健康身份](evidence/p3-05/touch-fix-health.json)/[最小范围](evidence/p3-05/touch-fix-authorization.json)。旧f4f32f8d…对账另存，未覆盖旧失败或手机记录。此修复只改Canvas原生touchstart，已通过手机1/3/4/5/6及后端/导出证据按未受影响契约复用。修后真机复验已获用户确认，第一关COMPLETE；原5–10分钟估算已结束。

第二关2026-10-28准备历史（实际结果见下一段）：[准备与成本](evidence/p3-05/recovery-preparation.json)。用户选择原MESS's Org、Google Drive存密文、手机独立保管key。组织Free、2活跃名额已满，新项目报价0美元/月不代表配额可多开。提出免费轮换方案：完整备份/异地副本/key先真实通过，再经具体停机范围确认暂停PartMeasure测试源，建1新空恢复目标，验毕暂停目标并恢复源；不操作其他5个项目，不自动升级。此时没有暂停/创建/恢复。当前工具restore仍只允许本地标记空库，真实云需目标专用兼容实现，不能把raw auth schema覆盖托管系统。官方CLI文档中的Docker步骤不采用，继续原生PG工具。源当前PG17.11，24业务表，库约17.5MB，Storage元数据250对象/99.2MB（不是备份manifest集合）。[新源预检](evidence/p3-05/recovery-source-probe.json)一次严格TLS、认证、快照及10秒保活通过，构成区别于上次connecting失败的新条件；不代表长备份已通过。[唯一新备份范围](evidence/p3-05/recovery-backup-scope.json)已记录；该唯一新完整集及离线认证随后均成功，未重跑旧失败批次。

### 第二关执行中历史（2026-10-28，已由后续关闭结果覆盖）

**IN_PROGRESS；完整源备份、Drive下载副本全量认证、手机密钥取回均PASS。云目标24表导入/迁移历史和原始内容指纹已通过；92/192文件（49,947,736/70,227,973字节）已逐个真实上传与回读hash通过。第93上传响应失败，是否已落盘须先查，未执行Auth登录。源第一轮已恢复且24表与暂停前完全一致；当前按单独记录的新最小范围在同源/同目标续接余量，已过92不重传/重测，不重建项目/不重导数据库。云恢复整关尚未通过。**

- [完整源集](evidence/fix-e/8a60a0b7-8450-4e41-8b43-2c58204660a8-create.json)：快照2026-10-28T02:57:27.648Z，set `08c325c3-f646-42d0-b9c2-ad2d7e3cab69`。24业务表、192引用私有对象、20迁移和完整manifest；包括Auth用户/身份，不恢复活跃会话。192是引用集合，非250条Storage元数据全量；隔离/孤儿对象不纳入业务恢复。
- [全量离线认证](evidence/p3-05/recovery-backup-authentication.json)：所有GCM、明文大小/hash通过，原生pg_restore目录核对通过。214密文条目；ZIP 71,045,274字节，SHA256 `2bca6aa2288d954e5c0391dc578317a007e95a25fa8913e05e1911deb3f8a09f`。key未打包，明文认证暂存按finally删除。
- [Drive上传及权限](evidence/p3-05/recovery-drive-upload.json)：1新私有目录/1密文ZIP，返回大小一致；文件/目录权限均仅1个user owner。连接器未暴露checksum，不能只凭大小宣称副本可恢复。下一停止条件为下载副本SHA256及手机取回key后的全量认证，不重复上传。
- 自动审批拒绝将临时签名原始下载URL写入工具patch/私有文件，原因是带签名的bearer访问凭证暴露。写入未执行；不绕过/重试。安全回退的浏览器控制初始化又明确失败：`failed to write kernel assets / path not found (os error 3)`，尚未进入Drive页面，不能归因用户网络。采用用户已登录Drive页面直接下载后本地校验，与手机key保管一次合并交接；技术校验/恢复仍由Agent负责。报告/仓库无签名URL。
- [下载副本与手机key认证](evidence/p3-05/recovery-drive-verification.json)PASS：用户从Drive下载到独立本机位置，明确确认手机保管和取回；Agent使用返回文件中的key认证214条目，ZIP精确SHA256一致。手机来源由用户确认，实际解密由工具验证；未把独立key上传或打印。
- [真实备份导入解析预检](evidence/p3-05/recovery-import-preflight.json)PASS：24表逐表行数吻合、Auth用户/身份各5、应用migration历史20；仅离线解析和参数化写入语句准备，没有数据库执行，不能冒称云恢复。3项安全/解码定向单测及lint/strict检查通过。预检修复了PG输出缺少`--file=-`和合法`sha256`列名含数字被误拒绝两处本地工具问题，未暂停源排错。
- [托管兼容计划](evidence/p3-05/recovery-cloud-plan.json)：数据库包还含67条与旧session关联的`mfa_amr_claims`，不能笼统称所有会话相关表均从备份排除；云恢复仅导入users/identities、排除这些claims及provider Auth migration，并清除旧用户验证码/重置字段。旧幂等行保留，但返回结果与请求hash在目标失效，防止重放源上传授权。托管Auth结构不覆盖，既有local-only restore防护不放宽。
- [本批明确授权](evidence/p3-05/recovery-cloud-scope.json)：用户批准仅测试源暂停、东京/MESS's Org最多1个Free空目标、完整实验集（含测试照片/CAD、5个Auth用户）及最多1次正常密码登录，验毕或前提阻断时暂停目标/恢复源。创建前重新只读确认Free/0美元，已记录[源24表安全基线](evidence/p3-05/recovery-source-before-pause.json)。[创建与空目标检查](evidence/p3-05/recovery-cloud-created.json)：源INACTIVE，1次创建成功，目标xuyghznbcahlauontcyq为PG17.11/ACTIVE_HEALTHY，Auth用户/会话、Storage对象/桶、pm schema均0。未导入/上传、无升级/生产部署，其他项目未动。连接器无目标DB密码/服务Secret读取能力，浏览器初始化失败；已一次交付本机私有文件配置步骤，Agent继续负责技术验证。若用户现不便配置则暂停目标/恢复源，不能把测试源无期限停放。
- 用户已明确确认目标凭据保存；驱动首轮已到真实SQL导入阶段。[首轮失败](evidence/p3-05/recovery-cloud-attempt1-failure.json)为3F000，无文件上传/登录；随后只读确认用户/对象/pm schema/自定义角色全部0，证明事务回滚。[离线诊断](evidence/p3-05/recovery-history-schema-diagnostic.json)实际确认`pg_restore --schema=supabase_migrations --schema-only`输出表DDL却不输出namespace创建。已补显式创建应用历史namespace（不触碰Auth系统schema），lint/strict通过，在同一空目标继续原授权范围，不创建第二个项目或以SQL错误结束技术责任。

### 第二关关闭结果（2026-10-28 16:24，覆盖前述执行中历史状态）

- [全流程结果](evidence/p3-05/recovery-workflow-result.json)：完整备份、Drive独立下载副本与手机key取回、24表/192文件真实新云恢复均有工具证据；192文件全部SHA256一致，目标一次真实密码登录/getUser成功。
- [受限角色/历史](evidence/p3-05/recovery-cloud-target.json)：实际Cloud `partmeasure_runtime`读取76个Owner项目、116条标注历史、25个交付版本，与管理员限定Owner期望一致；其他Owner/匿名/旧Guest均精确不可读。验证中的管理员SET授权在各事务内回滚，最终无残留；不宣称本机原生PG连接通过。
- 第93文件SDK响应错误后，服务端实际已有对象且大小正确；续接只回读，不重复上传。92已过hash复用，第二轮只新增99对象；本批总共192个唯一对象，无覆盖/清理。上传失败处理已改为先核对存在/大小，仅对确认缺失的暂时错误有限重试，底层状态分类脱敏记录；单次错误不再自动收口整个工作流。
- [最终源保全](evidence/p3-05/recovery-source-resume.json)：源ACTIVE_HEALTHY、全部24表hash与本轮暂停前一致；原Preview `/api/health` 200/build `p3-05-0471aea08e0bf49d68d4`（该health本身不测DB，DB证据来自实际SQL）。目标INACTIVE。第一轮源保全也全24一致；未重建项目或丢弃成果。
- 本关新增1个Free恢复项目、完整目标集、1次正常目标Auth登录；无新分享、留言、邮件、生产部署、套餐升级、源数据清理或网络设置修改。Google Drive只1密文ZIP，key未上传。测试数据仅为演练样本，正式生产初始化范围独立决定。
- 局限明确：本次70.2MB数据集功能通过，不代表5GiB吞吐/所有设备/不中断RTO≤4h。后续第三关已接受人工维护及明确运行取舍，不再要求每日调度；不另造历史FIX包或第二份Release Gate。


### 生产隔离执行中历史（已由生产准备关闭结果覆盖，非当前欠项）

生产隔离已于2026-10-29开始，状态IN_PROGRESS、总体仍BLOCKED。[最小资源与初始化范围](evidence/p3-05/production-initialization-scope.json)已获用户明确回复“批准这批免费生产准备”。已仅暂停原lab保留数据，创建1个新Free正式Supabase `qjiifweyhahowjdluqys`（partmeasure-v1-production，MESS's Org/东京/PG17.11，报价0美元/月）及1个空Vercel `prj_Tk3LzDCt2iLIfObnwVyPajjbiX61`（partmeasure-production，Node24，平台默认域https://partmeasure-production.vercel.app），见[创建回执](evidence/p3-05/production-created.json)。旧恢复目标仍暂停、其他项目未动。[源暂停前24表](evidence/p3-05/production-source-before-pause.json)与上次保全hash全部一致；新正式目标只读确认Auth用户/会话、桶/对象、pm schema/应用角色全0，尚未执行云迁移、生产环境变量写入或部署。用户正按一次性说明配置新目标凭据/Auth/独立手机key；旧恢复目录及旧key保留、不复用也不删除。新项目不会继承旧QQ SMTP/数字码模板，用户需实际保存，批准本身不代表已配置；不追加发信。

Agent独立准备已完成：正常主机新原生PG18空库回放20份既有migration，24表空且全RLS/2私有桶/受限角色检查PASS；本机Auth/Storage替身只用于迁移链，不作云验收。原生启动包装器ExitCode误判修正后，沙箱TCP EACCES改正常本机一次通过；集群均已停止。生产profile/manifest精确固定新ref，默认仍lab、local-only恢复不放宽；独立生产CLI/状态目录/最后成功回执已准备但未运行云维护。正常本机原22项定向测试PASS；新增manifest/人工策略检查后的4文件17项PASS，未重新跑已过恢复或全套业务。lint/strict通过当次源码；最新秘密扫描1250文件/命中0，含新生成生产凭据/key，无应用/锁/20迁移增量。用户随后回复ABC已完成，但磁盘检查新production目录的service-key.txt及from-phone.backup-key仍0字节，未发现.txt.txt或旧恢复目录更新；已只请求保存这两份，不重复其他配置或伪造手机取回。Agent已独立完成[真实数据库预检](evidence/p3-05/production-database-preflight.json)：严格TLS/正常postgres连接、空schema/用户/桶通过；[公开Auth设置](evidence/p3-05/production-auth-settings.json)GET200/邮箱确认开启通过，SMTP/模板/12位/站点配置按用户B完成报告记录，公开端点不暴露这些具体值。完整预检只停在本机配置，无云迁移。两份齐备后Agent继续20迁移云初始化、真实runtime/事件/维护角色、空库/RLS/私有桶/维护及仅新Vercel Production配置验证；不导入测试数据、不部署。若目标前提不可用，按获准回退暂停新正式目标并恢复原lab，不新建第二目标或付费绕过。准备候选仍不等于允许生产部署。
