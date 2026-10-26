# TUN开启后登录仍失败的检查

2026-10-25。用户报告本地登录返回503及 `dependency_failed / DEPENDENCY_UNAVAILABLE / hint=timeout`，怀疑与P2-02有关。本轮只检查及生成诊断证据，未改登录、限流、数据库配置或系统网络；未部署、启动服务器或浏览器。

## 结论

当前复现的阻塞发生在**本机到Supabase PostgreSQL Pooler的连接/TLS建立阶段**。登录入口先做两次数据库限流事务，再调用Supabase Auth；数据库连接10秒超时使请求提前返回503。

P2-02没有修改登录分支、Auth客户端、数据库连接池、连接超时或错误映射；新增反馈表的约束/触发器也不参与登录限流表的访问。当前错误发生在进入SQL和密码认证之前，没有证据需要回滚反馈功能。

这与此前 `auth_verification_failed / status=0` 不同：此前日志来自认证网络请求；此次日志来自接口捕获的原始依赖异常。两者最终都可能显示“服务暂时不可用”，页面文案不能用于区分具体失败环节。

## 实测对照

全部在用户明确已开启TUN的当前环境进行，不能充当大陆无TUN验证。

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 同测试账号独立请求Supabase Auth | 成功，约4.54秒 | 账号和认证服务当前可用，未经过本地应用数据库限流 |
| 独立受限pg.Client连接并SELECT | 约10.01秒超时；进程TCP事件约31ms，无TLS完成 | 没有经过应用连接池，也未进入用户认证或查询阶段；无法用P2反馈SQL或单纯应用池排队解释这一复现 |
| 6543直接TLS无凭据对照 | 约10.04秒超时 | 改用直接TLS握手没有解决，不据此修改生产连接参数 |
| 既有5432事件连接TLS | 约10.01秒超时 | 实时事件连接也受影响；网页HTTPS可达不等于数据库端口可达 |
| 当前127.0.0.1:3000健康/CSRF | 均200 | 本地Next服务运行正常，无需另起服务器 |
| 当前本地应用正常测试账号登录 | 约10.26秒，503 DEPENDENCY_UNAVAILABLE | 复现用户症状；本轮请求ID为357578ea-7b26-4418-a1d4-a9bc3890672b，不冒充用户原请求的日志关联 |
| 原非生产Preview同账号正常登录 | 200，约1.29秒 | 云端应用完成数据库限流及认证；未发布新版本 |
| Supabase控制面 | ACTIVE_HEALTHY；服务端只读查询成功 | 快照未观察到活跃客户端、idle-in-transaction或锁等待；管理链路不代替本机Pooler验证 |

P2-02的原交付证据 `docs/evidence/p2-02/database.json` 也记录过应用运行时读取的 CONNECTION_TIMEOUT。其数据库事务权限验证通过和客户端连通性失败本来就应分开判断，不能将时间接近当成业务功能造成网络错误的证据。

## 代码与证据位置

- `src/app/api/[...segments]/route.ts`：登录先执行auth:global及邮箱哈希限流事务，再signInWithPassword。
- `src/lib/server/db.ts`：连接池connectionTimeoutMillis=10000，与当前约10秒失败对应；连接在begin和SQL工作之前取得。
- `src/lib/server/http.ts`：未被分类为AppError的原始异常映射503，并打印dependency_failed；timeout是脱敏分类，不是数据库返回的具体SQL错误。
- P2-02提交 `1393dbe`：只在API增加反馈导入/分支，未更改上述登录逻辑或连接配置。
- [独立Auth/PG对照](evidence/auth-direct/login-dependencies-1792918276488.json)
- [TLS握手方式/事件连接对照](evidence/auth-direct/pg-tls-variants-1792918427640.json)
- [现有本地登录复现](evidence/auth-direct/local-login-1792918539982.json)
- [原非生产Preview登录对照](evidence/auth-direct/preview-login-comparison-1792918655273.json)

## 下一步应修复的位置

当前本地配置业务库为 `aws-0-ap-northeast-1.pooler.supabase.com:6543`，事件库为同域5432。应核对TUN对这个域名/两个TCP端口的实际规则与出口支持，并验证是否完成服务器TLS响应；也需保留上游Pooler链路故障的可能，不能仅凭现有结果锁定某个代理规则。

不能因为浏览器、Codex或Supabase HTTPS正常，就认定数据库也经过同一出口且可用；也不应盲目改DIRECT、关闭证书验证、增长超时或删除限流。将登录限流从远程业务数据库中解耦可以另作可用性方案，但单独跳过限流仍不能让后续项目读写恢复。

本轮已定位并复现原因所在链路，**尚未修改网络配置或修复本机数据库连接**。诊断脚本 `scripts/performance/login-dependency-probe.mjs` 定向lint通过，不采集或输出密码、令牌、SQL正文或业务数据。测试只做正常测试账号登录与受限只读探测。
