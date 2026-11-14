import assert from "node:assert/strict";
import {createRequire} from "node:module";

const baseline = new URL(process.env.PERF_BASELINE_URL ?? "http://127.0.0.1:5081/stats/");
const candidate = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:5082/stats/");
for (const server of [baseline, candidate]) if (!["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)) throw new Error("Local Docker URL required");
const {chromium} = createRequire("/tmp/pacestats-perf/package.json")("playwright");
const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => [baseline.origin, candidate.origin].includes(new URL(route.request().url()).origin) ? route.continue()
    : route.request().resourceType() === "image" ? route.fulfill({contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>'}) : route.abort());
const variants = [
    "days=9999", "days=30&showQty=true",
    "days=9999&category=average", "days=7&category=average&showQty=true",
    "days=9999&category=fastest", "days=30&category=fastest",
    "days=9999&category=conversion", "days=7&category=conversion&showQty=true",
];
let canonicalLinks = 0;
try {
    for (const variant of variants) {
        const snapshots = [];
        const gradients = [];
        for (const server of [baseline, candidate]) {
            await page.mouse.move(0, 0);
            await page.goto(new URL(`aa/?${variant}`, server).href, {waitUntil: "domcontentloaded"});
            await page.waitForFunction(() => {
                const button = document.querySelector(".rangeButtons button");
                return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
            });
            snapshots.push(await page.locator(".stats-row .tableWrapper").evaluateAll(tables => tables.map(table => ({
                title: table.querySelector(".tableHeader").textContent,
                columns: [...table.querySelectorAll("th")].map(cell => cell.textContent),
                rows: [...table.querySelectorAll("tbody tr")].map(row => [...row.cells].map(cell => ({
                    text: cell.textContent.trim(), hint: cell.getAttribute("title"),
                    colors: [...cell.querySelectorAll("p")].map(value => value.style.color),
                    links: [...cell.querySelectorAll("a")].map(link => link.getAttribute("href")),
                    avatars: [...cell.querySelectorAll("img")].map(image => ({src: image.getAttribute("src"), alt: image.alt})),
                }))),
            }))));
            const header = page.locator(".tableHeader").filter({hasText: /Average|Conversion/}).first();
            if (await header.count()) {
                await header.hover();
                await page.getByRole("tooltip").filter({hasText: "Sample size"}).waitFor();
                gradients.push(await page.locator(".colorHeader").evaluate(element => ({
                    gradient: element.style.backgroundImage, labels: [...element.querySelectorAll("p")].map(label => ({text: label.textContent, margin: label.style.marginLeft})),
                })));
                await page.mouse.move(0, 0);
                await page.getByRole("tooltip").waitFor({state: "detached"});
            } else gradients.push(null);
        }
        // The old conversion renderer truncated the destination nickname along
        // with its label. Keep labels identical while validating the corrected
        // canonical route separately for long names.
        if (variant.includes("conversion") && variant.includes("showQty=true")) {
            snapshots[0].forEach((table, tableIndex) => table.rows.forEach((row, rowIndex) => row.forEach((cell, cellIndex) => cell.links.forEach((href, linkIndex) => {
                const actual = snapshots[1][tableIndex].rows[rowIndex][cellIndex].links[linkIndex];
                if (href === actual) return;
                const shortName = href.split("/")[3];
                const fullName = actual.split("/")[3];
                assert.equal(shortName.length, 12);
                assert.ok(fullName.length > 12 && fullName.startsWith(shortName));
                cell.links[linkIndex] = actual;
                canonicalLinks++;
            }))));
        }
        assert.deepEqual(snapshots[1], snapshots[0], `AA titles/order/values/links/colors differ: ${variant}`);
        assert.deepEqual(gradients[1], gradients[0], `AA sample gradient differs: ${variant}`);
        console.log(`PASS: AA parity ${variant}`);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({variants: variants.length, canonicalLinks, runtimeErrors: errors.length}));
} finally {
    await context.close();
    await browser.close();
}
