# PartMeasure V1 Release Gate

更新：2026-10-28（Asia/Taipei）。P3-05唯一持续维护的Release Gate；FIX-A～E只作原证据，不新建FIX包、不以历史编号清绿为目标。

**本轮必要技术修复：COMPLETE；第一关真实手机及P3-05整体：IN_PROGRESS；发布判定：BLOCKED。** 原四条技术线和登录修复证据保留。用户已恢复推进三关，先做同候选真机；设备为OPPO Find X8s、Chrome155.0.8059.84，系统版本待补。准备原始分享落地检查时新发现：Bootstrap把503/断网也显示为链接失效，已用本机实际构建与全API拦截确认，未创建真实Guest或写云。用户已明确开始修复；最小提示修正、lint/strict类型/build、本地10项及托管5项定向E2E均通过，缺陷已关闭。新候选已就绪，手机核心业务尚未通过。没有生产发布。完成标准是验收条件，240分钟仅为原FIX四线诊断预算；Agent继续负责可独立完成的技术工作。

## 候选身份与自动检查

- 固定起点：`96c1b82f0f4a609449ae672c485ea27edf698762`，分支`P0`；开工工作树干净。保留全部实际成果，不reset、不覆盖既有工作。上一轮应用候选commit为`f17b81cdc8ca66a314a8b64c35285df05b014f03`。本轮仅Bootstrap错误分类改变应用输入，新的本地候选commit正在固定；其余证据按未受影响范围复用，不推送。仓库未配置作者，提交仅命令内使用Codex本地身份，未改全局配置。
- 当前应用/公开资源/依赖锁/构建配置的219文件输入摘要：`f4f32f8d58e65f47af7249844bc77dd2877f9a56125470e2a2d3bf813c35004c`；本机构建`p3-05-f4f32f8d58e65f47af72`。[逐文件源码、锁、20份migration及环境指纹](evidence/p3-05/candidate-f4f32f8d58e65f47af72.json)。验证驱动独立计hash；环境只记录摘要/键名/隔离目标/CA指纹，不公开值。自动检查结果及私有原日志摘要另见[检查证据](evidence/p3-05/automatic-checks.json)。
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

本轮分享落地修复已获用户明确开始修复批准：仅精确401/LINK_UNAVAILABLE显示链接失效，其他故障显示暂时无法打开；沿用状态页/隐藏令牌，无新按钮/自动重试。lint、strict类型、生产构建通过，新定向E2E10/10（桌面/模拟窄屏各5）通过，[证据](evidence/p3-05/guest-bootstrap-after.json)。原默认入口/安全8项按未受影响代码复用，不冒称本轮重新全跑。第四次Preview获准创建一次，[授权](evidence/p3-05/bootstrap-fix-authorization.json)/[部署](evidence/p3-05/bootstrap-fix-deployment.json)，READY且全摘要/218份可读hash/真实健康buildId吻合，托管5项全API拦截回归通过，[托管证据](evidence/p3-05/bootstrap-fix-hosted-e2e.json)/[健康身份](evidence/p3-05/bootstrap-fix-health.json)。入口：https://partmeasure-staging-m3tkvhwsb-messup-s-projects.vercel.app。当前本地源码f4f32f8d…、托管a25bf8d4…，只应用已验证vercel.json变换。旧三批分享仍全部关闭；现无新云业务写入，手机已提示使用新候选正常登录，尚待用户反馈。

### 授权与实际消耗

| 独立批次 | 实际操作及结束状态 |
|---|---|
| c82d9295… | 1分享、1Guest、0留言、1撤销；读取/导出保留，旧按钮定位错误导致首次增量提前结束。已关闭。 |
| d700b91c… | 1分享、1Guest、1条≤200字符V1合成留言、1撤销。事件/缓存/失权通过，首次长流未过。已关闭。 |
| 6f9372ed… | 仅长流：1分享、1Guest、0留言、1撤销；精确检查点通过。已关闭。 |

合计3分享/3Guest/1留言/3撤销，无上传、旧资料清理、资源创建、邮件、迁移或恢复。前3次Preview分别授权各一次，本轮第4次也单独批准并仅创建一次；不重开已关闭批次。用户2026-10-28明确预先批准后续必要验收操作，不再重复索取同类批准；执行前仍记录具体最小范围/对象/风险。设备、恢复位置、付费金额和运行取舍缺的是事实/选择，不能靠授权捏造；正式生产仍保留最终发布审批。

已撤销链接的日志探测另行精确授权一次：[请求](evidence/p3-05/share-log-request.json)/[检查](evidence/p3-05/share-log-review.json)。GET200、无JS/bootstrap/新Guest；只保留token hash/requestId。平台runtime5/20分钟窗口为空，命中0，**不能证明所有平台/导出目的地均脱敏**。团队1个OWNER；Observability读API404，没有启用收费采集。新增只读Drains核对也返回404/not_found；浏览器控制入口初始化失败，已安装computer-use回退仅找到Remote Desktop而无托管控制台窗口，未作UI输入。[具体证据与下一动作](evidence/p3-05/operations-read-access.json)：有可访问的已登录控制台后，Agent只读核对Drains/Integrations、留存/访问及Usage，不重复同一失败API。自动审批最初因令牌进入日志目的地拒绝，此后用户单独明确批准才发送一次；当前无未解决的自动审批拒绝。

## 到上线的三道关口：责任、下一动作、停止条件

2026-10-28第一关执行：既有Preview只读状态仍READY/target=null，工作区开工干净、应用候选仍f17b81c。用户用OPPO Find X8s、Chrome155.0.8059.84亲自打开既有候选，明确反馈“首页和登录页正常显示”，仅这两页记PASS，Android/ColorOS版本未补；未记手机认证/核心业务通过。[原始分享错误分类复现](evidence/p3-05/guest-bootstrap-before.json)证明401、503与断网均显示“链接已不可用”，属于必要技术修复，不是权限通过。最小方案已获用户批准并实现，仅区分精确401/LINK_UNAVAILABLE与临时错误，沿用状态页/隐藏令牌、不新增按钮；修后定向检查和唯一一次Preview均通过，手机分享步骤绑定新的f4f32f8d…候选。第一关原估45–90分钟；新增缺陷的修复/构建/部署原估45–75分钟，本轮已完成这些验收条件。手机尚缺步骤约30–60分钟（新故障另估，不作为硬上限）。现无新分享/上传/回复等云业务增量。

第一关余下只按一轮操作推进：已有测试Owner手机正常登录；同一FIX-C项目上传1张≤2MiB无敏感内容的测试照片、保存1个线段标注以产生1个待补项；新建1分享/正常1Guest，手机原始落地及原位填写1条合成测量回复；保存并打开PNG/JPG/PDF/ZIP及现有私有附件；最后仅撤销这1分享并核对原手机访问被拒绝。实际业务增量执行前绑定修后源码、精确项目/新资产/新分享ID并记账，使用用户本轮预授权，不复活三个已关闭批次。不新增版本、不发留言/邮件、不清理文件、不改域名/网络/套餐。若已有合适待补项，可省去新标注，但不因故障循环建分享或上传。设备操作由用户完成，Agent负责准备、后台只读核对及技术排查；已通过导出算法/事件/缓存/长流矩阵不重跑。

| 关口/状态 | 尚缺真实条件与下一步 | 责任与验收停止条件 |
|---|---|---|
| 旧候选托管证据复用；同候选真实设备IN_PROGRESS | Agent已完成POST修复新Preview指纹、Edge正常登录及候选commit固定。之后用同候选做实际手机触摸/键盘、原始分享落地、上传/回复/私有下载与PNG/PDF/ZIP保存阅读；复用已有项目/两版，无需重造业务矩阵。已知OPPO Find X8s、Chrome155.0.8059.84且用户可操作；首页/登录页实际通过，Android/ColorOS版本待补；窄viewport和改UA不能代替。 | Agent固定入口/最短步骤和最小增量、判读请求及修复；用户提供/操作实际设备并确认目标浏览器。全部核心流程有版本/设备/输出证据才COMPLETE；权限、输入丢失或安全失败必须修，不以限制备注放行。 |
| 完整真实备份与云恢复：BLOCKED（缺位置与目标） | 源此前读取188对象后退出且无manifest；修后一次connecting/connection_closed，保留私有残集，不再同条件长跑。没有指定全新空云恢复目标、异设备密文副本位置和独立key位置。先确定三个位置与数据范围，再由Agent做严格TLS源兼容/新完整集认证；完整集成功后才副本/云恢复、新Auth登录、私有字节/hash/历史及旧能力失效验收。 | 位置/预算/保管由用户决定；技术兼容、备份、恢复及失败排查由Agent负责。无manifest不开始恢复；不占其他项目、不覆盖源、不以本地替代云。完整集+独立副本/key+真实云恢复全部有证据才COMPLETE。RPO24h/RTO4h仅目标。 |
| 公开运行与生产隔离：BLOCKED（需明确运行选择） | Free泄露密码保护WARN未获针对风险的决定；日志导出/留存/访问边界未证明；实际流量计费和维护接收人、生产隔离目标未落实。Agent准备现有平台最小方案：先核对只读日志配置/实际Usage、给出WARN可用防护或升级成本、建议单一维护责任/70%记录85%暂停测试95%受控处置及生产独立目标；不做企业级扩建。 | Agent提供证据和具体选项；用户决定支持范围、预算上限、维护/告警接收、WARN处置及生产目标。不是让用户排查代码/网络。配置与运行边界明确且实测通过才COMPLETE；随后单独提交最终发布审批，绝不自动上线。 |

现在无需再提供十几项泛化待验清单。当前最小外部输入归为两组：**实际设备/浏览器及可操作时间**；**空恢复目标、异设备副本与独立key位置、运行预算/责任及生产目标选择**。可先完成设备轮，再完成恢复/运行轮。缺目标时Agent继续可离线准备的兼容与恢复计划，不凭授权捏造目标或制造新资源。

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
| 同候选真实设备与公开运行 | 需实际设备/运行选择，分2–3次合理接续 | 条件齐备后约2–4小时有效工作，等待另计 |
| 完整备份/云恢复 | 缺空目标/副本/key；源故障不确定性仍在 | 目标/数据规模/兼容确认后另估，不能承诺总完工时间 |

当前候选公开证据中的配置/锁/迁移/源码均已固定；[秘密比对](evidence/p3-05/secret-audit.json)1174文件命中0（不声称覆盖历史Git或像素OCR）。

首轮检查起于2026-10-27 22:09:58台北时间；跨日持续工作，含网络、构建和授权等待，未记录精确有效工时，不能把约3小时经过时间冒充精确人时。每阶段按结果更新；时间耗尽不等于完成。

`IN_PROGRESS`：仍有可推进技术验收；`BLOCKED`：具体外部条件/目标或决定缺失，技术责任仍属Agent；`COMPLETE`：对应阶段全部验收真实满足。总体发布判定只有`READY_FOR_RELEASE`或`BLOCKED`。当前为**BLOCKED**。
