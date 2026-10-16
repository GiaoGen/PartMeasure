# 文件处理、迁移与运行边界

业务格式上限：JPEG/PNG/WebP 20MiB、40MP；PDF50MiB；STEP/STP/SLDPRT/SLDASM/STL/DXF/DWG/ZIP100MiB。拒绝HEIC/SVG/GIF/视频/任意可执行扩展。**本 Free 测试环境的实际单文件上限取业务上限与存储全局上限的较小值，默认50MiB**；API返回有效策略，UI提前提示，worker输出也受其限制。100MiB上限配置不能使Free供应商限制消失，未升级套餐/未作100MiB真实上传，不能标通过。本轮不采购新资源。

1. 服务端验会话/项目/动作 → 锁Owner总额度、项目、分享 → 校验文件名/声明大小/MIME、预留预算及固定路径。SHA-256 防重复与幂等记录不信任为内容证明；worker仍重算。上传者不能自选 bucket/key/owner/状态，不准覆盖。
2. 单独签发固定 quarantine 路径。≤6MiB用带进度XHR，>6MiB动态加载tus-js-client、6MiB chunk，签名放x-signature，不依赖Guest JWT；不把TUS地址存localStorage。自动网络重试使用同一TUS作业，逐项失败/重试不重传已成功文件。UI传输100%仅表示传输，完成接口重新核权并入队返回202。
3. worker用SKIP LOCKED和5分钟租约领取，单进程逐作业，外部下载/扫描/解码不持业务锁。下载到随机临时目录流式计数/hash，超过声明大小立即断流，必须与原申报字节及hash一致。文件名不作本地或Storage路径。
4. 扩展+MIME+真实magic/有限结构核对：图片安全解码；PDF头；STEP/DXF文本头、二进制STL三角记录长度、DWG版本头、SolidWorks复合文档容器签名。CAD不执行、不解析几何；有限识别不能证明CAD语义正确或没有所有未知漏洞。附件只强制下载，不嵌入可执行内容。ZIP有限central directory检查，拒绝加密/多卷/ZIP64/非store-deflate/路径穿越/可执行文件、超过1000项/200MiB或100倍展开；不自动解压资料。真实CAD/复杂ZIP兼容仍需客户样本，不用自制头文件冒充全格式兼容。
5. 所有类型都经独立ClamAV INSTREAM扫描；超时60s、失败/限制触发/发现病毒均不ready。clamd只监听127.0.0.1；容器扫描打开，但禁止应用自动解包。配置样例在scripts/p0-1/clamd.example.conf；MaxScanSize200M、MaxFileSize100M、MaxFiles1000、MaxRecursion10、AlertEncrypted/AlertExceedsMax，签名更新需freshclam独立维护。扫描无已知威胁不是绝对安全保证。
6. 图片由单独Node子进程Sharp处理，40MP、单页、严格解码、autoOrient一次、sRGB、lossless WebP、移除EXIF/GPS，原件另留私有。记录标准图W/H/hash/normalization_version=1，未更改坐标语义；不实现标注。30s可终止子进程、JS heap512MiB、100ms RSS1GiB退出探针、Sharp cache16MiB/并发1。这是本地运行限制，RSS探针不等于操作系统硬内存隔离；正式托管还须OS/VM配额和大图压力实测。输出80MiB及当前存储限制取小。
7. 原件与标准图用新不可覆盖路径写入private，重试只能在hash一致时重用已存在对象。事务再次锁owner/project/share/reservation/job并核真实Guest会话与链接，确认租约，才创建ready资产、结算额度、审计和作业done。撤销/过期/输入不符不能发布，派生物留待补偿清理。Storage和SQL不假装同一事务。

## 清理与恢复

每15分钟扫描到期预留与作业，清理租约/次数/dead-letter落库。固定上传签名可持续2h；其临近到期仍可创建最长24h的TUS URL。未观测实际TUS创建时间时保守持有到**最后一次发grant后27h**（2h+24h+1h），比原25h建议更安全，不提前释放预算。grant只在最初15min交互窗口内签发；已上传对象重试不再覆盖，重新核权后可complete。

过期时在短事务内claim并阻止后续发布；没有有效处理租约才删除quarantine及尚未发布的private派生路径。Storage API删除后list确认对象不存在，再锁额度/项目结算cleaned。删除失败保留全额预留、退避重试，第5次dead-letter。ready对象只清理过期quarantine副本，永不因“当前列表没有”清除私有source/canonical；软删除只隐藏并继续占额度，不物理删。应用先提交reservation才允许任何上传，因此本应用失败产生的孤儿均可按reservation追踪；手工/外部服务用secret写入的未知前缀须另行对账，不能盲删。TUS内部chunk回收由供应商负责；本地不能把删除Storage对象宣称为已清除所有供应商内部临时块。

短暂依赖故障可通过重新处理接口唤醒job；永久拒绝需新预留/重新选择文件。扫描缺失/超时保留隔离，不开放Guest，UI明确处理错误。worker异常日志只输出白名单码；管理员查询dead-letter数量、最老作业和签名更新时间，不输出payload/链接。生产守护、告警、签名更新和OS资源隔离尚未部署，不在本任务擅自采购或上线。

## Migration 事实与无Docker回放

正式SQL全部由固定supabase CLI migration new产生，MCP apply_migration只指向ref rvysclscetfqicpnzlra。CLI有写自身telemetry缓存需求，普通沙箱EPERM后在授权正常本地环境成功；未运行Docker/本地Supabase reset/diff/pull。文件名对齐list_migrations返回的云端实际version；原始草案及本机auth/storage替身从未部署。

`.gitattributes` 对 SQL 固定 LF，避免 Windows checkout 改换行符而造成 migration 内容/hash 比对假差异；不改写已应用 SQL。

数据库密码不进SQL；正式migration只建立无密码runtime/worker角色，随后一次性本地provision设置随机密码。当前密钥仅ignored本地文件/环境。正式回滚以兼容应用构建和前向补偿migration为主，不修改已应用文件、不reset或repair掩盖差异。没有第二隔离项目从零回放与数据库+Storage灾备演练，不能将本次现有测试库向前应用成功冒称全新环境/生产恢复通过。旧空marker属于历史本地工程基线，未假装与云实验migration相同。

阶段不包含annotation/issue/response/delivery表或业务；P0-2～4必须新增阶段migration，并以真正的引用关系强化history_protected，不可仅依赖UI。生产要另行项目、凭据、备份与发布授权。
