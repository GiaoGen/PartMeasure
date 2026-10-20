# 安全图片 Worker 托管运行说明（无 Docker）

**2026-10-20 已退役，仅保留历史记录。当前上传在Next.js请求内处理，不再部署本目录unit或启动ClamAV。新说明见[轻量上传实施](../../docs/lightweight-upload.md)。** 下文是旧方案，不是当前操作步骤。

本包仅面向已授权隔离项目 `rvysclscetfqicpnzlra`。当前交付的是 **Linux systemd 部署包**，尚无获授权主机/SSH 环境，未在 Linux 托管环境安装或完成重启、故障及资源耗尽演练。本机 Worker 消费真实云文件的结果不代表已云端常驻。

## 运行结构与前提

- 选择靠近东京 Supabase 的受控 Linux 主机，确认价格、带宽、出口、磁盘和权限后部署；本轮不购买资源。不要把常驻 Worker 放进有执行时限的网页函数。
- 使用精确依赖锁的 Node 24 与 `npm ci`。源码置于 `/opt/partmeasure/current`，以无登录权限的专用 `partmeasure` 用户运行。Node 示例路径 `/usr/bin/node` 必须在主机上核实。
- 按发行版/ClamAV 官方渠道安装 `clamav-daemon`、`freshclam`，先更新病毒库再启动。clamd 仅监听 `127.0.0.1:3310`，不对外开放；配置 INSTREAM 限额至少覆盖当前 50MiB 上传上限。确认数据库目录和 `clamav-daemon.service`/更新服务的实际名称。
- 安装同项目 Server root CA 至 `/etc/partmeasure/supabase-ca.crt`。TLS 证书校验始终开启，不设置 `rejectUnauthorized:false`。
- 依据 [环境变量样例](worker.env.example) 写 `/etc/partmeasure/worker.env`，`root:partmeasure`、权限 `0640`，目录 `0750`。仅放 Worker 受限账号和服务端 Storage key，不放 postgres 管理连接；不复制到网页 Preview。值由受控环境注入，不能出现在工单、日志、命令参数或 Git。
- `WORKER_DATABASE_URL` 为业务 transaction pooler；`WORKER_EVENT_DATABASE_URL` 为支持 LISTEN 的 session pooler **5432**。监听禁止使用 transaction pooler **6543**。网页用独立 runtime 账号的 `EVENT_DATABASE_URL`，两类凭据不能混用。

## 安装及启动步骤（目标主机待执行）

1. 在发布目录执行 `npm ci`；校验迁移已在隔离库应用，不能直接将 `supabase/drafts/` 或本机测试 Auth/Storage 替身部署上去。
2. 更新签名并确认 clamd 已加载最新 daily 库；仅下载成功不够。`freshclam` 配置 `NotifyClamd` 指向实际 clamd 配置，或使用发行版官方更新/重载机制。病毒库文件要允许 Worker 只读，不能赋予 Worker 修改权限。
3. 以专用用户执行 `node --import tsx scripts/worker/supervise.ts --once`。入口检查隔离项目、loopback 扫描器、daily 库真实构建时间（最多 72 小时，拒绝未来时间）和扫描器实际加载版本。失败不启动处理，不允许绕过扫描。
4. 审阅并复制三个 unit 至 `/etc/systemd/system/`：`partmeasure-worker.service`、`partmeasure-cleanup.service`、`partmeasure-cleanup.timer`；执行 `systemctl daemon-reload`，再 `systemctl enable --now partmeasure-worker.service partmeasure-cleanup.timer`。
5. `systemctl status`/`journalctl -u` 只读取脱敏事件，核对 `systemctl list-timers`。Worker 每 60 秒重新检查扫描安全条件；签名过期或版本未加载会终止处理，由 systemd 退避拉起。不会把文件降级为未扫描 ready。

`PM_WORKER_EXTERNAL_CLEANUP=1` 仅用于已启用独立 cleanup timer 的托管安装。否则保留默认 `0`，独立运行仍执行清理。清理每 15 分钟运行，取消/过期上传、失败派生物及 7 天事件保留分别处理；正常文件及业务修订历史不因此删除。

## 资源、安全与恢复

- unit 设 `NoNewPrivileges`、只读系统/家目录、`UMask=0077`、私有临时目录、CPU/内存限制（Worker 2GiB、100% CPU）。图像仍是独立子进程，40MP、30 秒、512MiB JS heap、1GiB RSS 探针及 80MiB 合并派生物预算。
- **unit 的 `PrivateTmp` 不等于磁盘硬配额。** 在主机为服务的 `/tmp` 命名空间配置受限 tmpfs/专用配额文件系统，至少容纳上限文件的下载、标准图及缩略图临时字节，同时预留运行余量。具体 systemd/挂载配置取决于内核及发行版，未验证前不能声明 I-02 已关闭。
- Worker 按 5 分钟租约、每 60 秒续约处理；续约失败会中止后续 Storage I/O，旧租约不能提交资产。不可变路径上传冲突核 hash，不允许覆盖。
- 提交前核验对象、元数据、配额；只有最终事务成功后才 ready 并产生事件。Worker 崩溃后按租约恢复。清理确认远程对象已不存在后才释放预留空间，不通过删除有效历史文件腾空间。
- 新图片优先处理，等待超过 60 秒的任务避免饿死；旧缩略图补建单独排队，先预留两份缩略图空间，保持原标准图 hash 和坐标不变。

## 托管验收与尚缺条件

需要目标主机、受控部署权限及价格确认，当前均未落实；外部告警接收端也未配置。交付 unit 不等于监控告警闭环。

在主机上记录：正常 Guest 上传→扫描→归一化→缩略图→另一端可读；停止/重启 clamd 与 Worker；签名陈旧/更新失败；租约失效；超时、超内存、磁盘不足；清理任务失败与重跑。失败文件必须始终对 Guest 不可读，恢复后不能重复资产或重复计费。建立队列最老等待时间、ready 延迟、dead/cleanup 数量、库新鲜度、依赖错误率、磁盘容量告警，日志只含白名单错误码/聚合计数。

本机可复现入口见 [第 3、4 项报告](../../docs/performance-s34.md)。没有实测不得把托管运行、主机故障恢复或大陆手机网络写 PASS。
