# 图像契约与早期验证计划 · 契约待审批，实验结果见10

2026-10-20 补充授权：缺尺寸标注自动待补，客户原位补充；前台不再单独发布提醒。底层 annotation 与 issue/response/review 仍分离，快照及归一化坐标不变。见 [标注协作实施](../annotation-collaboration.md)。下文「annotation 存在不代表待测」仍适用于已填写尺寸、文字/位置说明等情形。

2026-10-16收尾更新：用户已授权独立Konva/EXIF实验；合成方向样本与浏览器36项检查实际通过，详见[实验结果](10-konva-experiment.md)。下文原试验矩阵中的真机/大图/性能等未测项仍保留，不把部分检查扩大为全部通过。Sharp仅作为隔离实验dev依赖，不是业务worker。

用户决定中国大陆手机网络实测延到UI可操作后、P0最终验收前完成，**当前不作为P0-0阻断项**。仅记录用户确认数据库可访问，未据此宣布Auth、Storage或整站通过。

## EXIF 与资产生命周期

标准化发生在 `validating → ready` 前。保存上传原件（私有、不可覆盖、SHA-256）；安全解码时**恰好应用一次** EXIF orientation 1–8（含镜像），生成方向固定、无旋转/位置EXIF的标准图，记录 `canonical_width/height`、`normalization_version=1`、canonical hash/path、原件hash/path。缩略图从标准图生成，尺寸不作为持久化坐标基准。GPS/相机元数据不暴露到常规预览；原件下载可能含EXIF，提案默认Guest下载标准图、Owner原件入口明确说明，需批准。

浏览器解码的自动旋转、image-orientation 与服务端重复旋转必须用带方向样本验证；不要凭文件raw宽高直接上Canvas。未完成归一化前不准建annotation。HEIC首轮拒绝，提示相机选择兼容JPG；要支持HEIC须先验证解码依赖/许可/内存，不能悄悄把它当JPEG。

初始基线只定义处理契约；本轮已查官方文档并显式锁定Sharp0.35.5用于独立技术实验，不实现上传worker。正式worker采用何库/原生平台/内存预算仍须审查和实测。原件重编码/标准化算法变化要新建派生版本，已有annotation仍绑定旧标准图；不得用新尺寸替换历史图使坐标漂移。

## 坐标与几何

标准图宽W、高H，连续图像边界坐标原点左上 `(0,0)`，右下 `(W,H)`，向右x向下y；归一化 `u=x/W, v=y/H`，finite且[0,1]。这是相对**统一方向原始分辨率**的坐标，不是缩略图/视口/屏幕像素或设备DPI。几何version与file.canonical hash共同定义语义。

显示变换：`screen = T_pan × R_view × S_zoom × S_fit × (uW,vH)`；pointer先通过完整逆矩阵再除W/H。DPR仅影响Canvas采样缓冲，不乘进持久化坐标。视口旋转只改变view matrix；不能再次改原图语义；裁切视口只改变clip。拖拽只更新临时state，保存前clamp策略应为“越界报错/限制拖动”，不能无声改传入的非法坐标。

- 线：两个不同点（像素尺度检查零长度）。点/文字：锚点；文字长度受限。
- 圆：center(u,v)，`radiusX=r/W`、`radiusY=r/H`，正且边界在[0,1]；要求 `abs(radiusX*W-radiusY*H)≤0.5px`。非正方图中不能简单用同一个归一化radius，否则圆变椭圆。将来椭圆/角度/弧是新schema版本，P0不提前做。
- metadata工程字段：名称、人工尺寸/单位、孔深、孔类型、螺纹规格、备注，按type显示；其中尺寸必须带human来源，不能计算像素→mm。annotation本身可以尚无尺寸，实际最终确认值属于confirmation。
- 持久化保留双精度，不按屏幕四舍五入；显示格式与存储分开；不同设备往返误差≤0.5标准图像素作为试验门槛。

## annotation 与请求分离

`Annotation` 描述某张标准图上的几何及人工工程备注；`annotation_revisions` 留编辑历史。`Issue(kind=measurement)` 描述要获得的信息、测法、状态，固定引用某个正式annotation revision；一个annotation可有多个请求，annotation存在不代表有待测任务。`Issue(kind=comment)` 可只关联PDF/CAD文件，无geometry；项目上传说明放project.description。算法候选仅会话内存，不直接落annotation表；人工确认后才成为正式annotation（P1以后）。

回复与最终确认均独立追加，不写回geometry，不把客户数值直接当工程师已确认。客户只读Canvas，没有drag handlers。跨照片无共用“物理孔”ID；只能工程师文字解释。

## React Konva 早期 Spike（原验证矩阵，已执行子集见10）

独立技术实验已获本轮明确授权，不混入产品路由/正式UI、不借Spike实施P0-2编辑器。React19.3/Konva10/react-konva19.3组合在独立Next生产构建和Chromium中已验证；其他浏览器/真实手机及大图性能尚未验证。

| 样本/动作 | 记录与建议通过门槛 |
|---|---|
| EXIF 1–8，包括镜像，至少16张带角点参考的真实/合成固定样本 | 标准图尺寸/方向/hash；仅旋转一次，方向不一致为阻断 |
| 4000×3000及40MP上限图，横竖屏；线/圆/点 | 页面缩放、DPR1/2/3、resize、fit、pan、zoom后落点误差≤0.5原图px |
| Next App Router客户端Canvas，服务端不渲染Konva节点 | production build无window/canvas原生依赖错误；需动态加载时在Client边界ssr:false |
| React StrictMode双mount、Konva自身strict/non-strict对比 | 无重复监听/双提交，拖拽state为唯一真值；stage销毁释放bitmap |
| 拖拽、滚轮、双指pinch、手机只读 | 桌面目标≥45fps，长任务/峰值内存记录；手机无页面滚动冲突，不意外编辑 |
| serialize→刷新→deserialize、切换原图/缩略图 | revision一致、位置不漂移、图片加载失败可重试 |
| 禁用网络/算法、图片CORS/tainted canvas | 手工路径独立；导出受CORS影响记为P2风险，不伪通过 |

设备：Win Chrome/Edge当前稳定版；iOS Safari16.4+及当前版；真实Android Chrome与微信内置浏览器。Viewport仿真只覆盖布局，不能代表iOS Canvas或手机性能。记录设备/OS/浏览器版本、FPS/内存/耗时、截图录屏与失败重现步骤；失败先做最大纹理/降采样显示评估（坐标仍绑定标准原图），重大调整再审。

## 中国大陆手机网络 Spike（用户决定延期，非当前P0-0阻断）

在确定生产部署前，优先用**明确授权的测试环境**测直达基础页/Storage，再在P0-1具备真实Auth/上传后测登录与上传，P0-4补完整闭环。台湾开发机、VPN出口、Lighthouse、Playwright限速都不能替代。

建议2个大陆城市×移动/联通/电信至少各1张实体SIM，共≥6组合；Android Chrome/微信和iPhone Safari/微信至少各1台；Wi-Fi作对照。关闭VPN/代理，登记真实位置、运营商、4G/5G、时间段、设备/浏览器/系统、域名/区域、DNS/TLS错误。早晚高峰各10次主流程，不只一次测速。需要用户/测试人员提供这些条件；现在没有，状态待验证。

测试素材经授权：10张3–8MiB照片批量、一张20MiB边界照片、50MiB PDF、100MiB CAD、非法类型、超额；真实OTP邮箱（SMTP投递时间单独记录）。测试：冷/热分享页加载，空项目批量上传，现有待测任务进入，数值/仅照片/无法测量/重测，私有下载，撤销旧链接，断网30秒恢复、后台/锁屏2分钟、切换Wi-Fi与蜂窝、凭证超时续传、重复点击/重放、旧签名撤销窗口。测试数据隔离，分享token/测量照片不进入公开报告。

建议预设门槛（不是PRD既定SLA，待审批）：分享页冷载p95≤5s（不含用户等待）；10照片上传成功率≥95%，重试后最终完成≥99%；回复提交p95≤3s；20MiB下载≥95%成功；OTP投递p95≤60s（另记供应商延迟）；撤销后新业务请求100%拒绝、残留签名窗口符合文档。每格记录成功数/总数、p50/p95、DNS/TLS/首字节/传输拆分，不对小样本99%做统计保证。

失败则停止部署选型冻结：提交根因（域名解析/跨境TLS/传输/SMTP/限流）、候选国内托管/对象存储的同样本比较、权限/迁移/成本/合规影响，由用户批准后调整。不绕过私有Storage或关闭RLS换取网络成功。当前无Vercel/Supabase测试资源与大陆SIM，**没有任何大陆网络通过结论**。
