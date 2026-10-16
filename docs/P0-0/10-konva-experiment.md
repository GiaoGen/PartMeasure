# 独立Konva/EXIF技术实验结果

日期2026-10-16。用户已授权本轮独立实验；不是正式编辑器，不进入P0-2业务实现。实验源位于`experiments/konva`，单独Next应用、3102端口、独立`.next`；主应用`src/app`没有增加编辑器路由/控件/API。

## 已实际执行

```powershell
npm run lab:images
npm run lab:konva:build
npm run lab:konva:test
node scripts/labs/record-konva.mjs
```

Sharp0.35.5显式固定为devDependency，复用Next依赖的相同版本，许可证Apache-2.0及已有libvips传递通知另见清单。[autoOrient](https://sharp.pixelplumbing.com/api-operation/#autoorient)、[输入限制](https://sharp.pixelplumbing.com/api-constructor/)、[输出元数据](https://sharp.pixelplumbing.com/api-output/)和[浏览器图像方向](https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap)均在本轮读取官方文档后使用。没有将Sharp接入业务上传或扫描worker。

| 检查 | 实际结果 | 界线 |
|---|---|---|
| EXIF 1～8，横/竖两组共16个JPEG | 16项生成器断言通过 | 合成、有独立像素方向oracle，不是真实手机照片 |
| 标准化 | 宽高正确、四角RGB误差≤10、EXIF/GPS元数据移除、再次autoOrient像素不变 | 只证明受控JPEG样本，不宣称任意恶意图安全 |
| 浏览器原件/标准图解码 | 16样本×DPR1/2视口均正确 | 原件自动按EXIF显示，标准图无二次旋转 |
| React Konva线/圆/点 | 真实Konva节点属性与预期像素坐标一致 | 固定探针，无绘制、拖拽、CRUD、测量工具 |
| 归一化往返 | 缩放0.5/2.75/1.25、平移及90°旋转的完整逆矩阵恢复误差≤0.5原图px | DPR不进入持久化坐标 |
| resize | 390/820/1100窗口变化后fit更新、坐标语义不变 | Chromium viewport，不是物理手机 |
| 序列化与刷新恢复 | 加载区别于初始值的JSON几何，写入实验sessionStorage，重新parse/刷新后恢复同一JSON | 不是业务保存，不证明数据库持久化或跨设备恢复 |
| 真实Canvas像素 | 线/圆轮廓/点在预期屏幕坐标处有白色像素 | 不只比较同一函数生成的数值 |
| Next生产构建 | 独立实验webpack build成功，无window/原生canvas错误 | Client动态加载隔离SSR；无canvas/skia额外依赖 |
| 自动化总数 | **36通过，0失败、0跳过、0flaky** | Chromium桌面DPR1及Pixel7仿真DPR2各18；约18.6秒 |

最后一次测试包含更改后的几何JSON与真正sessionStorage刷新恢复，避免以页面重新加载初始常量冒充恢复成功。React StrictMode保留；effect卸载清理ResizeObserver和window探针。算法/API未接入，不能把本实验说成AI/CV回退功能已经实现。

## 可审阅证据与复现

- `scripts/labs/generate-images.mjs`：依EXIF定义把标准场景反向映射到原始像素后写orientation标签。oracle是预设四角颜色及目标宽高，不拿Sharp自己的输出作预期值。
- `docs/evidence/closeout/exif.json`：16份原件/派生物SHA-256、尺寸、方向、元数据移除与稳定性。
- `tests/konva/konva.spec.ts`：实际Chromium解码、Konva节点、逆矩阵、Canvas像素及刷新测试。
- `docs/evidence/closeout/konva-browser.json`：从真实Playwright JSON结果提取测试名称、状态、耗时、视口与DPR；没有敏感信息。

图片为可重现生成物，`experiments/konva/public/fixtures/`被ignore；新checkout先`npm ci`、`npm run lab:images`再build和test，浏览器首次安装用`npm exec playwright install chromium`。服务器由Playwright自动启动/停止，不把实验部署到公网。构建曾在沙箱mkdir返回EPERM，正常本地权限下成功，失败记录不计PASS。

## 待后续验证

真实iOS Safari、Android/微信、触摸缩放/页面滚动冲突、真实相机EXIF、4K/40MP大图峰值内存/FPS、损坏图/解码炸弹与codec覆盖均未测。没有实机条件，不拿DPR仿真等价替代。正式P0-2还需标注交互批准、真实图像worker、revision保存/权限、画布手势及跨设备/刷新恢复；本实验不提前实现这些业务。

中国大陆网络按用户决定延到UI可操作后、P0最终验收前执行，当前不是P0-0阻断。只记录用户已确认数据库可访问，未扩展为Auth/Storage/整站或移动网络已通过。
