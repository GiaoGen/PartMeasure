# 审查区：不自动执行

`baseline.sql` 是 P0-0 架构/权限 SQL 草案，不在 `supabase/migrations/` 自动执行链中。包含完整关系骨架、约束、索引、只读Owner RLS、默认拒绝Storage与不可变历史保护。没有部署或业务写入RPC，不代表权限验收通过。

批准后按 `docs/P0-0/06-migrations.md` 使用固定CLI `migration new` 提升分期内容，再在一次性本地Supabase测试。不要直接把本目录批量复制到远程。

已知待完善：细粒度JSON geometry及工程metadata数据库校验、完整业务事务/RPC及状态机、quota计量清理worker、私有下载/上传网关、历史revision一致性触发器、托管Storage真实策略测试。安全写入入口上线前必须补齐，不可仅用service_role绕过。
