# PartMeasure V1 Release Gate

更新：2026-10-28（Asia/Taipei）。P3-05唯一持续维护的Release Gate；FIX-A～E只作原证据，不新建FIX包、不以历史编号清绿为目标。

**第一关（已测OPPO/Chrome范围）：COMPLETE；第二关及P3-05整体：IN_PROGRESS；发布判定：BLOCKED。** 原四条技术线和登录修复证据保留。用户已恢复推进三关，先做同候选真机；设备为OPPO Find X8s、Chrome155.0.8059.84，Android17/ColorOS17。准备原始分享落地检查时新发现：Bootstrap把503/断网也显示为链接失效，已用本机实际构建与全API拦截确认，未创建真实Guest或写云。用户已明确开始修复；最小提示修正、lint/strict类型/build、本地10项及托管5项定向E2E均通过，缺陷已关闭。用户整轮反馈手机1/3/4/5/6正常，只有2的角度/圆弧提前结束；已复现为tap后兼容mouse click重复计点。本轮已修复并完成8项离线原生触摸/鼠标/手势回归、lint/严格类型/生产构建及第5次Preview身份核对，不重跑通过项。用户已确认两工具复验通过，第一关在已测设备范围关闭，进入完整备份与云恢复。没有生产发布。完成标准是验收条件，240分钟仅为原FIX四线诊断预算；Agent继续负责可独立完成的技术工作。

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
| 恢复工具：本地已解决 | [FIX-E](FIX-E-backup-recovery-2026-10-27.md)新本地24表/5对象恢复、历史/权限/损坏拒绝及真实残集拒绝通过；真实完整备份、异设备副本、云Auth/Storage恢复仍未通过。 |

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
| 完整真实备份与云恢复：IN_PROGRESS | 完整备份、Drive下载副本全量认证、手机key取回均PASS。用户已批准完整实验集恢复/测试停机；源已INACTIVE，新Free目标xuyghznbcahlauontcyq已创建且业务/Auth/Storage空。尚缺目标私有凭据配置、真实云恢复和测试源恢复验证。 | 用户仅设置新目标凭据到私有本机文件；Agent负责TLS/兼容、恢复、Auth/Storage/历史/旧能力失效和测试源恢复。只操作本批源/目标，不碰其他项目；全部真实通过才COMPLETE。 |
| 公开运行与生产隔离：BLOCKED（需明确运行选择） | Free泄露密码保护WARN未获针对风险的决定；日志导出/留存/访问边界未证明；实际流量计费和维护接收人、生产隔离目标未落实。Agent准备现有平台最小方案：先核对只读日志配置/实际Usage、给出WARN可用防护或升级成本、建议单一维护责任/70%记录85%暂停测试95%受控处置及生产独立目标；不做企业级扩建。 | Agent提供证据和具体选项；用户决定支持范围、预算上限、维护/告警接收、WARN处置及生产目标。不是让用户排查代码/网络。配置与运行边界明确且实测通过才COMPLETE；随后单独提交最终发布审批，绝不自动上线。 |

第一关COMPLETE并关闭；当前仅推进第二关的副本/key认证及真实云恢复。第三关运行预算/责任和生产目标选择留下一关。Agent继续承担恢复兼容与实现，不把技术排查转交用户，不凭授权创建收费资源。

诊断规则：同因失败保留阶段、错误码、已排除项和下一可证伪动作；没有新条件不重试。此次本机握手阶段失败已排除SQL/业务权限阶段，获准托管读取成功提供路径差异证据；已过导出/事件/缓存不重跑。新修复只补受影响面。若新故障仍能由Agent修，继续处理，不以预算耗尽交回。

## 可接受限制与发布后优化

- 用户允许当前QQ SMTP，后续自行换服务商；本轮不再OTP/SMTP排查或发信。用户自行处理大陆直连/真实域名，不再要求修代理/TUN/DNS；也不将域名视作手机业务已通过。
- 已批准：椭圆CV精度有限/手动回退、PDF约192dpi栅格不可搜索、无常驻Worker、format-only-v2、已经交付的字节无法收回。按既定范围保留。
- 可安全延后：识别精度研究/模型、无依据性能工程、额外缓存、UI重设计、历史编号清绿、旧44项另批清理。不得借限制削减权限、安全、历史、数据恢复或核心流程。

## 工期与阶段结果

| 阶段 | 实际结果/剩余 | 更新估算 |
|---|---|---|
| 候选准备与首次完整检查 | 已完成；指纹/锁/migration/环境和测试断言已核对 | 后续只更新最终commit/受影响检查，不重复首轮 |
| 四线技术与安全补修 | 四线在明确范围通过；登录安全修复本地、托管对账、真实Edge登录只读通过 | 本段原估45–90分钟；新Preview对账、Edge登录、报告和本地候选已完成，无技术尾项按工时转交。新故障仍由Agent处理 |
| 同候选真实设备 | COMPLETE；用户已确认角度/圆弧修后复验通过，1/3/4/5/6证据复用 | 无剩余手机动作，不重跑 |
| 完整备份/云恢复 | IN_PROGRESS；完整集、下载副本、手机key均通过，真实导入解析和驱动检查通过。已获批并创建1个Free空目标，源在批准的停机窗口内；目标凭据正在配置，尚未导入业务数据 | 副本/key段已结束；剩余云恢复与回切约2–4小时有效工作，等待另计，实际目标连接/托管兼容失败据证据另估。无总体工时硬结案 |

当前候选公开证据中的配置/锁/迁移/源码均已固定；[秘密比对](evidence/p3-05/secret-audit.json)当前候选秘密命中0，扫描数量见机器记录（不声称覆盖历史Git或像素OCR）。

首轮检查起于2026-10-27 22:09:58台北时间；跨日持续工作，含网络、构建和授权等待，未记录精确有效工时，不能把约3小时经过时间冒充精确人时。每阶段按结果更新；时间耗尽不等于完成。

`IN_PROGRESS`：仍有可推进技术验收；`BLOCKED`：具体外部条件/目标或决定缺失，技术责任仍属Agent；`COMPLETE`：对应阶段全部验收真实满足。总体发布判定只有`READY_FOR_RELEASE`或`BLOCKED`。当前为**BLOCKED**。

2026-10-28手机修复历史（已关闭，非当前欠项）：[设备反馈](evidence/p3-05/phone-acceptance.json)1/3/4/5/6已通过，2角度/圆弧未过；后续改为整轮一次交付、用户统一反馈，不再逐项打断。生产Canvas隔离复现[修前](evidence/p3-05/touch-before.json)：触摸提交数0/1/1，鼠标0/0/1，匹配真实手机二次结束。最小修复仅取消画布原生touchstart默认行为以抑制兼容鼠标链，无定时防抖/依赖/三点语义变更。[修后](evidence/p3-05/touch-after.json)两工具鼠标/触摸均0/0/1；线段/圆拖画、平移、取消/双指检查通过，均仅离线组件证据。用户后续明确回复“通过了，进入下一步吧”，角度/圆弧已通过。

触摸修复候选本地cebeecad8acca20add7735a4a68756949faaa0207e8a97e50f5f4548907ec0f2、托管0471aea08e0bf49d68d41d5131d69315da22aaafa912e8b64c58efdd7975dd70；dpl_9u42aZAn9GgstP6Sg3JcCw6Us5ho，入口https://partmeasure-staging-gpv3og6c5-messup-s-projects.vercel.app。相同vercel.json变换精确重现全219输入摘要，218份可读日志逐项匹配，[对账](evidence/p3-05/preview-provenance.json)/[健康身份](evidence/p3-05/touch-fix-health.json)/[最小范围](evidence/p3-05/touch-fix-authorization.json)。旧f4f32f8d…对账另存，未覆盖旧失败或手机记录。此修复只改Canvas原生touchstart，已通过手机1/3/4/5/6及后端/导出证据按未受影响契约复用。修后真机复验已获用户确认，第一关COMPLETE；原5–10分钟估算已结束。

第二关2026-10-28准备历史（实际结果见下一段）：[准备与成本](evidence/p3-05/recovery-preparation.json)。用户选择原MESS's Org、Google Drive存密文、手机独立保管key。组织Free、2活跃名额已满，新项目报价0美元/月不代表配额可多开。提出免费轮换方案：完整备份/异地副本/key先真实通过，再经具体停机范围确认暂停PartMeasure测试源，建1新空恢复目标，验毕暂停目标并恢复源；不操作其他5个项目，不自动升级。此时没有暂停/创建/恢复。当前工具restore仍只允许本地标记空库，真实云需目标专用兼容实现，不能把raw auth schema覆盖托管系统。官方CLI文档中的Docker步骤不采用，继续原生PG工具。源当前PG17.11，24业务表，库约17.5MB，Storage元数据250对象/99.2MB（不是备份manifest集合）。[新源预检](evidence/p3-05/recovery-source-probe.json)一次严格TLS、认证、快照及10秒保活通过，构成区别于上次connecting失败的新条件；不代表长备份已通过。[唯一新备份范围](evidence/p3-05/recovery-backup-scope.json)已记录；该唯一新完整集及离线认证随后均成功，未重跑旧失败批次。

### 第二关当前实际结果（2026-10-28）

**IN_PROGRESS；完整源备份PASS、Drive下载副本全量认证PASS、手机密钥取回PASS。测试源处于获批停机窗口，新目标xuyghznbcahlauontcyq私有凭据已由用户配置，严格TLS/空库/Auth列/Storage服务凭据预检通过；首轮SQL因应用迁移历史namespace缺失3F000完整回滚，已定位修复，在同一空目标重试。云恢复尚未通过。**

- [完整源集](evidence/fix-e/8a60a0b7-8450-4e41-8b43-2c58204660a8-create.json)：快照2026-10-28T02:57:27.648Z，set `08c325c3-f646-42d0-b9c2-ad2d7e3cab69`。24业务表、192引用私有对象、20迁移和完整manifest；包括Auth用户/身份，不恢复活跃会话。192是引用集合，非250条Storage元数据全量；隔离/孤儿对象不纳入业务恢复。
- [全量离线认证](evidence/p3-05/recovery-backup-authentication.json)：所有GCM、明文大小/hash通过，原生pg_restore目录核对通过。214密文条目；ZIP 71,045,274字节，SHA256 `2bca6aa2288d954e5c0391dc578317a007e95a25fa8913e05e1911deb3f8a09f`。key未打包，明文认证暂存按finally删除。
- [Drive上传及权限](evidence/p3-05/recovery-drive-upload.json)：1新私有目录/1密文ZIP，返回大小一致；文件/目录权限均仅1个user owner。连接器未暴露checksum，不能只凭大小宣称副本可恢复。下一停止条件为下载副本SHA256及手机取回key后的全量认证，不重复上传。
- 自动审批拒绝将临时签名原始下载URL写入工具patch/私有文件，原因是带签名的bearer访问凭证暴露。写入未执行；不绕过/重试。安全回退的浏览器控制初始化又明确失败：`failed to write kernel assets / path not found (os error 3)`，尚未进入Drive页面，不能归因用户网络。采用用户已登录Drive页面直接下载后本地校验，与手机key保管一次合并交接；技术校验/恢复仍由Agent负责。报告/仓库无签名URL。
- [下载副本与手机key认证](evidence/p3-05/recovery-drive-verification.json)PASS：用户从Drive下载到独立本机位置，明确确认手机保管和取回；Agent使用返回文件中的key认证214条目，ZIP精确SHA256一致。手机来源由用户确认，实际解密由工具验证；未把独立key上传或打印。
- [真实备份导入解析预检](evidence/p3-05/recovery-import-preflight.json)PASS：24表逐表行数吻合、Auth用户/身份各5、应用migration历史20；仅离线解析和参数化写入语句准备，没有数据库执行，不能冒称云恢复。3项安全/解码定向单测及lint/strict检查通过。预检修复了PG输出缺少`--file=-`和合法`sha256`列名含数字被误拒绝两处本地工具问题，未暂停源排错。
- [托管兼容计划](evidence/p3-05/recovery-cloud-plan.json)：数据库包还含67条与旧session关联的`mfa_amr_claims`，不能笼统称所有会话相关表均从备份排除；云恢复仅导入users/identities、排除这些claims及provider Auth migration，并清除旧用户验证码/重置字段。旧幂等行保留，但返回结果与请求hash在目标失效，防止重放源上传授权。托管Auth结构不覆盖，既有local-only restore防护不放宽。
- [本批明确授权](evidence/p3-05/recovery-cloud-scope.json)：用户批准仅测试源暂停、东京/MESS's Org最多1个Free空目标、完整实验集（含测试照片/CAD、5个Auth用户）及最多1次正常密码登录，验毕或前提阻断时暂停目标/恢复源。创建前重新只读确认Free/0美元，已记录[源24表安全基线](evidence/p3-05/recovery-source-before-pause.json)。[创建与空目标检查](evidence/p3-05/recovery-cloud-created.json)：源INACTIVE，1次创建成功，目标xuyghznbcahlauontcyq为PG17.11/ACTIVE_HEALTHY，Auth用户/会话、Storage对象/桶、pm schema均0。未导入/上传、无升级/生产部署，其他项目未动。连接器无目标DB密码/服务Secret读取能力，浏览器初始化失败；已一次交付本机私有文件配置步骤，Agent继续负责技术验证。若用户现不便配置则暂停目标/恢复源，不能把测试源无期限停放。
- 用户已明确确认目标凭据保存；驱动首轮已到真实SQL导入阶段。[首轮失败](evidence/p3-05/recovery-cloud-attempt1-failure.json)为3F000，无文件上传/登录；随后只读确认用户/对象/pm schema/自定义角色全部0，证明事务回滚。[离线诊断](evidence/p3-05/recovery-history-schema-diagnostic.json)实际确认`pg_restore --schema=supabase_migrations --schema-only`输出表DDL却不输出namespace创建。已补显式创建应用历史namespace（不触碰Auth系统schema），lint/strict通过，在同一空目标继续原授权范围，不创建第二个项目或以SQL错误结束技术责任。
