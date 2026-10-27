# 安全配置、巡检与日志处置

2026-10-27，当前只适用于原隔离Supabase及本机开发。FIX-D实际执行/剩余条件见[交付记录](../FIX-D-security-maintenance-2026-10-27.md)，状态仅在[唯一台账§七](../pre-p3-05-open-issues-2026-10-26.md#七唯一台账与包交接)维护。不把本操作说明当已部署监控、已改云配置或已验证生产。

## 12：泄露密码保护

当前advisor WARN为`auth_leaked_password_protection`。原隔离组织Free；官方明确[该能力需要Pro及以上](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。它不表示发现了某个用户密码已泄露，不能通过隐藏advisor使风险消失。

当前已有：应用注册/登录入参12～128字符、真实Auth远程核验/邮箱确认、Cookie HttpOnly、CSRF、邮箱哈希与全局共享限流（仅loopback开发沿用获准内存限流）。它们分别减少弱口令/爆破/会话滥用风险，不能提供泄露口令库检测。尤其浏览器可直接请求公开Auth端点，不能仅依赖应用12位校验作为供应商策略已落实的证据。

可执行配置顺序：

1. 项目Owner打开原隔离Supabase → Authentication → Sign In / Providers → Email，核对Confirm email开启、供应商Minimum password length建议12。记录字段值/检查时间，不保存SMTP授权码、密钥或用户密码。此项当前尚未取得控制面值，不声称已配置12。
2. Free开发阶段使用密码管理器生成唯一测试密码，不复用真实工作账号密码；不新增自制密码库、外部密码查询服务或改无密码登录。若用户明确接受开发阶段的WARN，将接受范围记入台账；不扩为正式公开注册/发布豁免。
3. 以后决定付费时，先核定实际组织/套餐费用再批准升级；启用“Prevent use of leaked passwords”，重新读取advisor，并用专用未注册测试邮箱验证已知弱/泄露口令被拒绝。实际注册发信仍须明确范围，不为本项反复发信。
4. 若仍不用付费能力，正式开放前提出具体替代/限制及用户决定，不能将当前防护称为等价替代或零告警。没有擅自调整现有用户密码。

## 13：本机开发阶段的操作节奏

执行角色为项目维护者；当前单人开发由操作该项目的人接手。每次开始集中测试前/结束后、遇到上传长期占用或503时运行下列命令；对外持续服务前必须另落实实际值班人、巡检执行位置及故障接收方式。本轮没有安装定时任务、发送通知、常驻Worker或承诺24小时主动发现。

```powershell
npm run ops:status
npm run ops:status -- --database --record
npm run ops:cleanup -- --dry-run
```

第一条离线，只显示配置是否存在，不代表配置正确。后两条只读原隔离云；正常主机路径可用、沙箱DNS不通时记录差异，不改代理/DNS/TLS、不回退管理员。管理查询只作容量/运维诊断，不能用它代验普通Owner/Guest权限。

`--record`在ignored受限目录`tmp/maintenance-status/last.json`保留最近时间/状态/有限告警码，输出raised/cleared，不保存ID、文件名或正文，也不向任何人发消息。异常依赖记unknown，保留原告警直到一次成功快照确认恢复。可把脱敏输出交给以后明确批准的调度器；目前没有配置外部调度。

| 结果/阈值 | 当次动作 |
|---|---|
| CLI直接退出0 | 本次检查完成；离线配置结果不是业务健康证明 |
| 退出2或npm非零，warning | 查看有限告警码：处理租约过期、pending≥2h或已有可安全清理项；不要无限重试或先减额度 |
| `CLEANUP_OPERATOR_REQUIRED`、eligible≥100或最老逾期≥24h | critical：当次检查由维护者接手，核对专用范围/失败原因，下一批新上传测试前处理结论；不自动清旧资料 |
| 应用单账户used＋reserved达到5GiB预算80%/95% | warning/critical。先看待清理预留、文件引用及真实供应商容量；应用5GiB不是Free项目的供应商额度 |
| 退出1、unknown、没有有效快照 | 本次未完成。记录阶段/白名单连接码，确认服务/网络后再做一次有新条件的检查，不把上次数据或零行填成当前正常 |

真实清理必须先准备一个具体批准范围文件，格式为`{"projectId":"指定UUID","reservationIds":["指定预留UUID"]}`，最多20个不重复ID；保存在ignored目录，不可放能力地址。先同范围dry-run，再获准apply：

```powershell
npm run ops:cleanup -- --dry-run --scope-file tmp/maintenance-approved-scope.json
npm run ops:cleanup -- --apply --scope-file tmp/maintenance-approved-scope.json
```

`--apply`缺scope会在访问云端前拒绝。scope是技术限制，不是授权凭据。首次检查有44项旧积压，不因该工具存在就获得删除它们的授权；历史引用/ready私有文件均保护。清理每批≤20、120秒工作信号、5分钟租约，失败保留额度，5次失败后人工接管；取消/超时显式interrupted、非零退出。确切对象404后才结算，列表为空不能证明对象不存在。源凭证/TUS安全窗口仍按原27小时规则和租约余量执行。

故障注入与真实云结果分开记：本批的503由工具在本机拦截精确DELETE产生；真实数据库失败后保留额度、随后真实Storage删除/精确不存在确认及额度结算另有记录。不能将注入描述成供应商实际宕机。

## 容量、流量及可信来源边界

- 当前已有限制：项目1GiB、账户5GiB、每日源文件500MiB、单批20、同项目/身份待处理数、服务端共享请求限流、每进程传输并发24/每身份8、有界超时、格式/像素/导出上限及私有核权。没有信任任意`X-Forwarded-For`来识别用户，伪造该头不能切换现有限流主体。
- 上传签名限定固定路径、`upsert:false`；官方说明[默认不可覆盖](https://supabase.com/docs/guides/storage/uploads/resumable-uploads#overwriting-files)。这些措施限制被保存的字节及应用请求，不保证攻击者发送的所有实际网络字节都被计量到应用预算。TUS与旧上传凭证绕过应用的请求，仍须供应商侧Usage及拒绝/出口记录核对。
- 每次集中大文件测试前，维护者在原Supabase Usage核对Storage、数据库、cached/uncached egress及Auth调用，Vercel Usage核对传输/函数请求和计算；按当前控制面显示的实际配额计算比例，不把历史套餐数字硬编码为收费承诺。建议70%先记录原因、85%暂停继续大批测试并核对、95%在明确授权后执行供应商支持的限用/暂停措施。没有自动暂停、改套餐或限流配置。
- 本轮管理聚合取得的是对象元数据体积及数据库体积，**尚未取得计费周期实际egress/拒绝上传流量**。Free不代表可无界滥用；未来付费要明确最高预算、告警阈值及是否真正自动停用。[Vercel Spend Management](https://vercel.com/docs/spend-management)的通知与暂停是不同设置，不将单纯预算通知当硬上限。
- 当前采用身份/全局限流作为已有防护；目标托管入口如增加可信IP维度，只能使用已确认由平台覆盖且不可由外部伪造的来源字段，并同时保留共享NAT用户可恢复的窗口。未验证托管边界前不新增信任规则。可信来源适配/实际重放流量验证仍待补，不宣称I-05已闭合。

## 14：日志最小采集及检查方法

应用只记录固定阶段、白名单错误码、请求ID、计数及时间，不记录密码/OTP/Cookie、完整分享路径/token、签名URL、连接串、私有文件名或正文。Next开发入口关闭incomingRequests、Server Function参数日志、浏览器日志转发，未启用fetch URL诊断。它们只约束应用/开发日志，不能控制供应商访问日志。

当前Vercel已核对到团队仅1名Owner；[官方运行日志文档](https://vercel.com/docs/logs/runtime)说明有requestPath字段，Hobby保留1小时。查询最近30分钟为空只代表该窗口没有返回记录。Log Drain接口404是未知，不能据此断言没有集成或外部副本；旧Preview也不能代验当前源码。

Owner操作方案：

1. 在`partmeasure-staging`确认实际部署版本，检查Team Members、Project Access/Access Groups、Log Drains/Integrations和日志共享权限；删除/变更任何成员或集成前另行明确范围。本轮只读核对成员，没有改权限。
2. 保持最小必要成员、最短供应商可用保留，不开启长留存或向外部Log Drain转发原始能力路径；必要故障证据仅存请求ID/时间/固定路由类别/有限码，人工导出先脱敏。
3. 如平台提供路径脱敏/采样/排除，先确认覆盖首次访问和Routing Middleware/Function等实际日志源，再针对该项目配置；当前没有证据证明可按路径彻底关闭全部日志，不虚构开关。
4. 如无法路径脱敏，提交“仅Owner可读＋最短保留＋不导出原始路径”的具体限制供用户决定；它仍可能短时记录token，不能写成已脱敏。本轮没有替用户接受该取舍，也不擅自重构分享URL流程。
5. 当前版本部署获准后，用专用新合成分享做一次请求，立即在保留窗口内检查：各日志源是否含原始/编码token、成员权限、保留/导出范围。检查器只输出是否命中/计数，能力明文不进入报告；随后只按批准范围撤销测试分享。部署/新分享/发请求的具体增量仍须明确，不启动浏览器/E2E代替。

本轮没有新托管分享请求，因此14仍需专用路径实测及控制面措施/取舍结论。访问安全事件发生时先撤销受影响的具体分享，再查日志访问范围；不要把原始链接粘贴到普通工单或聊天。
