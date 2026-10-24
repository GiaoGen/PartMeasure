# P1-03 独立 CV 真实照片实验

授权日期 2026-10-23。用户在 GitHub 调研后授权继续 P1-03；只做 PRD §7／P1-03 的独立实验。阶段报告见 [P1-03](../../docs/P1-03-cv-experiment-2026-10-23.md)。正式编辑器、数据库和部署均不改。用户明确不应为30张照片扩选100张；本轮另自限30分钟／45候选。实际约17分钟取得并查看36张后结束搜图；不再扩选。工作区原有 `next-env.d.ts` 开发类型路径修改保留。

2026-10-25 用户将评估交给 Codex，并明确降低为轻量辅助实验标准。**P1-03 技术实验已完成**，见[收尾评估](../../docs/P1-03-assessment-2026-10-25.md)。不再要求用户完成试验表；真实用户时间、浏览器／手机未测仍为未验证。未自动进入 P1-04。

## 样本与许可

36 张 MPDD 工业金属零件照片，来自6类，每类预定均匀取6张。原件与方向统一、最长边1024px的实验派生图均在忽略提交的 `tmp/p1-03/`，带来源链接、镜像固定修订、文件SHA256、原始／处理尺寸及许可副本；本轮约46.2MiB。没有使用AI图、CAD渲染或把裁切／旋转版另算一张。原作者：[stepanje/MPDD](https://github.com/stepanje/MPDD)，许可：[CC BY-NC-SA 4.0](https://raw.githubusercontent.com/stepanje/MPDD/main/LICENSE)。镜像源与不能逐文件对照原作者哈希的限制见manifest。

只用于本机非商业研究，不将原图或改图进入正式网站、public或Git；不将该许可解释成商业产品素材许可。公开报告只存无图的计数／配置／源清单，原照片与叠图仍留本地，分享时须保留作者、许可和修改说明。

6类为 bracket_black、bracket_brown、bracket_white、connector、metal_plate、tubes。含直边、夹角、孔／圆环、斜拍、反光、多物体和背景干扰，但单一来源、多张为同类件不同姿态；缺少真实用户桌面／手机场景和典型实心台阶轴，不能把36个不同文件当成36类独立零件或宣称泛化通过。花饰支架也用于观察“圆形轮廓不等于孔”的误候选。

## 技术边界

- OpenCV.js 在独立 npm 包内精确锁定；使用 Node.js 执行批量处理，复用根项目现有 Sharp 读取像素。GitHub 调研后增加一次性原生 EdgeDrawing 对照：Python 依赖精确记录在 `native-requirements.txt`，仅安装至忽略的 `tmp/p1-03/python`，不修改系统 Python、不成为网站运行依赖。正式应用 `package.json`／`package-lock.json` 不变，无Docker／代理调整。
- 先实验局部粗画意图：线段、角度、圆、椭圆；圆／椭圆候选按需检测。局部直线不能延伸成全图线段候选，圆弧不承诺自动贴合。
- 只输出像素定位或归一化几何，不输出真实毫米、真实角度或物理孔判断；无匹配／含糊时保留原草稿。所有临时结果不写正式annotation、issue或历史。
- 预置粗画种子仅是技术探针，不能冒称实测工程师基线；算法生成的轮廓也不能反过来作为正确答案。召回、误检、修正／撤销和任务完成时间必须由独立人工标记／操作提供。
- 本轮不启动浏览器／E2E，不把Node运行耗时／WASM堆大小当成手机流畅性或浏览器首载结论。浏览器与手机效果最后人工试用。

算法依据核对：[OpenCV shape descriptors](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html)、[Canny/Hough lines](https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html)、[JS 包维护者文档](https://github.com/TechStark/opencv-js)、[OpenCV 许可](https://opencv.org/license/)。新增依赖仅限本实验，P1-04正式接入与运行架构另按实验结论批准。

## 运行已有样本

在根目录先完成 `npm ci`，在 `experiments/cv` 完成 `npm ci`。图像不在 Git 内，必须先具备本机 `tmp/p1-03/manifest.json` 和对应原图／标准图；来源与哈希清单另存 `docs/evidence/p1-03/sources.json`。`collect.mjs` 的历史截止时间已到，不应为复现重启选图；缺少样本时按来源清单恢复同一批已选文件或由用户提供材料。

```powershell
# 在 experiments/cv 下；按顺序执行，上一步成功后再执行下一步。
npm run run
npm run compare
npm run render
npm run evidence
npm run review:materials
npm run evaluate
npm run report
npm run serve
```

`compare` 需要已有原生特征。首次原生对照使用 CPython 3.12 x64，在根目录执行下面两步；替换 `python` 为本机相应解释器。安装目标只在忽略目录，不运行全局安装。

```powershell
python -m pip install --target tmp/p1-03/python --only-binary=:all: --no-compile -r experiments/cv/native-requirements.txt
python experiments/cv/edge_drawing.py
```

`npm run render` 只生成叠图／图册，不会启动服务。`npm run serve` 只监听 `127.0.0.1:3103`；与正式应用 `npm run dev` 的3000端口独立。http://127.0.0.1:3103/ 默认展示只读结论与6组对照（需先运行 `npm run report`）；可选操作页在 `/manual.html`，图册在 `/gallery.html`，也可直接打开 `tmp/p1-03/results/report.html` 或 `gallery.html`。服务只允许读取固定实验文件，不接受上传、写入或任意文件路径，不连接业务账户。Ctrl+C 停止。没有自动打开浏览器。

已有照片／两种算法结果齐全时，不必重跑批处理；新增审查与收尾仅需依次执行 `npm run review:materials`、`npm run evaluate`、`npm run report`、`npm run serve`。参考坐标与候选判断固定在 `references.json`／`candidate-audit.json`；结果快照不匹配时评估拒绝继续，不能把新输出套在旧判断上。

## 人工实验页与证据边界

独立 HTML/SVG 页面沿用正式页面的白底、冷灰文字、蓝色按钮、4px圆角和44px控件。提供四种几何绘制、控制点修正、撤销、关闭辅助、候选主动选用、四种实验方式及 JSON 导出。纯手动与 Canny/Hough 辅助使用同一绘图页；CV 在可终止的浏览器 Worker 中按需加载。EdgeDrawing 模式只读取预计算的原生特征，用来观察几何效果，不能当成它已实现浏览器实时计算。

从点击“开始并加载照片”至“目标已标好”的 `completedMs` 才是任务操作时间；保存记录时的 `wallMs` 还包含评价时间。没按停止计时、空几何、失败和切后台的记录均不能直接作为有效效率样本。记录只保留在当前页面内存，刷新会丢失，必须导出；最多150条，超过时只保留最近150条。

原生全图内部线段只用于意图匹配，不对用户显示全图线段候选。两种引擎共用位置／范围／方向匹配和正常几何校验，但原生复用全图特征，Canny/Hough重新计算ROI，不能把两者耗时视为同运行时比较。EdgeDrawing 不提供可比的候选置信度；内部中性匹配权重不是置信度，coverage/residual为null。

必要检查：根目录 `npm run lint`；本目录 `npm run check`、`npm test`（现11项）；服务启动时构建两个浏览器脚本，再做少量本机只读 HTTP 核对。没有启动正式 Next 开发服务、浏览器、E2E 或生产构建。代理审查和误差评估不是独立人工验收；真实用户时间、浏览器／手机仍未验证，但按10月25日调整口径不阻断技术实验收尾。

实验依赖：OpenCV.js/OpenCV contrib 4.12（Apache-2.0）、esbuild 0.28.2（MIT）、NumPy 2.2.6（BSD-3-Clause 及随发行物附带的第三方通知）；opencv-python包装代码另保留其MIT通知。`ED_Lib`（MIT）和CVAT（核心MIT）仅查阅，没有复制或整体引入。
