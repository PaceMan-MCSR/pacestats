import assert from "node:assert/strict";
import {createRequire} from "node:module";

const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:5050/stats/");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Local Docker URL required");
const {chromium} = createRequire("/tmp/pacestats-perf/package.json")("playwright");
const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
const context = await browser.newContext();
const page = await context.newPage();
const requests = [];
const errors = [];
page.on("request", request => { if (request.headers().rsc === "1") requests.push(request.url()); });
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => new URL(route.request().url()).origin === base.origin ? route.continue()
    : route.request().resourceType() === "image" ? route.fulfill({contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>'}) : route.abort());
try {
    for (const path of ["?days=9999&category=average", "aa/?days=9999&category=average"]) {
        await page.goto(new URL(path, base).href, {waitUntil: "domcontentloaded"});
        await page.waitForFunction(() => {
            const button = [...document.querySelectorAll("button")].find(value => value.textContent === "Show Sample Sizes");
            return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
        });
        await page.locator(".stats-row table").first().waitFor();
        const columns = await page.locator(".stats-row table th").count();
        const before = requests.length;
        await page.getByRole("button", {name: "Show Sample Sizes", exact: true}).click();
        await page.waitForURL(url => url.searchParams.get("showQty") === "true");
        await page.waitForFunction(count => document.querySelectorAll(".stats-row table th").length > count, columns);
        await page.goBack();
        await page.getByRole("button", {name: "Show Sample Sizes", exact: true}).waitFor();
        assert.equal(await page.locator(".stats-row table th").count(), columns);
        await page.goForward();
        await page.getByRole("button", {name: "Hide Sample Sizes", exact: true}).waitFor();
        await page.waitForTimeout(200);
        assert.equal(requests.length, before, "Sample visibility and Back/Forward reuse the existing table data without RSC requests");
        if (path.startsWith("aa/")) {
            await page.locator(".tableHeader").first().hover();
            await page.getByRole("tooltip").filter({hasText: "Sample size"}).waitFor();
            assert.ok(await page.locator(".colorHeader").evaluate(element => element.style.backgroundImage.includes("linear-gradient")));
        }
    }
    assert.deepEqual(errors, []);
    console.log("PASS: main/AA sample columns update instantly without fetching and survive Back/Forward; AA gradients remain interactive");
} finally {
    await context.close();
    await browser.close();
}
