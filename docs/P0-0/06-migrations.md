# 无Docker验证、migration管理与回滚

更新2026-10-16。当前用户明确要求全程不用Docker：本轮未运行任何Docker命令，也不以安装/启动Docker作为进入下一阶段的条件。

## 两条严格分开的SQL链

| 路径 | 作用 | 当前状态 |
|---|---|---|
| `supabase/migrations/20261016085629_infrastructure_baseline.sql` | CLI生成的应用空history marker | 无业务DDL，未部署到云实验项目 |
| `supabase/drafts/baseline.sql` | 待审查业务架构草案 | 未批准、未应用；不能自动提升为migration |
| `experiments/cloud/setup.sql` | 独立真实服务实验表/桶/策略 | 经本轮明确授权，仅在新建实验项目由MCP应用 |
| `tests/sql/draft-smoke.sql` | 原生本机PG的结构替身检查 | a9bdc83已有证据；本轮未重跑；**永不部署到真实Supabase** |

实验项目ref `rvysclscetfqicpnzlra`，名称`partmeasure-p0-0-lab`，真实PG17.11；表名前缀`p0_lab_`、桶`p0-0-service-lab`。仅用于测试，可在后续P0继续复用，非阶段结束自动销毁。实验migration `20261016093639 / p0_0_isolated_service_lab`只属于此云实验库，不混入应用migration目录。源SQL与实际云对象需按名称、字段、约束、RLS逐项核对，不能把它当业务migration回放通过。

`supabase/config.toml`保留CLI生成的本地配置（PG17、auto_expose_new_tables=false、public、max_rows100），不包含远程project ref或密钥；本轮不使用它启动任何本地Supabase容器。

## 当前可运行的无Docker流程

1. MCP `list_organizations`后让用户指定组织，读取组织方案及`get_cost`报价；$0可按已授权任务创建，非零费用遵守工具成本确认，不选择既有production。
2. `create_project`新建隔离项目，`get_project`核对ref/区域/PG版本；先`list_tables`确认无业务资料，再做只读版本/schema检查。保存脱敏实验清单。
3. 只有已经获准的**实验SQL**才能调用MCP `apply_migration`；DML/只读检查用`execute_sql`。使用真实auth/storage schema，绝不执行替身setup或原业务草案。实验脚本还校验ref白名单。
4. 真正客户端验证通过SDK/HTTP，以真实Auth用户JWT访问Data API/Storage；不能用MCP的高权限SELECT或SET ROLE模拟通过Auth、RLS及文件权限验收。MCP查bucket.public=false只证明配置，不证明私有上传/下载闭环。
5. `get_advisors(security/performance)`审查并保留实际warning；目前SMTP/模板配置被Free限制，用户决定暂缓，所以完整A/B/Storage实验未运行，详见09。

## 业务方案批准后的migration流程（未执行）

固定`supabase@2.121.0`，只使用已核对帮助的命令。`migration new`创建本地空文件本身不需要Docker：

```powershell
npm run db -- migration new --help
npm run db:migration:new -- <approved_name>
```

在CLI生成的文件中写入**获批且按P0阶段拆分**的SQL，记录SHA-256、审批人/时间、目标测试ref，再经MCP在明确授权的隔离云环境应用。工具返回的云migration version可能不同于本地创建时间；以`list_migrations`返回的实际版本为准，保留映射并将这份尚未发布的本地文件对齐该实际版本，不能凭空编时间戳，也不能后续同时使用不匹配的CLI push。检查migration history中的name/statements与审查源一致；如果不一致则停止，不能随意repair掩盖差异。

验证包括：空隔离云库从零回放、上一版测试库向前升级、显式GRANT/RLS、A/B与Guest拒绝用例、并发/幂等、真实Storage和补偿；全部通过后再审查用于正式环境的发布计划。空库回放可按需在同一Free额度允许且用户授权的第二测试项目做，不以已存在实验数据的库“执行成功”冒充全量回放；新增项目仍先核价。当前没有创建第二项目。

本轮路线不使用可能调用容器的`supabase start / db start / db reset / db diff / db pull / db dump`。也不执行remote reset、生产push或迁移history repair。未来必须使用CLI某一命令时先检查固定版本help及是否依赖Docker；原生Postgres工具/MCP能完成的工作优先采用无Docker途径。

## 备份、回滚及对象清理

Free项目不假定具备PITR或可用自动备份。需要备份时，可用与服务端兼容的原生`pg_dump/pg_restore`配受控连接，凭据只在本地受保护配置/部署环境；密钥不写命令行、SQL或日志。MCP可核对schema/history，但不是数据库与Storage的完整备份工具。对象须另用Storage API按清单/hash保存并验证，数据库备份不包含对象字节。

应用回滚优先上一兼容构建；数据库默认新增补偿migration/forward-fix。已应用migration不可修改内容；破坏性DOWN只有证明无新数据/依赖、完成备份并获明确批准后才执行。采用expand→backfill→切换→contract，不一次删除旧列。发布交付不能原路径覆盖，误交付用新版本纠正。

实验结束后的`experiments/cloud/teardown.sql`只处理本实验表/桶/策略：先Storage API确认并删除实验对象，再移除元数据。当前没有执行，资源保留供后续测试。不要DROP整个public/auth/storage schema，不把清理脚本指向生产。恢复演练在隔离环境同时核对DB引用与对象hash。

## 原有本机SQL检查的准确含义

`scripts/check-sql-draft.ps1`使用原生PostgreSQL临时cluster，不依赖Docker；原有20项结果只证明草案语法/关系/部分RLS与历史保护。其自建auth.uid/storage.buckets是**本机替身**，不支持真实OTP或Storage HTTP。该脚本保留作离线结构诊断，但不是本轮云实验的setup，也不是业务验收证据。
