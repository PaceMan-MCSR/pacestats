/** Compare table output and navigation against local Docker production builds. */
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:5052/stats/");
const baseline = process.env.PERF_BASELINE_URL ? new URL(process.env.PERF_BASELINE_URL) : null;
for (const value of [base, baseline].filter(Boolean)) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(value.hostname)) throw new Error("Local Docker URL required");
}
const require = createRequire(process.env.PERF_PLAYWRIGHT_PACKAGE ?? "/tmp/pacestats-perf/package.json");
const {chromium} = require("playwright");
const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
const context = await browser.newContext({viewport: {width: 1365, height: 900}});
const page = await context.newPage();
const errors = [];
const requests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => requests.push({url: request.url(), headers: request.headers(), type: request.resourceType()}));
await context.route("**/*", route => {
    if ([base.origin, baseline?.origin].includes(new URL(route.request().url()).origin)) return route.continue();
    if (route.request().resourceType() === "image") return route.fulfill({contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
    return route.abort();
});
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {offline: false, latency: 300, downloadThroughput: 1_250_000, uploadThroughput: 625_000});
await cdp.send("Emulation.setCPUThrottlingRate", {rate: 4});
page.setDefaultTimeout(30_000);
const url = path => new URL(path, base).href;
const isPlayerPrefetch = request => request.headers["next-router-prefetch"] === "1" && new URL(request.url).pathname.startsWith("/stats/player/");
async function boardReady() {
    await page.waitForFunction(() => {
        const region = document.querySelector('.stats-row[aria-busy="false"]');
        const key = region && Object.keys(region).find(value => value.startsWith("__reactProps$"));
        return key && typeof region[key].onPointerMove === "function";
    });
}

try {
    if (process.env.PERF_OBS_ONLY !== "1") {
    if (baseline) {
        const variants = ["?days=1", "?days=7", "?days=30", "?days=9999",
            "?days=30&category=average&showQty=true", "?days=9999&category=conversion&showQty=true&bastionFort=true",
            "?days=9999&category=fastest&bastionFort=true", "?days=9999&showQty=true&bastionFort=true"];
        for (const variant of variants) {
            const snapshots = [];
            for (const server of [baseline, base]) {
                const response = await page.goto(new URL(variant, server).href, {waitUntil: "domcontentloaded"});
                assert.equal(response.status(), 200);
                await page.locator('.stats-row:not([aria-busy="true"])').first().waitFor({state: "attached"});
                // Real parsing executes React's streamed segment insertion;
                // an inert DOMParser leaves holes in the baseline tables.
                snapshots.push(await page.evaluate(() => {
                    return [...document.querySelectorAll('.stats-row:not([aria-busy="true"]) .tableWrapper')].map(table => ({
                        title: table.querySelector(".tableHeader")?.textContent,
                        help: table.querySelector(".tableHeader")?.getAttribute("title"),
                        headers: [...table.querySelectorAll("th")].map(cell => cell.textContent),
                        rows: [...table.querySelectorAll("tbody tr")].map(row => [...row.cells].map(cell => ({
                            text: cell.textContent.trim(), hint: cell.getAttribute("title"), align: cell.style.textAlign,
                            colors: [...cell.querySelectorAll("p")].map(value => value.style.color),
                            links: [...cell.querySelectorAll("a")].map(link => link.getAttribute("href")),
                            avatars: [...cell.querySelectorAll("img")].map(image => ({src: image.getAttribute("src"), alt: image.alt, width: image.width, height: image.height, loading: image.loading, decoding: image.decoding, priority: image.fetchPriority})),
                        }))),
                    }));
                }));
            }
            assert.deepEqual(snapshots[1], snapshots[0], `All visible table values/styles/links must match baseline: ${variant}`);
        }
        console.log("PASS: all ranges, four views, split structures and sample columns preserve baseline table output");
    }

    await page.mouse.move(500, 500);
    const start = requests.length;
    await page.goto(url("?days=9999"), {waitUntil: "domcontentloaded"});
    await boardReady();
    await page.waitForTimeout(180);
    assert.equal(requests.slice(start).filter(isPlayerPrefetch).length, 0, "Stationary pointer must not prefetch arriving tables");
    const links = page.locator("a.boardLink:visible");
    assert.ok(await links.count() >= 5);
    assert.equal(await links.first().evaluate(link => {
        const key = Object.keys(link).find(value => value.startsWith("__reactProps$"));
        return Boolean(key && (link[key].onMouseDown || link[key].onPointerEnter));
    }), false, "Rows must share navigation handlers");
    await page.mouse.move(0, 0);
    const sweepStart = requests.length;
    for (let index = 0; index < 5; index++) {
        const bounds = await links.nth(index).boundingBox();
        await page.mouse.move(bounds.x + 3, bounds.y + bounds.height / 2);
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(180);
    assert.equal(requests.slice(sweepStart).filter(isPlayerPrefetch).length, 0);
    const prepared = page.waitForRequest(request => request.headers()["next-router-prefetch"] === "1" && new URL(request.url()).pathname.startsWith("/stats/player/"));
    await links.first().hover();
    await prepared;
    const target = await links.first().getAttribute("href");
    const documents = requests.filter(request => request.type === "document").length;
    await links.first().focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(current => current.pathname === target);
    await page.locator(".playerStats .stat").first().waitFor();
    assert.equal(requests.filter(request => request.type === "document").length, documents, "Keyboard navigation must stay in the client router");
    await page.goBack();
    await boardReady();
    assert.equal(await page.locator("a.boardLink .playerName").first().evaluate(element => element.style.opacity), "1");
    console.log("PASS: delegated intent cancels sweeps, prepares hover, opens by keyboard and clears pending on Back");

    await page.goto(url(`player/${process.env.PERF_PLAYER ?? "NoFearr1337"}/`), {waitUntil: "domcontentloaded"});
    const rnph = page.locator(".nph p").filter({hasText: /^RNPH:/}).first();
    await rnph.waitFor();
    await page.waitForFunction(() => {
        const element = [...document.querySelectorAll(".nph p")].find(value => value.textContent.startsWith("RNPH:"));
        const key = element && Object.keys(element).find(value => value.startsWith("__reactProps$"));
        return key && typeof element[key].onMouseEnter === "function";
    });
    await rnph.hover();
    const tooltip = page.getByRole("tooltip");
    await tooltip.filter({hasText: "Includes wall time and overworlds"}).waitFor();
    const bounds = await tooltip.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1365 && bounds.y >= 0);
    await page.mouse.move(0, 0);
    await tooltip.waitFor({state: "detached"});
    await rnph.evaluate(element => { element.tabIndex = 0; element.focus(); });
    await tooltip.filter({hasText: "Includes wall time and overworlds"}).waitFor();
    await rnph.evaluate(element => element.blur());
    await tooltip.waitFor({state: "detached"});
    await rnph.click();
    assert.equal(await page.getByRole("button", {name: "Debug", exact: true}).count(), 0, "Tooltip handlers must preserve the card click");
    console.log("PASS: tooltips retain hover/focus delays, placement, dismissal and parent card interactions");
    }

    await page.goto(url("obs/"), {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => {
        const input = document.querySelector(".obsSetup .nameSearch input");
        return input && Object.keys(input).some(value => value.startsWith("__reactProps$"));
    });
    const search = page.locator(".obsSetup .nameSearch");
    await search.locator("input").fill(process.env.PERF_PLAYER ?? "NoFearr1337");
    await search.locator('[data-test="result"]').filter({hasText: process.env.PERF_PLAYER ?? "NoFearr1337"}).first().click();
    const help = page.locator("#dynamicLabel + svg.info-icon");
    await help.waitFor();
    await page.waitForFunction(() => {
        const element = document.querySelector("#dynamicLabel + svg.info-icon");
        const key = element && Object.keys(element).find(value => value.startsWith("__reactProps$"));
        return key && typeof element[key].onMouseEnter === "function";
    });
    await help.hover();
    await page.getByRole("tooltip").filter({hasText: "Automatically adjust layout"}).waitFor();
    console.log("PASS: SVG help icons forward tooltip interaction handlers");
    assert.deepEqual(errors, [], "No browser hydration or runtime errors");
} finally {
    await context.close();
    await browser.close();
}
