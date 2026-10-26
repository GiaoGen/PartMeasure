// Static contrast of the actual scoped CSS tokens, not a browser or visual audit.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const css = readFileSync("src/app/product-ui.css", "utf8");
function tokens(selector) {
	const start = css.indexOf(`${selector} {`);
	assert(start >= 0, `Missing ${selector}`);
	const block = css.slice(start, css.indexOf("}", start));
	return Object.fromEntries([...block.matchAll(/(--pm-[\w-]+):\s*(#[\da-f]{6}|#[\da-f]{3})\s*;/gi)].map(match => [match[1], match[2]]));
}
const light = tokens(".pm-ui"), dark = tokens('.pm-ui[data-appearance="dark"]');
assert.deepEqual(tokens('.pm-ui[data-appearance="system"]'), dark);
function luminance(hex) {
	if (hex.length === 4) hex = `#${[...hex.slice(1)].map(value => value + value).join("")}`;
	const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const pairs = [
	["正文/工作面", "ink", "surface", 4.5], ["辅助文字/工作面", "muted", "surface", 4.5],
	["正文/页面", "ink", "page", 4.5], ["辅助文字/页面", "muted", "page", 4.5],
	["链接/工作面", "accent", "surface", 4.5], ["主按钮文字/背景", "surface", "accent", 4.5],
	["选中项文字/背景", "accent", "accent-soft", 4.5], ["错误文字/背景", "danger", "danger-soft", 4.5],
	["归档提示/背景", "warning", "warning-soft", 4.5], ["输入边线/工作面", "control-line", "surface", 3],
];
const checks = [];
for (const [mode, palette] of Object.entries({ light, dark })) {
	for (const [label, foreground, background, minimum] of pairs) {
		const fg = palette[`--pm-${foreground}`], bg = palette[`--pm-${background}`];
		assert(fg && bg, `Missing color ${mode}/${label}`);
		const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		assert(ratio >= minimum, `${mode}/${label}: ${ratio.toFixed(2)} < ${minimum}`);
		checks.push({ mode, label, foreground: fg, background: bg, minimum, ratio: Number(ratio.toFixed(2)) });
	}
}
mkdirSync("docs/evidence/p3-01a", { recursive: true });
writeFileSync("docs/evidence/p3-01a/palette.json", `${JSON.stringify({ scope: "actual CSS token contrast only; no browser or device tested", systemMatchesDark: true, checks }, null, 2)}\n`);
process.stdout.write(`PASS: ${checks.length} static token contrasts; system dark tokens match explicit dark.\n`);
