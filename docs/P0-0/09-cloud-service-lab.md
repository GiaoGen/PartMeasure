# 无Docker云服务实验与邮件配置记录

日期2026-10-16。状态：隔离项目与实验对象已建立；邮件被接受、两个邮箱已确认；**未取得可用会话，A/B与Storage完整实验未执行，不能标PASS**。用户决定暂不配置SMTP，相关验证保持待完成，不再发送邮件。

## 目标及授权范围

MCP先列组织，用户指定`MESS's Org`（`mndzgvsjfzqrejuqldvm`）；get_organization返回Free、get_cost报价**$0/月**。随后create_project新建`partmeasure-p0-0-lab`，ref `rvysclscetfqicpnzlra`，东京`ap-northeast-1`，状态ACTIVE_HEALTHY；get_project返回Postgres17.11。此项目是隔离服务实验，不是生产或正式业务环境；没有选择或写入任何既有项目。

全程未运行Docker。MCP只建立独立`public.p0_lab_records`和1MiB私有桶`p0-0-service-lab`及限该桶/自有用户目录的实验策略。没有应用`supabase/drafts/baseline.sql`，没有创建或替换`auth.users`、`auth.uid()`、Storage表或其他本机替身。使用真实Supabase系统schema；SQL读取仅返回版本、布尔/计数，不读取认证token。

| 实际MCP操作 | 结果 |
|---|---|
| list_organizations → 用户指定 → get_organization/get_cost | 单个组织，Free，$0/月 |
| create_project / get_project | 新项目ACTIVE_HEALTHY，PG17.11 |
| list_tables(public)（建立实验前） | 空，确认无既有业务表 |
| execute_sql版本/schema存在检查 | PG17.11，auth/storage均为真实系统schema |
| apply_migration `p0_0_isolated_service_lab` | success；云端migration version `20261016093639` |
| list_migrations | 只见该实验migration；根business空marker未部署 |
| get_advisors(security) | 1项warning：Leaked Password Protection Disabled；未宣称零告警 |
| execute_sql聚合Auth计数 | 2个真实用户、2个email_confirmed；不代表脚本持有登录会话 |

advisory说明：目前实验采用邮箱链接/OTP而非密码；该告警仍保留，生产是否启用泄漏密码保护待正式Auth方案及套餐确认。[官方修复说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 邮件实际经过与恢复边界

用户提供A/B两个测试邮箱，B的`gamil.com`拼写经用户明确更正为`gmail.com`；地址仅写ignored config，脱敏证据用A/B标签。两个`signInWithOtp`请求均被服务接受，用户确认收到的是登录确认邮件；**默认signInWithOtp发送Magic Link，不是自动发送数字码**。本次未在发送前向用户解释默认邮件类型及配额，记录为流程失误，不能把“API接受”当OTP验证通过。

官方[passwordless说明](https://supabase.com/docs/guides/auth/auth-email-passwordless)要求模板含`{{ .Token }}`才发数字验证码。[SMTP文档](https://supabase.com/docs/guides/auth/auth-smtp)当前写默认上限2封/小时（可变，实际以项目429/Retry-After为准），且默认发信有团队地址限制；没有把它误写成可任意收件人或无限重试。本次只有2个服务接受的发信请求，没有重发。

已有邮件可用原始Supabase verify URL在脚本中验证，无须localhost网页；若已点开并跳转到localhost，完整回调fragment可能包含可由真实Auth验证的会话。用户安全保存的两份输入均是原始链接，verifyOtp各返回`403 / otp_expired`；同时服务器已记录两邮箱确认。结果与链接已消费相符，也可能存在过期/邮件扫描因素，不能仅凭错误断言具体根因。没有可用会话；没有把邮箱已确认当成Auth客户端登录测试成功。

两个敏感链接仅存ignored input，处理后删除，不输出聊天/日志/commit。`auth-request-*.json`只保存A/B/接受状态；`auth-verify-*.json`只保存method、错误status/code，不含邮件、userID、JWT、refresh token、链接或正文。

## 改为验证码的配置缺口与用户决定

用户要求先暂停会话/Storage实验并改成数字码。Supabase MCP没有Auth模板/SMTP管理接口；尝试浏览器控制时初始化失败（找不到kernel assets路径），未读到Dashboard。用户手动确认模板页显示 **“set up custom SMTP to edit source”**，与[新Free项目限制](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)一致。

最少人工步骤（**未执行、不是本次待办强制要求**）：只在该测试项目Auth→SMTP配置自有发信服务，凭据留Dashboard；然后将Magic Link与Confirm signup正文设为`experiments/cloud/otp-email.html`（无链接，显示`{{ .Token }}`）。无需因本实验擅自升级套餐；SMTP供应商自身费用另由用户决定。MCP无法完成此配置，未用SQL改auth系统表绕过。

用户最新决定：**暂不配置，记录验证码验证待完成**。因此SMTP未变更、验证码模板未保存、数字码送达/验证未运行，A/B会话和Storage完整服务实验保持待完成。没有索取/使用service secret，没有调用Auth Admin伪造邮箱验证通过，也没有再次发邮件。

## 可复跑脚本（待用户恢复验证并配置后）

配置仅在`tmp/p0-0-cloud/config.json`（ignored）；样例`experiments/cloud/config.example.json`不含真实key/邮箱。项目ref校验固定为新实验项目，脚本拒绝其他目标。Windows包装器只为该Node子进程复用已配置系统代理，不改系统设置；Node直接访问曾ECONNRESET，经系统代理后真实HTTP可用，这不算大陆移动网络验证。

```powershell
# 已有config，恢复验证后才运行；下列request会发邮件，需再次获得用户明确授权
# 默认已请求过的A/B会拒绝重发，绝不自动消耗配额
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/labs/run-cloud.ps1 -Action request -Actor A -ResendConfirmed
# 把数字码或原始确认链接仅写到 ignored otp-A.txt；不要放CLI参数/聊天
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/labs/run-cloud.ps1 -Action verify -Actor A
# B同理；两者获得真实、未过期会话后：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/labs/run-cloud.ps1 -Action services
```

`services.mjs`已准备但**未执行**：真实getUser、A/B不同主体、自有行读写、已知对方ID拒绝、伪造owner/reassign拒绝、匿名拒绝；私有上传下载字节一致、跨用户/匿名拒绝、禁止upsert/MIME、公有URL拒绝、短签名下载；finally用Storage API/行delete清理，脱敏证据列逐项PASS/FAIL。实验特意使用用户JWT的目录RLS，正式Guest走server capability，两者不可混同；不会证明分享撤销、业务文件归属或正式API已实现。

## 留存、清理与验收界线

项目名中的P0-0表示创建阶段，不表示用完即丢弃。该ref可持续用于P0-1～P0-4的Supabase服务/应用测试，不需要每阶段重建；配置和脚本用ref识别，显示名可由用户另行决定改为`partmeasure-test`。本轮不擅自改名、暂停或删除。正式业务schema只在批准后按migration进入；先清理或明确隔离`p0_lab_`实验对象/策略，防止实验权限影响业务验收。若未来需要破坏性回放或并行隔离，再按需建立第二测试项目并核价；生产须独立项目和凭据。

目前云端仅保留实验表/桶/策略和2个确认邮箱用户，没有上传业务文件、取得/保存可用session或创建业务项目。用户暂缓后保留隔离资源供恢复验证；Free项目当前报价0，不承诺未来供应商定价或超额费用不变。`teardown.sql`仅供用户决定结束实验后清理，先Storage API清空对象，再移除实验策略/桶/表；不删除系统schema，不在production执行。实验migration和应用migration链分离。

真实Auth与Storage服务实验待完成会限制“外部服务验证完成”的结论；它们不是“必须先实现P0-1～P0-4”的理由。正式SSR OTP、Cookie恢复、Guest分享撤销、私有文件网关、恶意上传/配额、并发事务及交付闭环分别留待对应业务阶段。
