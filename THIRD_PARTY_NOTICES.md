# Third-party dependency notices

PartMeasure uses third-party software. Exact versions and integrity are in `package-lock.json`; SPDX declarations and installed license-file hashes are in `docs/evidence/licenses.json`. Keep upstream copyright, LICENSE and NOTICE files when redistributing packages. This document does not license PartMeasure itself.

| Component | Upstream / license | Distribution handling |
|---|---|---|
| Next.js | https://github.com/vercel/next.js · MIT | Preserve copyright/license notices |
| React / React DOM | https://github.com/facebook/react · MIT | Preserve notices |
| TypeScript / Playwright | https://github.com/microsoft/TypeScript / https://github.com/microsoft/playwright · Apache-2.0 | Preserve license/NOTICE where present; identify modifications |
| Supabase JS / SSR / CLI | https://github.com/supabase/supabase-js / https://github.com/supabase/ssr / https://github.com/supabase/cli · MIT | Preserve notices; CLI npm manifest declares MIT but packaged root LICENSE is absent, retrieve upstream notice before redistributing CLI binary |
| Konva / react-konva | https://github.com/konvajs/konva / https://github.com/konvajs/react-konva · MIT | Preserve notices |
| Zod / Tailwind / Vitest | https://github.com/colinhacks/zod / https://github.com/tailwindlabs/tailwindcss / https://github.com/vitest-dev/vitest · MIT | Preserve notices |
| Biome | https://github.com/biomejs/biome · MIT OR Apache-2.0 | Comply with the chosen option and preserve notices |
| Sharp / libvips bundles (Next transitive optional platform artifacts) | https://github.com/lovell/sharp / https://github.com/libvips/libvips · Apache-2.0, LGPL-3.0-or-later, MIT as declared per package | Preserve bundled license/copyright, source and relinking rights where applicable; verify specific deployment binary bundle rather than treating all as MIT |
| Lightning CSS | https://github.com/parcel-bundler/lightningcss · MPL-2.0 | Preserve notices; provide source for modified covered files upon relevant distribution |
| caniuse-lite | https://github.com/browserslist/caniuse-lite · CC-BY-4.0 | Data from Can I use (https://caniuse.com), by Alexis Deveria and contributors, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); package compression by Browserslist contributors; no data modifications by this project |
| Other dependencies | See full inventory (MIT, ISC, BSD-3-Clause, 0BSD, Apache-2.0, etc.) | Preserve each installed upstream license/NOTICE; platform-specific optional packages are separately inventoried |

This P0-0 checkout is private engineering work, not approval of a final binary/container distribution. Review actual shipped artifacts and changed sources before release. Do not remove licenses from node_modules when packaging.
