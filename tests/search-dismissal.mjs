import assert from "node:assert/strict";
import {createRequire} from "node:module";

const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:5050/stats/");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Local Docker URL required");
const {chromium} = createRequire("/tmp/pacestats-perf/package.json")("playwright");
const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
const context = await browser.newContext();
const page = await context.newPage();
let queryDelay = 350;
let queries = 0;
const prefetches = [];
const failures = [];
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("requestfailed", request => failures.push(request.url()));
page.on("request", request => { if (request.headers()["next-router-prefetch"] === "1") prefetches.push(request.url()); });
await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base.origin) return request.resourceType() === "image"
        ? route.fulfill({contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>'}) : route.abort();
    if (url.pathname.endsWith("/api/getPlayerNames/")) return route.abort();
    if (url.pathname.endsWith("/api/searchPlayers/")) {
        queries++;
        await new Promise(resolve => setTimeout(resolve, queryDelay));
        try { await route.fulfill({contentType: "application/json", body: JSON.stringify([{id: "638699ad-aada-4b22-92d0-c2fc2ad0f314", name: "NoFearr1337", color: null}])}); } catch { /* The dismissed request was aborted. */ }
        return;
    }
    return route.continue();
});
try {
    await page.goto(base.href, {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => {
        const input = document.querySelector('.searchWrapper input');
        return input && Object.keys(input).some(key => key.startsWith("__reactProps$"));
    });
    const input = page.getByPlaceholder("Username", {exact: true}).first();
    await input.fill("No");
    await input.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(queries, 0, "Escape cancels a pending debounce before any API work");
    await input.fill("NoF");
    await page.waitForRequest(request => request.url().includes("/api/searchPlayers/"));
    await page.locator("h1.header").click();
    await page.waitForTimeout(550);
    assert.ok(failures.some(url => url.includes("/api/searchPlayers/")), "Dismissing aborts an active lookup");
    assert.equal(await page.locator('[data-test="result"]').count(), 0);
    assert.equal(prefetches.length, 0, "A dismissed response must not prefetch hidden players");
    queryDelay = 0;
    await input.fill("NoFe");
    await page.locator('[data-test="result"]').filter({hasText: "NoFearr1337"}).waitFor();
    await input.press("ArrowDown");
    await input.press("Enter");
    await page.waitForURL(url => url.pathname.endsWith("/player/NoFearr1337/"));
    assert.deepEqual(errors, []);
    console.log("PASS: Escape cancels pending search; blur aborts lookup and hidden prefetch; a fresh keyboard search still navigates");
} finally {
    await context.close();
    await browser.close();
}
