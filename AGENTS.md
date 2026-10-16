# PartMeasure 工作约束

- 先读 `PartMeasure_V1_PRD.md`，尤其 4–6、8–10、12 节，以及 `docs/P0-0/`。
- 当前授权仅 P0-0。不要提前实现 P0-1～P0-4、P1 AI/CV 或正式业务 UI。
- 新交互、页面布局和视觉语言须先提案并取得项目所有者明确批准。批准记录见 `docs/P0-0/05-interaction-proposal.md`；目前待审批。
- 工作台只保留「资料与补测」「交付与版本」。无渐变、暖黄主色、AI 风格或无意义容器嵌套。
- npm 唯一包管理器；精确版本 + package-lock。TypeScript strict。复用已有内容，不覆盖他人改动。
- SQL 草案在 `supabase/drafts/`；仅经审查后用固定版本 CLI `migration new` 建正式 migration。不得擅自操作远程数据库或生产部署。
- 私有数据/RLS/Storage 必须默认拒绝。分享令牌只存哈希，日志脱敏，密钥永不进版本库。
- 检查：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`。基础测试不能代替真实数据库与大陆手机网络验收。
- 阶段报告区分已完成、待审批、待外部验证；未实测不得写通过。
- 收尾用户要求全程无Docker；已明确授权的隔离云实验项目ref为`rvysclscetfqicpnzlra`，不得转而操作既有生产项目。业务草案未批准不得应用，本机auth/Storage替身永不部署云端。
- 用户已决定暂不配置SMTP：OTP及完整A/B/Storage服务实验待完成，未经后续明确授权不得重发邮件。大陆手机网络延到UI可操作后、P0最终验收前，不是当前P0-0阻断；数据库可访问不等于Auth/Storage/整站通过。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
