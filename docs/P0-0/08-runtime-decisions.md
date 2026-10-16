# 事务、上传与运行方案 ADR-01 · 待用户批准

日期2026-10-16。本次作出明确的**推荐选择：服务端 PostgreSQL 事务适配器**，不采用业务RPC。此处冻结可供审批的方案，没有安装数据库驱动、创建runtime角色、实现业务服务或部署worker。批准前不把此选择当成已获授权。

## 为什么选数据库适配器

回复/审核/交付/配额需要多表原子提交、行锁、幂等结果和补偿任务。用同一连接的BEGIN/COMMIT能完整表达这些边界，避免数次Supabase REST调用假事务，也不为早期业务引入大量高权限SECURITY DEFINER函数。Next只做HTTP/会话/DTO，服务域调用同一个transaction adapter。Supabase SDK继续用于Auth和Storage，不把Storage网络调用放进数据库事务。

RPC备选的权衡：能减少数据库连接管理，但必须另设计公开schema、函数EXECUTE、Owner/Guest上下文与definer权限。当前public表只授Owner SELECT，简单添加SECURITY INVOKER RPC并不能凭空获得业务写权限；用service key调用RPC也不会自动替代Owner/Guest核权。选择适配器后不保留“两条都能写”的业务入口，日后改RPC须另提ADR与权限迁移审查。

## 连接与权限具体约束

- 后续拟固定`pg`驱动，实施前核对其当日官方兼容、许可证和pooler要求；P0-0没有假装该未安装依赖已验证。使用Supabase Connect提供的**transaction pooler**连接串（IPv4适用），参数化SQL、不使用跨事务session状态或依赖命名prepared statement。TLS验证证书，不设置`rejectUnauthorized:false`。
- 专用`partmeasure_runtime`登录角色：非schema/table owner、NOINHERIT、NOBYPASSRLS，只授所需表/函数权限，禁止DDL、创建角色和任意函数执行。不能把postgres或service_role作为常规业务SQL身份。需审批后新增角色/GRANT/RLS migration；现有SQL草案还没有这些策略，不能直接上线。
- 每次借连接后BEGIN；Owner由Next `getClaims`及敏感动作`getUser`核验，再用参数化`set_config(..., true)`设置事务内主体/`auth.uid()`需要的claim；Guest先验证HttpOnly会话，再传会话摘要与动作上下文。SQL不能相信HTTP传入ownerId。
- RLS对runtime区分Owner与Guest：Owner必须project.owner_id等于已验身份；Guest必须联查session/link未撤销未过期、项目、可见性和动作，禁止几何编辑/确认/发布。浏览器anon/authenticated原有写入REVOKE保持，不因为runtime需要写入就放开Data API表写权限。
- Guest写入和链接撤销都锁同一share row；锁顺序固定project→share→issue/delivery/reservation。保存annotation compare revision；幂等键、业务行、审计、outbox同事务。提交后才返回成功。回滚后清理连接，finally release；连接污染/ROLLBACK失败则销毁，不归还池。
- 池大小起点每实例2，按测试项目配额和最终托管实例并发重新计算；不要用serverless实例数×池上限把数据库耗尽。对serialization/deadlock最多2次退避重试且保持幂等键，未知提交结果先查幂等结果。语句超时5s/锁等待2s仅提案，慢操作转worker。
- 日志只记SQL动作名/requestId/耗时，不记bind参数、连接串、会话摘要、令牌、用户正文。核对托管Postgres的错误参数日志设置，不能仅隐藏应用日志却把敏感参数写入数据库日志。上下文只在事务内有效，断线/池切换不复用身份。

## 上传校验与图像处理运行方案

推荐**独立受控Node worker进程 + PostgreSQL jobs/outbox**，与Next部署生命周期分开；采用托管VM/常驻进程服务，不依赖Docker或用户浏览器完成可信校验。不在Server Action接收100MiB文件体，也不把扫描/大图解码塞进短请求。具体托管商、资源和价格待审批，本次不申请或创建收费资源。

1. Next核权/限流→adapter锁project，原子预留原件+最多80MiB派生预算，创建reservation，返回只针对隔离路径的Storage签名。实际签名2h、TUS地址最长24h；UI的15分钟超时不能释放底层仍有效凭证的预算。
2. complete只做重新核权、HEAD/对象归属与任务入队，返回202。worker用`FOR UPDATE SKIP LOCKED`领取job并设置租约，提交短事务后再做网络/CPU处理；attempt和lease避免两个worker重复结算。SDK返回成功并不直接代表文件ready。
3. 流式下载隔离对象到随机本地临时文件，边读边计字节/SHA-256，超过类型上限立刻中止。校验扩展名、真实magic、有限结构、声明MIME的一致性，CAD不解析几何、不执行。文件名只作显示，不作为磁盘或Storage路径。
4. 扫描器建议ClamAV守护进程（单独许可GPL-2.0；尚未安装/接入）。扫描失败/超时/未知类型fail closed，不公开文件。ZIP是否允许扫描器内部有限解包与“不自动解压资料”的边界必须批准；未明确前ZIP保持quarantine，不把只检查ZIP头当安全通过。建议MaxScanSize200MiB、MaxFiles1000、MaxRecursion10、加密包拒绝，需用恶意/炸弹样本验证实际配置。
5. 图片候选实现Sharp0.35.5：`limitInputPixels:40_000_000`、`failOn:warning`、单页/允许codec、`autoOrient()`一次、移除EXIF/GPS、sRGB标准图；原件私有不覆写。独立实验验证了合成EXIF 1–8，未验证生产恶意图/真实手机内存。限制输入字节不是内存上限，解码需在可终止的子进程内执行。
6. worker资源建议单作业并发1、进程内存上限1GiB、图片CPU/墙钟30s、扫描60s、输出最多80MiB，临时磁盘至少原件+派生预算×并发+余量；这些是部署预算草案，需大图/损坏图压力验证后批准。Sharp内存cache限制不等于进程沙箱；守护进程要能杀死超限子进程并清除临时文件。
7. 派生物上传到新的不可覆盖路径；校验hash/宽高/normalization_version后，adapter锁reservation/project及有效链接，ready入库+预算结算+审计+job完成一次提交。若此时链接撤销，拒绝finalize并安排对象清理。外部Storage与DB无法同事务，失败用outbox重试，不伪称全原子。

## 孤儿清理与失败恢复

同一worker每15分钟扫描一次到期job/reservation；不新引入业务微服务。`cleanup_after = max(实际签名过期时间,TUS创建时间+24h)+1h缓冲`，按真实凭证最晚窗口计，不机械使用上传开始时间。清理任务先租约claim，Storage API删除后用HEAD/受控清单确认不存在，再在事务释放reserved_bytes并标cleaned。对象删除失败不能先减配额；重试1/5/30分钟后进dead-letter并报警。

按隔离路径前缀清单对账：不存在reservation的对象也必须过grant窗口/缓冲后才清除；ready/有历史引用的source、canonical、交付附件永不按“未出现在当前列表”推断孤儿。上传晚完成、重复complete、worker崩溃、先传派生物后DB失败、先删除后结算失败都要可重试；lease过期恢复以hash和幂等键判断已完成结果。累计上传流量配额需要Storage/网关计量，不能仅按最终ready大小，旧凭证重放仍是成本测试项。

## 待审批决策

| ID | 需批准的具体选择 | 批准前限制 |
|---|---|---|
| ARCH-01 | 服务端PG adapter + 非bypass runtime角色 + transaction pooler | 不创建角色/业务写策略/驱动或业务服务 |
| OPS-02 | 常驻Node worker、资源预算、具体托管与费用 | 不部署/采购worker；生产上传暂不能宣称安全可用 |
| FILE-03 | 扫描器、ZIP有限解包边界、格式/大小/配额 | 不自动开放未经验证的类型 |
| IMG-01 | Sharp标准化与原图/派生图保留策略 | 实验不等于正式图像处理实现 |

这些决策影响P0-1的文件管线、P0-2图像基准，以及P0-3/4事务；不要求提前实施全部P0才审查P0-0。
