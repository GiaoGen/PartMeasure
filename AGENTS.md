# PartMeasure 工作约束

- 先读 `PartMeasure_V1_PRD.md`，尤其 4–6、8–10、12 节，以及 `docs/P0-0/`。
- 当前授权 P0-4；用户已明确确认 P0-3 人工验收通过，并授权第一轮成果交付与P0端到端闭环，依据见 `docs/P0-4/00-authorization.md`。不实施 P1/P2 或全站UI重设计。
- 2026-10-19 用户另行授权依据 `docs/frontend-backend-alignment.md` 先实施明确的后端对齐项；范围见 `docs/backend-alignment/00-scope.md`。文件夹/搜索等以本次授权为准；标注私有发布/批次/永久编号仍待语义决策，不扩大到完整 P1/P2。不自行启动浏览器或 E2E，保留当前前端未提交改动。
- 在已批准方案内实施成果私有草稿、多附件原子发布、不可覆盖版本与受控下载，复用已有认证/文件/标注/测量；实质改变流程/架构再提案。
- 工作台只保留「资料与补测」「交付与版本」。无渐变、暖黄主色、AI 风格或无意义容器嵌套。
- npm 唯一包管理器；精确版本 + package-lock。TypeScript strict。复用已有内容，不覆盖他人改动。
- SQL 草案在 `supabase/drafts/`；仅部署本阶段正式 migration 至已授权隔离测试项目；禁止生产部署及整份部署未来阶段草案。
- 私有数据/RLS/Storage 必须默认拒绝。分享令牌只存哈希，日志脱敏，密钥永不进版本库。
- 检查：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`。基础测试不能代替真实数据库与大陆手机网络验收。
- 阶段报告区分已完成、待审批、待外部验证；未实测不得写通过。
- 收尾用户要求全程无Docker；已明确授权的隔离云实验项目ref为`rvysclscetfqicpnzlra`，不得转而操作既有生产项目。业务草案未批准不得应用，本机auth/Storage替身永不部署云端。
- 用户已配置 Resend SMTP 和数字 Token 模板。注册邮箱+密码+数字 OTP 确认，之后密码登录；此前用户暂缓的真实注册验证仍须单列。P0-4必须安排大陆真实手机网络登录/分享/照片上传/回复/私有下载人工实测；未实测不得宣称整个P0验收通过，等待期间继续不受影响工作。数据库可访问不等于 Auth/Storage/整站通过。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
