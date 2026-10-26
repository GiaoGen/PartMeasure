# PartMeasure 运行、维护与恢复手册

2026-10-26。适用当前P2完整功能及P3-01～04工作区源码；正式候选尚未固定，旧Preview不代表当前源码。阶段证据见[P3-04记录](../P3-04-operations-recovery-2026-10-26.md)。

## 1. 正常运行

使用Node24.15.0/npm11.12.1、精确依赖及package-lock，无Docker。`npm ci`后从`.env.example`准备ignored配置，运行`npm run dev`，或构建后`npm run start`。默认仅127.0.0.1:3000；不要停止其他应用的监听端口。启动本身不授权部署、浏览器/E2E、邮件或迁移。

普通网页只需要Next服务、真实Supabase Auth/PostgreSQL/私有Storage；上传在有界请求内校验/处理，没有常驻Worker、ClamAV、扫描病毒库或额外处理主机。format-only-v2只表示格式/大小/hash等校验，不是病毒扫描。浏览器中的OpenCV按需加载，不能据此承诺复杂反光照片识别精度。

| 配置 | 用途与约束 |
|---|---|
| `APP_URL` | 精确站点Origin，本地与实际端口一致；受信Preview运行时地址由现有代码处理，不信请求Host |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Auth/客户端连接的公开配置，只指原隔离项目；不能把secret key放入publishable字段 |
| `SUPABASE_SECRET_KEY` | 仅服务端私有Storage，绝不`NEXT_PUBLIC_`、不写日志或前端产物 |
| `DATABASE_URL` | `partmeasure_runtime`事务连接，非owner、非BYPASSRLS；普通应用不能用postgres/管理员身份 |
| `EVENT_DATABASE_URL` | 同一受限runtime的session连接5432或可信直连，6543事务pooler不能LISTEN；仅事件，不是上传消费者 |
| `DATABASE_CA_FILE` / `DATABASE_CA_PEM` | 严格TLS验证；本地用可读CA文件，托管用非空PEM。不要用空PEM覆盖有效文件，不设置rejectUnauthorized=false |
| `STORAGE_MAX_FILE_BYTES` | 默认50MiB，最终取供应商/桶/业务格式更严格限制；应用账户5GiB预算不代表Free套餐有5GiB可用存储 |
| `PM_SERVER_TIMING` | 默认0；临时诊断仅固定阶段耗时/次数，不记URL、身份、正文、SQL或参数 |
| `WORKER_DATABASE_URL` | 仅显式维护工具的受限维护角色，不是网页或后台上传Worker的运行必需项，不把它上传到网页部署配置 |

Resend SMTP凭据、数字Token模板、Auth站点/确认策略留供应商安全设置中；本手册不包含凭据。新注册数字OTP送达/确认尚待真实证据，不能用已有账号密码登录代替。

## 2. 发现故障时

先运行`npm run ops:status`。默认只输出必需变量是否存在、Node主版本、TLS配置是否存在及当前上传政策，不接触网络、不发信。变量存在不代表值正确；`GET /api/health`仅liveness，也不证明数据库/Auth/Storage/权限通过。

| 现象/错误码 | 应对 |
|---|---|
| 本地登录成功、项目读失败 | Auth和业务数据库是不同链路；保留已批准loopback本地限流修复，不切换假认证或把postgres塞入应用连接 |
| `ENOTFOUND` / 已知无TUN HTTPS问题 | 记录环境/时间/阶段和脱敏错误码；沿用既有欠项，不重复切换代理/TUN/DNS或扩大排查 |
| `ORIGIN_MISMATCH` / `CSRF_INVALID` | 核对浏览器实际Origin及APP_URL/可信Preview地址；必要时重新进入页面取得新凭据，不扩大CORS、不禁用CSRF |
| `DATABASE_BUSY/TIMEOUT/CAPACITY` | 保留输入，待重试；核对实例数×每实例2连接与事件session连接，检查连接/锁/容量，不不断扩大池或关超时 |
| `PROCESSING_ACTIVE/EXPIRED/INTERRUPTED` | 页面关闭/断线后可能中断；保留队列，下次进入或显式重试。不要启动退休Worker来消费同一预留 |
| `TRANSFER_BUSY` / `RATE_LIMITED` | 等待已有任务或窗口释放后重试，不刷新轰炸；数据库共享限流继续生效，托管不可自动降为内存限流 |
| `LINK_UNAVAILABLE` / `PROJECT_ARCHIVED` | 正常权限/只读边界；Owner检查分享/归档，不能靠客户端改状态或跳过核权 |
| 孤儿文件/额度长期占用 | 使用下面只读查看和受控清理。存在历史引用、Storage状态未知或租约尚有效时不能先减配额 |

日志保留请求ID、有限错误码、阶段、时间和动作即可，不记录密码、OTP、Cookie、分享路径/token、签名URL、连接串、私有文件名/正文。托管访问日志可能记录`/s/<token>`，发布前仍需核对脱敏与受控保留；应用no-referrer不等于托管日志已脱敏。故障证据进入普通文档前再次去敏。

## 3. 一次性维护

`npm run ops:status -- --database`在显式提供原隔离项目维护角色后，只读输出待处理、过期处理、待清理、需人工处理计数和预留字节。它不通过RLS空上下文下的零行冒充“没有积压”，也不读项目正文。未配置/网络失败会明确失败，不回退管理员角色。

`npm run ops:cleanup -- --dry-run`只查看；`npm run ops:cleanup -- --apply`才删除符合条件的对象。当前CLI只允许原隔离项目及非生产目标，不能直接作为生产维护任务。每批≤20、工作信号120秒、租约5分钟；需等待上传凭证/处理/旧任务租约过期并留余量，逐个确切对象确认404后才释放预留。ready资料仅清隔离重复副本，失败保留额度，5次失败后人工接管。详见[P3-03边界](../P3-03-server-security-2026-10-26.md)。

没有自动Cron或云端清理部署。本轮未删除已有云对象。运行者应在明确目标后安排一次受控维护，再根据实际积压决定频率，不因“无Worker”省略维护责任。旧缩略图/事件/限流表的保留维护不能随意执行整表DELETE；任何涉及历史/幂等重试窗口的清理需明确保留规则。当前工具只处理已定义的上传孤儿，不宣称覆盖全部数据库维护。

## 4. 备份覆盖与当前能力

2026-10-26已核对原隔离项目Free、PostgreSQL17.11，未采购套餐、PITR、主机或新云项目。[供应商备份说明](https://supabase.com/docs/guides/platform/backups)明确自动每日备份面向付费套餐，并且数据库备份不含Storage对象字节；不能以“平台有备份”代替本方案。

| 内容 | 备份集覆盖 |
|---|---|
| 项目/文件夹/资产/标注修订/测量回复/审核/版本/附件集合/反馈/归档/审计等 | `pm`完整schema、数据、RLS/触发器/ACL及序列，pg_dump同一导出快照 |
| Auth | `auth` schema/数据，包括用户与身份关系；排除sessions/refresh_tokens/one_time_tokens/flow_state/mfa_challenges/saml_relay_states等活动能力表数据。它不能代替新环境SMTP/模板/JWT密钥/Provider配置与真实重新登录 |
| 已保存私有照片/原件/派生图/附件 | 从全部file_assets及image_derivatives取得固定路径/大小/hash，不过滤软隐藏或旧版本；逐个下载并验证实际大小/SHA-256，包含有历史引用的字节 |
| 未完成上传/隔离中对象 | 不含不稳定的quarantine字节；数据库记录保留，恢复后中断上传改为明确需要新上传，不冒称可继续旧TUS会话，预留仍按受控清理处理 |
| schema来源 | 每份正式migration源文件及hash，加上可读到的supabase_migrations历史schema；应用源码/锁文件另外由Git/候选源码清单保存，不能用一个旧buildId替代当前未提交代码 |
| 凭据和托管设置 | DB角色密码、Storage/API/JWT/SMTP密钥、域名、环境值、供应商Auth设置不复制进备份；在独立密码库/配置清单恢复。只备份数据库无法恢复全部托管控制面 |

工具默认只备份原隔离项目，不扫描其他项目；源管理员凭据只供操作端pg_dump，不能替代网页runtime。要求session pooler5432，导出快照连接在数据库dump、指纹和对象校验结束前保持，同内容私有路径不可覆盖；对象缺失/hash不符/超限均失败，不生成最终manifest。数据库快照和Storage不是分布式事务，本方案依赖已保存对象不可变及受控清理不删除仍被引用的字节。

备份上限：20,000对象、单对象100MiB、数据库dump1GiB、整集8GiB、manifest16MiB、20分钟工作deadline；流式逐个处理，不把整集装入内存。超限不截断，先评估分集/容量再调整。对象下载另有60秒时限，SQL及子进程有界。备份过程不是公开HTTP功能。

每个数据库/对象/迁移文件和manifest均独立AES-256-GCM加密，随机IV，逻辑名称参与认证；加密文件只有编号，manifest最后写成，失败残集不能恢复。认证失败的明文只可能短时位于私有staging，失败即清除，不传业务读取。新维护目录使用Unix0700/文件0600；Windows额外限制继承ACL，仅当前操作用户、SYSTEM及管理员，**只改新维护目录，不改整个工作区**。

目标：试运行阶段RPO≤24小时，并在大变更前做备份；RTO工程目标≤4小时（当前应用账户≤5GiB规模，含验证/配置恢复），不是供应商承诺或本轮已经达成的指标。保留7份每日＋4份每周已完成备份；至少一份经验证的加密副本位于另一设备/受控位置，密钥独立保管。密钥丢失无法恢复；key和备份一起丢失也不是异地备份。未安排定时任务时，RPO只是计划，不能填已达成。

容量先估`数据库实际恢复体积＋私有对象总字节`，另给备份、私有staging、恢复库留足空间，建议≥3倍总体数据＋数据库索引/临时空间余量；pg_dump压缩大小不代表数据库恢复体积。备份读取消耗Storage出口/本地磁盘，按实际套餐检查余额/费率，不默认升级或承诺免费无限容量。旧备份删除由操作员在新备份验证/外部副本确认后按留存表执行；未添加自动删备份程序。

## 5. 创建和核对加密备份

维护只在可信本机执行。PostgreSQL客户端使用本机已安装版本（当前18），需≥源服务器major，并用兼容版本恢复；不用Docker。确保有严格TLS CA文件，源数据库URL保存在ignored私有文件。操作变量见`.env.example`的注释；不要把管理员URL、备份key或维护身份导入网页的Vercel配置。

1. 在ignored`tmp/maintenance-keys/`为`PM_BACKUP_KEY_FILE`选择全新`.backup-key`路径，`npm run ops:backup -- keygen`只写文件、不打印key、不覆盖。将密钥安全保管到独立密码库，CLI不负责上传密钥。
2. 设置`PM_POSTGRES_BIN`、`DATABASE_CA_FILE`、`PM_BACKUP_DATABASE_URL_FILE`，保留真实Storage服务端环境。`npm run ops:backup -- create`生成`tmp/backups/<setId>/`；只输出setId、计数/字节和快照时间，无敏感正文或路径。
3. 只有有`manifest.pmb`的集合才是候选完整备份。原云端受限直连/文件读取条件未闭合时，创建应失败，不能以空备份代替。失败残集保持私有，解决条件后新建集合重试，不覆盖原集。
4. 设`PM_BACKUP_SET`，准备下节目标文件后运行`npm run ops:backup -- inspect`。默认逐项认证/大小/hash检查，删除临时明文，数据库不写入，也不发布恢复文件。通过后复制加密备份到另一受控位置并核对副本，再记录保留期限。

本轮没有备份真实工程资料或云端所有数据。当前真实数据库连接存在已知DNS欠项，不重复盲目排查；工具与本地恢复先交付，云端创建/恢复保持待验证。

## 6. 全新隔离位置恢复

自动恢复仅允许127.0.0.1:55448、`postgres`操作身份、`pm_restore_<12位hex>`数据库名，且数据库注释必须为`partmeasure:disposable-restore:v1`、没有应用表。它不会DROP/clean现有表，也不会覆盖原测试库或云库。目标数据库/连接文件由受控操作员在独立本地集群准备，不更改应用DATABASE_URL；运行者已具备必要全局角色时才能恢复ACL/RLS。角色密码不在dump中，来源配置另取密码库。

`PM_RESTORE_DATABASE_URL_FILE`保存目标连接（不传命令行密码）。先`inspect`，需要实际演练时才`npm run ops:backup -- restore --apply`。流程为：

1. 在全新私有staging认证整个manifest和每个数据库/对象/迁移文件；任何错误先停止，无数据库写入。
2. 核对空库/隔离标记，用pg_restore单事务恢复schema与数据；不是对现有库覆盖。
3. 在UTC会话逐表重算全部pm记录的行数与SHA-256指纹，核对备份快照；缺表/多表/改值不能放行。
4. 使所有旧分享失效、所有Guest会话到期；中断预留标为需新上传。保留原行和历史，不直接释放未证实已清理的额度。旧备份不会重新开放已撤销链接。
5. 对象按原始安全键恢复到新的私有文件目录，迁移来源恢复到`migrations/`，最后才生成`verified.json`。没有此标记的集合不能切换应用或算恢复通过。
6. 核对文件hash/引用、固定标注修订与回复、旧/新交付附件及Guest/两Owner可见性；确认源项目未被改动。数据库恢复和文件恢复必须作为同一集合核对。

此工具交付的是本地数据库＋私有文件恢复，不会自动把字节上传到Supabase、创建Auth服务或切换网页到新库。真正灾难恢复到新的云环境仍需获准恢复位置、套餐/容量、兼容PG/Auth/Storage系统schema、角色/配置/密钥和文件上传的具体方案，再补真实普通角色/下载/重新登录验证。不能将本地fixture的Auth schema部署云端，也不要把数据库dump直接覆盖托管系统表。

数据库完整dump已带schema，不应在它上面再把所有migration重跑一遍；schema重建验证应在另一空库按正式顺序回放。本轮临时原生演练先在源空库回放全部正式迁移，再从dump恢复到另一全新数据库，验证两条路径。云端控制面的完整冷恢复仍待真实证据。

## 7. 应用更新、回退与发布前收口

更新前固定提交/未提交源码清单、锁文件、环境与已应用迁移，对照备份快照时间。开发检查完成不等于部署；旧Preview/buildId不能绑定为新的候选证据。迁移仅在获授权隔离项目应用正式文件，已应用文件不回写，不整份执行draft。

应用回退优先切回与当前schema/文件用途兼容的代码；保留新增表、不可变版本、固定修订和已发生的客户回复，不通过DROP历史/撤销发布回退数据。新格式/用途不兼容时先停相关写入并修正，不能运行旧Worker混写。数据恢复另走受控备份和新位置验证，不与应用代码回退混为一次操作。

在P3-05正式固定候选前，建议只收口有依据的事项：前端集中试导航/草稿/弹框/手机键盘和轻量动效；后端补真实权限/传输/导出/清理与恢复；确认OTP、手机大陆网络、密码保护告警及运行配置。已有实现复用，不重新整体设计界面或建设新运维平台。P3-05准备与生产发布仍是两个授权停点，未授权不部署。
