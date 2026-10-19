# 第五项：有边界的缓存

日期：2026-10-19（Asia/Taipei）。用户明确授权统一项目内存缓存、精准事件更新、按内容版本复用图片、退出/切换账号/撤销清理及服务端缓存核权。复用[前两项](performance-s12.md)和[实时/图片管线](performance-s34.md)，不重建业务模块，不扩大到P1/P2或全站UI改造。

## 实施结果与契约

| 层次 | 容量与复用 | 失效、安全边界 |
|---|---|---|
| 项目JSON | 统一 `api` + `QueryCache`；标签页内64项、约2MiB JSON UTF-16预算，按LRU淘汰。默认项目/文件/任务/交付及项目列表复用3秒，已有显式1秒/5秒配置保留，最大5秒。并发同键singleflight，独立在途最多64项；达到上限直接给可重试的忙状态，不额外发出超额读取。 | key含当前会话代次、精确Owner/Guest路径、项目、筛选/分页和显式版本；返回深拷贝。仅保留成功结果，显式 `cacheMs:0` 绕过已保留结果。上传状态与事件游标读取不保留结果。 |
| 事件与写入 | 按项目与资源标签精准失效，再由既有组件读取受影响的权威DTO；保留既有写响应直接应用增量。 | 单条任务更新只失效该任务详情、相关列表/汇总；不清另一个项目、图片字节或交付缓存。已知文件ID时限定到该文件筛选，缺少关联信息时只在本项目对应资源域内扩大。游标reset/权限变化可整项目失效。 |
| 私有图片 | key为受控项目/角色URL+内容hash/版本/规格；最多48项，**已保留编码字节+在途预留合计96MiB**。同版本并发合并，4传输并发、最多48排队，取消的排队项立即移除。闲置60秒主动释放ObjectURL，LRU只淘汰无使用者条目。 | 读取响应体前按已知Content-Length预留，检查实际流长。标准图上限80MiB，缩略图256KiB；缺少长度时按对应上限预留，不无限调用blob()。预算不足给现有重试反馈，不挤掉仍在显示的对象。缓存预算不等于浏览器进程RSS上限，解码bitmap、Konva画布和暂时的Blob组装拷贝另占内存。 |
| 服务端缩略图字节 | 每个Node进程8MiB、64项、60秒；小于等于256KiB且有受控thumb路径/有效SHA256的完整预览可复用。最多16个可合并加载，满时沿用流式路径。 | **每次调用先执行必需授权回调 `service.fileForRead`**，验证当前Owner/Guest、项目、链接、文件可见性和处理状态，再查缓存或加入singleflight。只缓存经长度/hash核验的不可变字节，不缓存身份、权限或签名URL。 |

服务端缓存key含测试项目Storage域、私有桶、项目对象路径、内容hash与大小；thumbnail hash随既有核权查询一并读取，未新增一次数据库往返。不同实例之间不保证命中，不引入Redis、转发层、Service Worker或外部缓存服务。标准图、大附件、原件、Range请求继续受控流式传输，不缓冲进该小图缓存。

所有响应继续 `Cache-Control: private, no-store`，不做公开桶、公共CDN缓存、长期签名、ETag/304授权捷径。冷读仍沿用内部60秒签名并由服务器取图，签名不交客户端；热读省掉该Storage签名/取图往返，Auth/SQL核权继续执行。服务端共享字节不按一个浏览器退出而清空；由TTL/LRU主动到期，下一位请求者仍独立核权。

### 精准更新与并发

- 数据缓存从写入前后“全清空”改为相应项目/资源失效。标注写入影响本项目标注与文件摘要；任务回复/审核影响任务域；交付影响交付及其文件可见性；分享变更影响本项目。服务器仍是事实来源，不从事件提示猜造回复历史或计数。
- 事件触发的失效会阻止旧读取写回；旧读取晚到时，可加入已开始的权威替换读取或至多重读一次。持续冲突后提示重试，不把旧状态悄悄覆盖回去。未知结果的写入不因缓存自动重发，沿用原幂等键、修订冲突及既有CSRF明确拒绝恢复规则。
- 普通metadata/resync不丢掉同内容版本图片；文件隐藏/删除、Guest权限变化只清对应项目/文件的字节和下载。再次查看相同标准图不再把“重试次数”当成图片内容版本，显式重试只丢弃该项。
- 回复历史的证据预览也接入统一图片预算、可见区懒加载和离屏释放，优先使用640缩略图；未补建缩略图的旧证据显示准备状态，保留原有“查看原尺寸证据”受控入口，避免后台拉大图。证据hash/缩略图版本在原附件读取/回复事务的既有SQL中以同项目同标准图hash连接获取，不加网络往返。任务详情缓存按其实际证据文件建立依赖，派生物ready事件只失效关联任务；超过200个唯一依赖则在本项目证据域保守失效，限制标签索引。此处占位与真实手机展示仍待人工试用。
- 缓存不修改标注几何、坐标、DPI/EXIF契约，也不替换工程师未提交表单。浏览器图片缓存命中是复用已经合法收到的字节，不是获得新权限。

### 退出、账号切换、撤销

- 退出/登录切换开始时清本标签页数据、图片和CSRF；会话代次隔离旧请求，取消在途metadata和图片请求，清除等待下载。HTTP401、页面离开和现有SSE权限失效路径同样清理。
- Cookie成功切换后再加一道代次屏障，拒绝“登录途中用旧Cookie发出、切换后才返回”的内容；并再次向同源其他标签发送不含身份/令牌的失效通知。此时仅保留原有效CSRF Cookie对应的凭据，避免无意义地增加一次CSRF请求；服务器明确拒绝时才按原规则恢复。
- Guest打开链接只替换本标签页项目会话，不广播让另一个工程师标签退出。链接撤销由现有服务端逐次核权/SSE拒绝触发清理；事件故障时由既有补偿/下一次拒绝响应清理。离线端已经收到的字节无法远程收回，不作即时召回承诺。
- 浏览器缓存从不替代下载/上传完成/审核等接口核权。server byte-cache的授权回调是函数签名的必需参数，两个下载入口都调用原DAL，热命中也没有绕过通道。

## 实际验证

| 检查 | 结果与证据边界 |
|---|---|
| `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` | 全部PASS。25文件/140项单测（比前轮新增17项）；最终汇总见[checks.json](evidence/performance-s5/checks.json)。 |
| 新增缓存/安全单测 | PASS：按实体精准失效、跨项目/角色保留、迟到读取追平、切换途中旧身份拒绝、metadata传输取消、图片下载预留/预算、排队取消/上限、闲置主动释放、项目失效与迟到图片拒绝、声明长度伪造拒绝、退出清空、热字节命中必需授权、撤销/越权拒绝、坏hash不缓存、Range/标准图不进入小图缓存、服务端TTL/LRU及拷贝隔离。mock只算单元证据。 |
| 原生PG回归 | PASS，9项，复用无Docker一次性本机集群，包含当前派生物RLS、原图比例/不可变、游标与撤销逻辑；[native.json](evidence/performance-s5/native.json)。Auth/Storage替身仅本机，不部署云端、不算真实服务。 |
| 实际客户端模块连接真实服务 | 第一轮5项PASS：[首次记录](evidence/performance-s5/client-1792421703922.json)；[最新记录](evidence/performance-s5/client.json)及时间戳历史保留。使用正常A/B密码，Node Cookie jar只补浏览器传输行为；不是mock或浏览器试用。 |
| 真实服务检查范围 | 并发/默认命中减少HTTP；任务事件保留无关文件缓存；新标记项目的Guest链接撤销后真实读取401，旧客户端缓存不能复用；现有私有小图首次hash验证、热命中响应仍含Auth/SQL计时且不再有Storage签名/取图计时；切换B后A项目及已热缓存小图真实404。现有图片只读，不旋转已有业务分享链接。 |
| 证据元数据只读检查 | 通过正常密码读取现有回复，核对内容hash及可空缩略图字段；实际结果见[evidence-metadata.json](evidence/performance-s5/evidence-metadata.json)。不创建/修改已有测量，不把无缩略图伪装成已处理。 |
| 密钥/源码检查 | 已配置密钥、DB/账号密码、已知分享能力及浏览器静态产物扫描PASS；[secret-audit.json](evidence/performance-s5/secret-audit.json)。差异格式检查PASS；[源码变更清单](evidence/performance-s5/source-changes.json)以此前已审阅源码manifest为参照，不覆盖既有前端混合工作。不是历史/OCR/未知密钥全量审计。 |
| 浏览器/E2E、UI截图/真机、大陆手机网络 | 未运行，遵守当前不自行启动浏览器/E2E约束。缓存不等于已有整个P0/实时渲染或大陆性能验收通过；没有新p95结论。 |

本轮沿用指定隔离Supabase `rvysclscetfqicpnzlra`，**无migration、无远程DDL、无生产操作、无Docker、无系统代理/DNS/TUN修改、无新购买资源**。真实客户端测试仅新建 `PERF-S5-*` 空项目/测试分享并撤销本次链接，保留既有业务资料；读取既有小图只用于核验hash与热命中权限。进程代理变量清理仍不能证明物理大陆直连。

## 运行与复现

常规 `npm run dev` / `npm run build` → `npm start` 继续使用原配置。需要重启已启动的旧生产模式服务才能加载新构建；当前Vercel Preview未在本任务更新，前轮地址不能当成此次缓存代码已部署。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/check-local-s34.ps1
# 本轮真实客户端使用专用3115，另一个终端运行client
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s5.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s5.ps1 client
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/performance/run-s5.ps1 evidence
node scripts/performance/secret-audit.mjs --s5
```

本机原生PG检查要求PostgreSQL18/Git OpenSSL并仅创建localhost55448一次性集群，finally关闭。真实服务检查需原有忽略配置 `.env.local`、正常测试账号文件及只读 `tmp/performance-s5/candidates.json`（含同一隔离库已处理图片的project/file/variant/hash；无签名URL）。没有候选图则明确PENDING，不管理员造资产、不跳过安全处理，不发OTP。

## 交付边界与待验

本项实现及自动结果可审阅；保留原有前端未提交工作，不把混合工作树整批提交/推送。代码主要在 `api.ts`、`query-cache.ts`、`cache-policy.ts`、`image-memory.ts`、`image-transfers.ts`、`private-image-cache.ts` 与 server `file-response.ts`/`thumbnail-cache.ts`；路由/DAL仅按授权回调与派生hash对齐。

待审批：本项无新增业务流程/架构或费用待批。待外部验证：真实浏览器多标签退出/切换/撤销、手机长图库/内存和前后台恢复、真实大陆手机性能。前轮新上传Worker超时与常驻主机缺口仍留在[第3、4项报告](performance-s34.md)，本轮缓存检查PASS不关闭它们，也不宣称整个P0验收通过。

约5分钟人工复核：两端打开同一项目，更新一个任务时观察当前交付/输入不丢失；同图打开、返回再进入应复用当前标签页版本；退出后切换B不出现A资料；撤销专用测试链接后旧Guest不可继续取得内容。长图库滚动应释放离屏预览，旧证据无缩略图时“查看原尺寸证据”可执行。以上仍待真实浏览器/手机验证，本任务未自行启动浏览器。

官方依据：[Supabase私有桶](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[私有下载](https://supabase.com/docs/guides/storage/serving/downloads)，本轮已用官方MCP检索核对；Next Route Handler依据仓库安装包文档。没有依赖升级、公开Storage策略或授权缓存。
