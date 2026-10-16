# migration管理与回滚

## 本次已建立

固定`supabase@2.121.0`，已读其CLI帮助后执行`supabase init`与`migration new infrastructure_baseline`。CLI生成`supabase/migrations/20261016085629_infrastructure_baseline.sql`，仅注释标记，不改变业务schema。`supabase/config.toml`是本地开发配置（PG17占位，接入真实项目前比对实际major），关闭自动暴露表/seed，Data API仅public、max_rows100；不含远程project ref或凭据。`supabase/drafts/baseline.sql`不被reset/push读取。

P0-0无Docker daemon可用，因此没有运行Supabase本地全栈或迁移history回放；不得把本机PG18结构检查当作Supabase PG17/RLS/Storage/Auth集成测试通过。具体结果见07。

## 审批后流程（此处是运行说明，不是已执行结果）

每条命令先读固定CLI的`--help`，使用`npm run db -- ...`，不全局安装、不用临时latest。例：

```powershell
npm run db -- start --help
npm run db -- start
npm run db -- db query --help
npm run db -- db query --local --file <approved-local-draft.sql>
npm run db -- db advisors --local --type all --fail-on error
npm run db -- db lint --local --fail-on error
npm run db -- db diff --help
npm run db -- db diff --local
npm run db -- db pull --help
npm run db -- db pull <reviewed_name> --local --yes
```

只在一次性本地栈迭代（db query不写migration history）；审查干净diff后用`db pull --local`生成migration并核对结果，不手造时间戳、不用apply_migration工具堆本地历史。若从零写一份空migration，先用`npm run db:migration:new -- <reviewed_name>`；不能对同一差异同时new和pull生成两份重复migration。当前CLI已实际确认支持`db pull --local`，该命令可能写入被选库的migration history，必须显式local，不省略目标参数。schema首次实施按P0-1/2/3/4拆migration，不一次偷跑全部后续业务。

```powershell
# 仅一次性本地测试数据；reset会丢弃该本地库内容
npm run db -- db reset --local --no-seed
npm run db -- migration list --local
npm run db -- db lint --local --fail-on error
npm run db -- db advisors --local --type all --fail-on error
```

空库全量回放 + 从前版本升级 + 集成负面测试全部完成后提交schema、migration、测试证据和代码一起审阅。迁移文件应用后不可修改内容/时间戳；修复新增migration。SQL与应用分expand→backfill→切读写→contract，避免旧代码在部署中读不到列。手工改Dashboard造成漂移时先diff核对并纳入新migration，不用repair掩盖漏项。

## 远程与回滚关卡

本次**没有**login/link/db push/db reset --linked/deploy等远程操作。后续先确认测试项目引用、区域、PG版本、Data API自动授权状态、私有bucket已有策略及备份；配置独立开发/预发/生产凭据。服务端secret进部署环境，绝不写进SQL/README/日志。需要远程SQL或部署时依用户授权范围执行。

远程发布先导出schema/dump与对象清单/hash、验证PITR/对象备份、在预发回放并做A/B Owner与Guest授权测试；`db push --dry-run`（先查help）只供审查，不代表批准。将实际批准人/时间、migration哈希、目标project ref的非敏感标记记入发布记录。

应用回滚优先还原上一兼容构建；DB默认forward-fix，避免DOWN删除历史。若必须撤销schema，先证明没有新数据/依赖并用新补偿migration；生产不使用db reset。误发布交付也只能新版本修正，不能恢复旧文件路径覆盖内容。灾难恢复需同时恢复DB与Storage同一快照/清单，再校验文件引用和hash；单独数据库备份不包含Storage对象。所有恢复演练在隔离环境执行。

## 草案的本机结构检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-sql-draft.ps1
```

需要本机PostgreSQL18，可用`-PostgresBin`指定安装bin。脚本只在workspace/tmp创建唯一新cluster，绑定127.0.0.1:55439，短暂trust本地连接，finally停止；不接入已有集群、不删除目录。测试用自建auth.uid/storage.buckets **stub**，只能证明SQL语法/约束/部分Owner RLS与历史保护，不证明真实OTP、share验证、Storage HTTP授权/撤销、TUS、quota或业务事务。日志在ignored tmp。若端口被占用即失败，不能停止不属于本次测试的服务。
