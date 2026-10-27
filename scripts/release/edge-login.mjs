// One separately authorized real Owner UI login; no business mutations or registration.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { releaseSource } from "./fingerprint.ts";
const approval = JSON.parse(await readFile("docs/evidence/p3-05/auth-fix-authorization.json", "utf8"));
assert.equal(approval.status, "APPROVED");
assert.equal(approval.sourceDigest, releaseSource().digest);
const provenance = JSON.parse(await readFile("docs/evidence/p3-05/preview-provenance.json", "utf8"));
assert.equal(provenance.localSourceDigest, approval.sourceDigest);
const origin = provenance.origin;
assert.match(origin, /^https:\/\/partmeasure-staging-[a-z0-9-]+\.vercel\.app$/);
// Refuse replay, including ambiguous failures. No cookies or credentials in the journal.
await writeFile("tmp/p3-05/auth-fix-login.pending", new Date().toISOString(), { flag: "wx" });
const report = { checkedAt: new Date().toISOString(), source: releaseSource().digest, origin,
  status: "NOT_PASSED", scope: "Installed Edge normal hydrated Owner UI login and existing project read only", traffic: [], blocked: [], pageErrors: [] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
let loginPosts = 0;
try {
  const health = await context.request.get(`${origin}/api/health`);
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).buildId, provenance.providerBuildId);
  const account = JSON.parse(await readFile("tmp/p0-1/test-accounts.json", "utf8")).A;
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    const credentialQuery = [...url.searchParams.keys()].some(key => /password|email|token/i.test(key)) || url.search.includes(account.password) || url.search.includes(encodeURIComponent(account.email));
    const write = !["GET", "HEAD", "OPTIONS"].includes(req.method());
    const allowedLogin = url.origin === origin && url.pathname === "/api/auth/login" && req.method() === "POST";
    if (credentialQuery || (write && (!allowedLogin || ++loginPosts > 1)) || url.origin !== origin) {
      report.blocked.push({ method: req.method(), reason: credentialQuery ? "credential-query" : "outside-read-only-scope" });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.name));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/")) report.traffic.push({ path, status: response.status() });
  });
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.equal(await page.locator(".pm-auth-form").getAttribute("method"), "post");
  await page.waitForFunction(() => {
    const form = document.querySelector(".pm-auth-form");
    return form && Object.keys(form).some(key => key.startsWith("__reactProps$") && typeof form[key]?.onSubmit === "function");
  });
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/login" && r.request().method() === "POST");
  await page.locator('.pm-auth-form button[type="submit"]').click();
  assert.equal((await response).status(), 200);
  await page.waitForURL(`${origin}/projects`, { timeout: 45000 });
  const project = await context.request.get(`${origin}/api/projects/98493feb-2b6f-4454-81ae-7960e84efff8`, { timeout: 20000 });
  assert.equal(project.status(), 200);
  assert.equal((await project.json()).data.id, "98493feb-2b6f-4454-81ae-7960e84efff8");
  report.projectReadStatus = project.status();
  assert.equal(loginPosts, 1);
  // Optional injected preview tooling may request a foreign GET. It stays blocked;
  // only credential queries or extra writes invalidate this login/read scope.
  assert.ok(report.blocked.every(entry => entry.method === "GET" && entry.reason === "outside-read-only-scope"));
  assert.deepEqual(report.pageErrors, []);
  report.browser = browser.version(); report.nativeMethod = "post"; report.loginPosts = loginPosts; report.status = "PASS";
} catch (error) { report.error = { name: error.name, code: error.code ?? null }; process.exitCode = 1; }
finally {
  await context.close(); await browser.close();
  await writeFile("docs/evidence/p3-05/auth-fix-edge-login.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
