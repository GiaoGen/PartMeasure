# 手机端前端轻量优化 · 2026-10-31

状态：已按审查示例实现、验证并完成一次受控Production更新。首次V1发布及其验收记录保持原有版本含义。

## 实现内容

- 「资料与补测」「交付与版本」使用无外框页签，以主题色文字和底线表示当前项，保留键盘焦点提示。
- 手机顶部精简为标志、项目名、分享及更多；设置、说明、外观收到更多菜单。长项目名省略显示，说明面板可查看完整项目名。桌面保留直接操作。
- 手机将类型、排序收入原位展开的筛选区，并显示当前条件摘要；PDF／ZIP收到导出菜单。桌面保留直接筛选和两项导出。
- 使用主题蓝区分辅助操作；待补充红、待补测黄、已补充绿继续保持业务含义，兼容浅色／深色／跟随系统。
- 标题旁保留唯一上传入口，取消本工作台右下角重复入口；同一上传队列通过前端 portal 提供手机拍照／文件／相册菜单，桌面打开原文件选择器。原归档、上传校验及队列逻辑保留。
- 待办弹窗桌面采用独立滚动的左侧资料列表和右侧当前事项。宽屏右侧图片、填写信息并排；较窄时图片在填写信息上方。资料分组、组内标注横滑保留。
- 手机在同一弹窗中切换列表和详情，隐藏其他资料分组；返回列表保留已挂载表单，点回同事项继续填写。切换不同事项沿用原未提交确认；关闭重开保留输入。图片可以收起，列表／详情之间管理焦点。
- 详情滚动区复用既有可见视口处理；图片随可见高度缩小，输入框可滚动到可见区域。手机详情保留读取失败提示与重试。
- 正常实时连接不再占一行；原同步、异常重连提示、失权处理保留。

仅修改 `src/components/` 下八个前端文件；无后端／API／权限／迁移／依赖／配置修改。未登录、发信、上传真实资料、创建分享、清理或部署。

## 验证

| 检查 | 结果 |
| --- | --- |
| 改动的八个文件定向 Biome lint（含两份 CSS） | PASS，无 warning |
| `npm run typecheck` | PASS |
| `npm test` | PASS，82 个文件、488 项 |
| `npm run build` | PASS，最终源码编译和 TypeScript 检查通过 |
| 本地实际组件浏览器检查 | PASS，七组 |
| `git diff --check` | PASS |
| `npm run lint` 全仓入口 | 未通过：既有 `output/fix-c/3acb7520-5d8e-4c9e-9a10-e8450c5798bf` 目录读取被拒绝；未改权限或清理目录 |

七组组件检查覆盖：无框页签／唯一上传／静默正常连接，手机菜单和主题与筛选摘要，三种上传入口，12 份资料的桌面分栏，Guest 详情返回及关闭重开／取消切换后保留未提交数值，320px 窄屏和缩小可见高度后的输入框定位，断线提示及恢复后隐藏。

浏览器检查仅使用真实前端组件、本地合成资料、Next 导航／Link／Image 外壳替身及拦截的 GET；写请求、未匹配请求和页面运行错误均为 0。没有启动应用服务或连接云端。未运行依赖真实环境的整套 `test:e2e`。

这些结果不代表真机软键盘、浏览器差异或生产部署后的效果已验收；本轮没有重做此前已通过的手机几何工具、导出、权限与恢复验收。

## 效果与记录

- [手机资料页（浅色）](evidence/frontend-mobile-2026-10-31/mobile-page-light.png)
- [手机待办详情（深色）](evidence/frontend-mobile-2026-10-31/mobile-inbox-dark.png)
- [桌面待办分栏（深色）](evidence/frontend-mobile-2026-10-31/desktop-inbox-dark.png)
- [组件检查及源码 SHA-256](evidence/frontend-mobile-2026-10-31/checks.json)

截图全部为本地合成资料，来自实现后的真实组件。独立检查夹具及执行脚本位于本机忽略目录 `tmp/frontend-mobile/`。

## 正式发布

用户明确批准一次「Production暂存 → 检查 → 同构建promote」，并完成CLI设备登录。使用已存在正式项目 `prj_Tk3LzDCt2iLIfObnwVyPajjbiX61`，没有第二个新部署或新项目。

- 入口：https://partmeasure-production.vercel.app；当前部署 `dpl_Eu58HPg6gsWrmhmXp9MAnhxqq1nB`，READY；commit `9fd5d2e1a7c530f0c2f3e9a65008a21069e3c543`。
- 220个发布输入仅8个已审查前端文件相对原正式版本改变；预演全部路径与SHA-1／SHA-256一致，没有私有文件。源码目录458文件lint补查PASS，旧输出目录权限未修改。
- 构建实际220个输入逐项核对，只有Vercel生成的vercel.json补入项目名／version 2并规范化；全量重建摘要精确匹配，health为 `p3-05-797831db2ba98941f509`。
- 暂存使用 `--prod --skip-domain`，READY后检查home/login/health200、projects401/AUTH_REQUIRED及5个CSS／JS资源；随后提升同一个部署，正式alias完成映射。
- 正式入口经无绕过凭据的匿名GET再次确认页面、版本、权限、安全头、原生POST与无feedback脚本。15分钟内所选入口运行错误聚合无记录，不保证全量日志或持续监控。
- 10个Production环境变量的ID／key／target／type／更新时间与发布前一致；没有数据库、后端、依赖、环境变量或业务数据修改。CLI受保护访问自动生成项目访问绕过凭据，未禁用部署保护；凭据不进入源码与证据。
- 回退点：原正式部署 `dpl_8ibkHBdHhn1QzePSXUPiZbUozPsM` 保留；本轮未执行回退。真机软键盘体验仍未由本轮自动检查证明。

记录：[范围](evidence/frontend-mobile-2026-10-31/release-scope.json)、[上传预演](evidence/frontend-mobile-2026-10-31/deploy-preflight.json)、[完整来源](evidence/frontend-mobile-2026-10-31/hosted-provenance.json)、[候选检查](evidence/frontend-mobile-2026-10-31/candidate-smoke.json)、[正式匿名检查](evidence/frontend-mobile-2026-10-31/public-smoke.json)、[发布回执](evidence/frontend-mobile-2026-10-31/publication-result.json)。
