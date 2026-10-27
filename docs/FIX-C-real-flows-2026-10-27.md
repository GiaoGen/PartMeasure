# FIX-C 真实流程、性能与权限交付记录

2026-10-27，范围04、05、08、09、10、11。统一状态以[问题清单§七](pre-p3-05-open-issues-2026-10-26.md#七唯一台账与包交接)为准。本轮代码修正、真实API批次及部分浏览器验证已完成；**六项均有待验证范围，不宣称整包关闭**。

## 版本、环境与授权

- HEAD `1c6979f39178c62f77b2edd8e48c88ef4a335a87`＋既有混合未提交工作区，非旧Preview或正式候选。最终应用/API驱动SHA-256为`fffa21103650d358557ae4bca7f856bd0117ba5babbab7cc2399f49b04488f33`，包括src、migrations、锁文件/配置、model/verify及所引用维护助手，辅助驱动另记摘要。中途修正显式保留source-review，未取消写入前源码门控；最终本地inspect确认摘要相同，seed/workflow/revoke全部完成且无pending。
- Node24.15.0/npm11.12.1、Next16.4.2；开发服务仅`127.0.0.1:3000`。真实Auth、受限PostgreSQL、私有Storage只用原隔离Supabase `rvysclscetfqicpnzlra`。Chrome155.0.8059.85为桌面证据；未认证本机代理/TUN缺席，不代表大陆、手机或托管环境。
- 用户授权一个新FIX-C项目、一个分享、最多4个正常Guest、四份合成文件≤4MiB、七标注/两版/私有草稿及回复/反馈/归档恢复撤销、限定浏览器。本批实际2个API Guest＋1个浏览器Guest。随后追加两份真实文件及七个测试标注；最后单独明确一次新邮箱注册、1封验证码，不自动重发。用户亲自配置SMTP/模板并收码确认。
- 未操作旧资料、部署、清理对象、做云备份恢复、修改网络/降低TLS、新增依赖或派生Agent。保留全部A/B/UI/登录/维护成果，不自动提交或进入P3-05。

实际批次`3acb7520-5d8e-4c9e-9a10-e8450c5798bf`，[计划](evidence/fix-c/plan-3acb7520-5d8e-4c9e-9a10-e8450c5798bf.json)。最早e85bc0fd批次仅离线准备，无云写入。私有state/Cookie/分享地址/测试凭据只存ignored受限目录，公开证据不含这些内容。

## 两个实质修正

### Owner下载流再次核权丢失请求作用域

合成PDF返回HTTP200后约5秒断流。阶段日志定位`reauthorize / REQUEST_CONTEXT_UNAVAILABLE`：原fileAuthorizer在stream pull重调owner，在请求作用域结束后重新调用Next cookies。

`auth.ts`抽出同语义`verifiedOwner(client)`；`file-authorizer.ts`在Route Handler内捕获请求客户端，下载两入口await构造。流中每5秒仍远程核实同一Owner，项目/分享/文件逐次核权，不缓存授权。`file-response.ts`仅在`PM_SERVER_TIMING=1`输出固定阶段/有限码/字节计数，不含原始错误、URL、文件名或Cookie，不放宽期限/权限。

新增3项作用域/身份丢失/Guest核权回归，补诊断脱敏检查。[同一PDF](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-pdf-download-1793077987867.json)完整2,619,007字节/hash通过，23,312ms，跨过5秒重验点。后续照片原件40,073字节/hash通过；此前一次长度中断根因未定，不声称所有网络截断都已解决。

### 业务池2连接导致并发排队超时

Owner/Guest首屏8个GET，[修前](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-read-burst-1793079478090.json)2个503，等pool约10秒且未进入SQL。`db.ts`网页每进程上限改4，维护池仍2，连接/闲置10秒及严格TLS保持。

重启后[同样8GET](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-read-burst-1793079595761.json)全200，但仍约17～21秒，不能算性能体验通过。扩容须计总连接预算。浏览器后续仍有间歇Pooler `pg_ssl_request_rejected`、Auth status0、ECONNRESET/503，根因未全部确认，同条件停止重试。诊断只用于临时进程，最终恢复普通开发入口，未改.env。

## 08/11：真实API业务与权限

[seed](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-seed.json)、[workflow](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-workflow.json)、[revoke](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-revoke.json)用正常Owner A/B及Guest，未用管理员或伪造身份代验。

- 四份合成文件共2,659,318字节，预留/签名/上传/请求内处理/原件hash完成；七类标注、两版原子发布、一个私有草稿。format-only-v2不表示病毒扫描。PDF完成503后先只读确认queued/PROCESSING_INTERRUPTED，再同对象一次retry到ready，未重传，失败/恢复记录均保留。
- 另一Owner项目/文件404；Guest私有草稿/内部附件404、照片原件/私有修订403、错误版本附件404；默认最新已发布、旧版身份/附件hash通过。
- 数值/照片/无法测量三类回复、补测再提交通过；Owner改变线段后旧固定快照不变，照片回复不伪填数值，历史追加保留。
- V1留言、收到/接受/本次撤销通过；另一Guest撤销他人接收409，Owner写客户反馈403；V2反馈不串版。
- 归档后双方可读旧版附件、业务写409；撤销后两个旧API Guest401。恢复项目后旧会话继续401，包括preview/download/annotated-export/image-access；Owner仍可读。项目最终进行中，分享保持撤销，未清理云资料。

这些是普通角色真实API结果。UI事件/输入、浏览器缓存失权、长流进行中撤销仍待验；超过10版页界复用P2定向证据，未虚构本批真实11版。

## 09：真实文件及导出边界

用户批准照片447×447/13,672字节与SLDPRT311,748字节共325,420字节，[同项目上传/原件下载hash](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-real-files-1793078699608.json)通过。七类标注明确“FIX-C测试”，无真实尺寸；低分辨率不能证明高像素性能。

[SolidWorks32.0.1本地静默只读打开](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-cad-read-1793078760.json)通过：错误0、警告0、零件类型1、一个配置，源hash未变，关闭本轮文档/实例。打开的是源文件；下载副本hash相同，不能称已直接打开下载副本。首次COM属性误当方法的辅助脚本失败已保留并修正，不计为应用缺陷。

**本批没有生成或下载PNG/JPG/PDF/ZIP导出输出。** [exports记录](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-browser-exports-1793080353985.json)在Owner加载失败，downloads为空。inspect-exports.py仅准备、未执行。旧P2离线样本有效，但不代替真实导出保存/打开、密集中文/长备注和手机验收。

## 10：浏览器已通过范围及连接阻塞

[真实Chrome/IndexedDB](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-browser-inspect-1793077314645.json)实际持久字节大小/hash、重启独立Chrome上下文后先新image-access核权再复用通过，0页面错误/意外业务写。重开仍有1次preview及1次新核权，不称零请求，不用Map替身。

[双角色浏览器](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-browser-workflow-1793080123738.json)Owner/Guest真实照片深链接/画布读取通过；随后Owner交付读取503，未打开草稿，事件/输入检查未开始。另一次Guest503/SSR失败保留；触发事件的合成留言未执行，浏览器业务写被拦。跨Tab、换号、BFCache/前后台、长事件资源、撤销后缓存未验，API通过不充抵。

辅助驱动摘要现于启动捕获并检查driverUnchanged；首轮误读运行中后改的驱动，已依据保留initial证据更正并解释，未改业务结果。间歇云连接失败仍阻塞后半段，不再盲目重跑。

## 04：真实数字OTP完成范围

用户亲自配置QQ SMTP，将Confirm sign up正文保存为：

```html
<p>你的注册验证码：<strong>{{ .Token }}</strong></p>
```

正常应用注册只点击一次、发一封验证码，用户亲自收信/输入正确码并明确确认完成。[普通密码登录/确认会话/空项目列表/错误数字码拒绝](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-otp-check.json)通过，错误码HTTP422；实际IAB刷新仍为已登录项目页、0项目。受限截图留私有目录，不公布邮箱/凭据，不再注册发信。

**实际超时过期码、已使用码重放未测。** OTP_INVALID_OR_EXPIRED文案不代验，04仍待验证。无需再次配置SMTP。详细设置及Resend路线见[配置单](operations/otp-smtp-setup.md)。云Supabase连接SMTP，localhost网站不要求公网域名；Resend发件域名与网站部署分开，无需应用新增Resend SDK/API key。个人邮箱SMTP仅证明少量投递，非正式容量/送达率通过。

## 05：用户暂缓大陆网络

用户明确本轮搁置大陆网络，后续当前版本真实域名＋Vercel入口再测。暂缓非通过或永久接受不可用；真机/跨设备欠项保留，不反复催促或探测无TUN。Vercel服务端链路可能改善本地直连，但浏览器上传仍直连Supabase Storage，域名不能保证覆盖全部路径/运营商。本轮未部署或改网络，无真机结果。

## 集中检查与最小剩余条件

最终lint 452文件、typecheck、74文件456项单测、production build均通过；[检查摘要](evidence/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf-final-checks.json)。构建后恢复原next-env生成引用及开发入口。未运行完整P3-05 E2E，定向浏览器部分通过不等于全站通过。

1. 保留04真实闭环，以后仅补实际过期/已用码分支，不自动追加邮件。
2. 当前版本稳定可达的获准入口，再补08/09/10/11的UI事件/输入、实际导出保存打开、缓存失权及在途撤销。本批分享已撤销，不自行新建/复活分享绕过门控；必要新会话/写入需明确具体增量。
3. 实际设备/跨设备补05及手机保存；大陆按用户决定暂缓至托管条件，不要求现在立即配合。

云端灾难恢复归FIX-E，项目归档恢复不能替代；不自动进入其他包/P3-05或部署。
