# 官方兼容与许可证核对

核对日2026-10-16；先查官方页面和registry，再精确锁版本。来源状态见 `docs/evidence/official-docs.json`、版本/engine/peer原始记录见 `registry.json`；安装树的准确版本与integrity以根 `package-lock.json` 为准。查阅“最新文档”不等于盲目采用每个最新major。

## 最终选择

| 依赖 | 锁定版本 | 官方兼容核对与选择理由 | 许可证 |
|---|---|---|---|
| Node / npm | 24.15.0 / 11.12.1 | 本机已验证组合；Node24 LTS满足Next、Vitest5和supabase-js最低版本；不用全局升级 | Node自身MIT/组件NOTICE；npm Artistic-2.0，非打包到应用的依赖 |
| Next.js | 16.4.2 | [安装](https://nextjs.org/docs/app/getting-started/installation)：Node≥20.9、TS≥5.1；App Router/Route Handlers。生产与dev固定webpack，见下文 | MIT |
| React / React DOM | 19.3.1 / 19.3.1 | [React版本](https://react.dev/versions)；Next peer支持^19，React DOM要求React^19.3.1 | MIT |
| TypeScript | 6.0.3 | [strict](https://www.typescriptlang.org/tsconfig/strict.html)；实际strict/typecheck/Next编译验证。registry最新7.0.2已核对，本基线保守选6.0.3；7尚未验证不自动迁移 | Apache-2.0 |
| @types/node/react/react-dom | 24.19.2 / 19.3.0 / 19.3.0 | Node类型跟24主版本，不用registry最新26类型；React类型与运行主版本一致 | MIT |
| Tailwind / @tailwindcss/postcss | 4.3.3 / 4.3.3 | [PostCSS安装](https://tailwindcss.com/docs/installation/using-postcss)：用独立postcss包和CSS import，不套用v3配置 | MIT |
| Zod | 4.6.7 | [官方要求](https://zod.dev/)：TS≥5.5、strict；目前仅锁定依赖，DTO仍是审查契约 | MIT |
| react-konva / Konva | 19.3.2 / 10.9.0 | [React文档](https://konvajs.org/docs/react/index.html)及所安装包官方README：react-konva19.3要求React/DOM^19.3；Konva^10受支持；未实现Canvas | MIT |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7 | [SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)：ssr peer≥2.114；JS Node≥22，Node24满足；不用旧auth-helpers | MIT |
| Supabase CLI | 2.121.0 | [CLI](https://supabase.com/docs/reference/cli/introduction)，已实际`--help`/`init`/`migration new`；不凭旧命令记忆；dev工具，不入浏览器 | MIT（registry声明；包未附根LICENSE，源码许可证链接见NOTICE） |
| Vitest | 5.0.5 | [指南](https://vitest.dev/guide/)：Vite≥6.4、Node≥22.12（实际engine有24范围）；采用Node环境，Vite解析由锁文件固定；不把async RSC当普通单测 | MIT |
| @playwright/test | 1.64.1 | [安装](https://playwright.dev/docs/intro)：Node22/24/26、Windows11等；对应Chromium156固定下载；实际viewport测试另见结果 | Apache-2.0 |
| Biome | 2.5.15 | [官方快速开始](https://biomejs.dev/installation/quick-start/)，Next官方安装文档允许Biome；启用recommended lint、告警即失败，formatter暂不强制 | MIT OR Apache-2.0 |
| Sharp（独立实验dev依赖） | 0.35.5 | 本轮核对registry/官方autoOrient、metadata与输入限制；复用原Next相同版本，用于16份EXIF样本生成及标准化，不接入业务worker | Apache-2.0；libvips平台包另有LGPL等通知 |

运行约束比单个依赖minimum更严格，`engine-strict`与项目engines约束Node24/npm11。最低浏览器由Next与Tailwind取交集：Chrome/Edge111+、Safari16.4+、Firefox128+；微信/X5及旧Android WebView需真实验证，不能假定满足现代CSS。系统字体不依赖Google Fonts。Konva的Node Canvas后端peer是可选，不安装canvas/skia-canvas来支撑浏览器画布。

## 发现与处理

- 最初考察了TS7.0.2/ESLint10.12.0；typescript-eslint上界<6.1、eslint-plugin-react不支持ESLint10，不能靠force/legacy-peer-deps忽略。ESLint9候选已结束支持，并且eslint-config-next→fast-glob→micromatch→braces链报告5项high。最终移除整个ESLint工具链，使用Next官方支持的Biome；没有用`audit fix --force`把Next降回旧major。
- 最初Turbopack在CSS/PostCSS子进程启动处崩溃，沙箱与正常权限都复现；Next `--webpack`构建成功。固定dev/build都走webpack以交付可运行基线；Turbopack恢复是可选工具优化，不作为业务阻断。
- React Konva旧的`Nextjs.html`/`StrictMode.html`链接404，直接核对所安装19.3.2官方README：Konva10+配Client Component无需额外canvas配置；Konva自己的strict与React StrictMode不同。GitHub raw读取失败保留在证据，不冒充已访问；安装包README已实际读取。运行时Canvas试验仍待执行。
- Vitest不支持直接测试async Server Component（[Next测试文档](https://nextjs.org/docs/app/guides/testing/vitest)）；基础单测覆盖健康契约，RSC/页面由Playwright覆盖，不安装无用的jsdom/Testing Library。

## Supabase变更记录复核

先读取[官方changelog](https://supabase.com/changelog.md)，再读取相关详情：

1. [Data API默认授权变更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)：2026-10-30起推广到既有项目，新表必须显式GRANT，RLS仍独立。草案同时REVOKE/GRANT+RLS；本地`auto_expose_new_tables=false`，不凭旧默认自动暴露。
2. [旧TLS1.2 CBC套件停用](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)：最早2026-11-10，Auth/Storage等HTTP API受影响；真实手机TLS/系统信任链列入大陆试验，不能靠桌面Node成功放行。
3. [Free SMTP模板限制](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)：新Free项目默认邮件服务不能自定义模板；P0-1邮箱OTP投递/中文模板需自备SMTP或评估套餐，待外部资源，不算本次完成。
4. 扩展版本pin已弃用、Realtime schema锁定、自托管网关/PG升级已扫描：本方案不用扩展版本pin、不写Realtime schema、不自托管，所以没有对应迁移。Management logs/all变更不涉及当前没有接入的监控API。

## 许可证范围

`npm run licenses`按锁文件生成`docs/evidence/licenses.json`，包含各包SPDX、是否本机安装、许可证文件SHA-256。`npm audit`是已知漏洞检查，不是许可证审查或安全保证。直接JS依赖以MIT为主；**传递依赖并非全MIT**，包含Next带入的Sharp/libvips LGPL-3.0-or-later、CSS构建链Lightning CSS MPL-2.0、caniuse-lite CC-BY-4.0。见根 `THIRD_PARTY_NOTICES.md` 的归属/分发义务；不能宣称任意二进制分发均已法务通过。

项目自身未擅自选择开源许可证（private:true）；第三方许可证不改变用户对本项目的许可决定。最终部署、打包二进制/容器、修改依赖源代码时再核对所带NOTICE/源代码提供义务；该分发审查是后续发布检查，不把未选的AI/OpenCV/导出库当已核对。后续引入新依赖须重新查官方文档、许可证、lock和实际检查。
