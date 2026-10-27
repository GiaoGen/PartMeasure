# 本地 PartMeasure 数字验证码邮件配置单

2026-10-27。适用于当前原隔离Supabase项目`rvysclscetfqicpnzlra`，网站仍在`http://127.0.0.1:3000`运行。以下保留可复用步骤。用户已配置QQ SMTP/数字Token模板，2026-10-27一次真实注册收码确认完成，密码登录/刷新及错误码拒绝通过；实际过期/已用码重放未验。见[FIX-C记录](../FIX-C-real-flows-2026-10-27.md)。无需重新注册或发信，不操作生产。

## 1. 选择这条路径

本机网页 → 本机PartMeasure接口 → 云Supabase Auth → QQ邮箱SMTP → 真实收件邮箱。

推荐先用一个专用测试QQ邮箱，暂时不用Resend：不需要自有域名，不需要Vercel部署，不需要给本机安装SMTP服务，也不需要在应用中接Resend API。SMTP由云Supabase连接，不由浏览器连接。

个人邮箱只用于这次少量开发验证，不把它当正式用户规模的长期邮件基础设施。云端登录和投递可能受邮箱供应商风控影响，必须实际验证；不承诺填写参数后必然送达。

准备两项：

- **发件邮箱**：你控制的专用QQ邮箱，用于提供SMTP服务。
- **收件邮箱**：你能正常收信、尚未在这个PartMeasure应用注册的真实邮箱。可以是另一个邮箱；若发件邮箱尚未在本应用注册，也可用它自己收信。Supabase管理后台的登录邮箱与应用Auth用户是不同概念。

## 2. 在QQ邮箱开启SMTP，生成授权码

这一步由你在自己的邮箱界面操作。

1. 在电脑登录[QQ邮箱网页版](https://mail.qq.com/)。
2. 打开「设置」，查找「账号／账号与安全」中的「第三方客户端」「POP3/IMAP/SMTP」或「授权码」。不同版本页面名称可能不同，以“SMTP服务”和“生成授权码”为准。
3. 开启包含SMTP的第三方客户端服务。按邮箱要求完成手机／安全验证。
4. 生成一个专门用于本次测试的授权码，保存在自己的密码管理器中。

**授权码不是QQ网页登录密码。不要将授权码、网页登录密码、手机安全码或API key发给Agent，也不要写入代码、文档或Git。** 后面把授权码直接填入Supabase后台的SMTP Password字段。

官方说明：[QQ邮箱第三方客户端与授权码](https://help.mail.qq.com/detail/106/985)。

## 3. 在正确的隔离Supabase项目填写SMTP

1. 登录Supabase Dashboard，选择项目ref **`rvysclscetfqicpnzlra`**。先核对项目，避免改到其他项目。
2. 进入「Authentication」，找到「Email」（一些界面归在Notifications），打开「SMTP Settings」。若导航位置不同，查找“Custom SMTP”。
3. 启用自定义SMTP，按表填写并保存。

| 字段 | 填写内容 |
|---|---|
| Sender email address | 你的发件QQ邮箱完整地址，例如`123456789@qq.com`；不能填虚构的`noreply@localhost` |
| Sender name | `PartMeasure 测试` |
| Host | `smtp.qq.com`，不加`http://`或`https://` |
| Port number | `465`，使用TLS加密连接；若界面提供加密选项，选SSL/TLS |
| Username | 与发件人对应的完整QQ邮箱地址 |
| Password | 第2步生成的SMTP授权码，直接在后台填写 |

不要填QQ登录密码，不要把授权码写进本机`.env.local`。本项目走Supabase Auth发信，不需要新增`SMTP_PASSWORD`或`RESEND_API_KEY`应用环境变量。

如果后台有邮件发送频率配置，先保留保守限制，只做少量测试；不要为测试关闭限流。保存SMTP设置本身不证明真实邮件可达。

## 4. 保留邮箱确认，并修改“注册确认”模板

1. 在Authentication的「Sign In / Providers」或「Providers → Email」中确认邮箱登录已启用，**Confirm email保持开启**。
2. 回到「Email Templates」，选择 **Confirm sign up（注册确认）**。不要只修改Magic link／OTP登录模板；当前应用是“邮箱＋密码注册，再输入数字码确认”。
3. 邮件主题可填：`PartMeasure 注册验证码`。
4. 邮件正文替换为以下HTML后保存：

```html
<h2>确认注册 PartMeasure</h2>
<p>你的注册验证码：</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">
  {{ .Token }}
</p>
<p>请返回刚才的注册页面，输入这串数字完成邮箱确认。</p>
<p>验证码有效期以系统设置为准，请尽快使用。</p>
<p>若非本人操作，请忽略这封邮件，不要向他人提供验证码。</p>
```

必须保留 **`{{ .Token }}`** 的双大括号、点和大小写；它是Supabase填入的数字码。不要换成`{{ .TokenHash }}`，也不要只放`{{ .ConfirmationURL }}`链接。

5. 在URL Configuration核对本次本地入口使用`http://127.0.0.1:3000`。数字码由人复制回原页面输入，不需要公网回调，也不用为此开端口转发或隧道。以后托管时再按获准环境配置域名；不要随意覆盖其他已在用入口。

当前应用已经使用`signUp(email,password)`和`verifyOtp({email,token,type:'signup'})`。不关闭邮箱确认，不改成无密码OTP登录，不由管理员手动确认来代替此验证。

官方依据：[Supabase自定义SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[数字Token与注册确认模板](https://supabase.com/docs/guides/auth/auth-email-templates)。

## 5. 配置好以后怎么配合

你只需告诉Agent：

> SMTP和Confirm sign up数字码模板已配置；本次收件邮箱为：你的测试邮箱。

不要提供密码或SMTP授权码。该收件邮箱必须能收信，并且尚未在**本应用**注册。若不确定是否已注册，先说明，不自动删除旧用户或尝试覆盖账号。

之后Agent会先列明这次实际注册/发信范围，获得明确授权后再执行：

1. 从应用注册一次，不用Supabase后台“Invite user”或管理员确认代替。
2. 你查看真实收件箱（也查一次垃圾邮件），确认收到的是数字码。
3. 先核对错误码拒绝，再输入正确码确认；不记录或提交验证码到证据文件。
4. 用密码登录并刷新页面，核对会话恢复；已使用码拒绝与实际过期码验证分开记录，不把一个通用错误文案当作已测过期。

如由你亲自在页面输入验证码，就不必把验证码发到聊天中。测试密码留在本机ignored专用安全目录，不进入仓库或报告。

## 6. 如果失败，按现象只查对应一步

| 现象 | 优先核对 |
|---|---|
| SMTP认证失败 | 用户名是否完整邮箱、是否填了授权码、该码是否已撤销、SMTP服务是否已开启；不要反复试QQ登录密码 |
| 连接SMTP超时／TLS失败 | 云Supabase到邮箱供应商的连接或供应商风控；保留脱敏错误，不关闭TLS或改系统代理来追求通过 |
| 邮件发出但收不到 | 发件记录／Supabase Auth日志、收件箱垃圾邮件、发件人与认证邮箱是否一致；不反复点注册或发给假邮箱 |
| 仍然收到链接 | 是否改了正确项目的Confirm sign up模板，是否保存成功，是否看的是本次新邮件 |
| 验证码不正确／已过期 | 邮箱、最新一次验证码、输入完整性及有效期；不读取后台token或管理员确认来绕过 |
| 页面报429 | 尊重重试时间和供应商发送限额，不提高限额或换邮箱反复轰炸 |

同条件失败停止盲目重试。QQ SMTP若被云端风控阻止，记录原因，再选择其他已有SMTP邮箱或等自有域名，不改造应用认证架构来绕过。

## 7. 以后切换到域名＋Resend

有可控制DNS的自有域名后，在Resend验证发件域名/子域（按其生成的记录配置DKIM/SPF等），再将Supabase SMTP改为：

| 字段 | 内容 |
|---|---|
| Host / Port | `smtp.resend.com` / `465` |
| Username | `resend` |
| Password | 专用Resend API key，只填Supabase后台 |
| Sender email | 已验证发件域名下的地址，例如`noreply@auth.example.com` |

**网站仍可在本机运行。** Resend验证发件域名，并不要求网站已经部署在Vercel。后续网站绑定真实域名和大陆网络实测分别处理；它们不是数字码邮件的前置条件。

域名购买、DNS变更、正式切换及发信另按实际授权执行；当前不自动采购或部署。[Resend官方Supabase SMTP接入](https://resend.com/docs/send-with-supabase-smtp)
