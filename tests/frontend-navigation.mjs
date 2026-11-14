/** Browser regression checks against the local production Docker build only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5052/stats/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Local Docker URL required');
const require = createRequire(process.env.PERF_PLAYWRIGHT_PACKAGE ?? '/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const player = process.env.PERF_PLAYER ?? 'NoFearr1337';
const errors = [];
const requests = [];

async function createContext(options = {}, serverBase = base) {
    const context = await browser.newContext({viewport: {width: 1365, height: 900}, ...options});
    await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === serverBase.origin) return route.continue();
        if (route.request().resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({url: request.url(), headers: request.headers()}));
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
        offline: false, latency: 300, downloadThroughput: 10_000_000 / 8, uploadThroughput: 5_000_000 / 8,
    });
    page.setDefaultTimeout(30_000);
    return {context, page};
}
const url = path => new URL(path, base).href;
async function hydratedRange(page) {
    await page.waitForFunction(() => {
        const button = document.querySelector('.rangeButtons button');
        return button && Object.keys(button).some(key => key.startsWith('__reactProps$'));
    });
}
async function boardReady(page) {
    await page.locator('.stats-row:not([aria-busy="true"])').first().waitFor({state: 'attached'});
    await hydratedRange(page);
}
async function rangeReady(page, days) {
    await page.waitForURL(current => current.searchParams.get('days') === String(days));
    await page.waitForFunction(() => document.querySelector('.rangeButtons')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.rangeButtons button[aria-pressed="true"]').count(), 1);
}

async function verifyTracker() {
    const {context, page} = await createContext();
    await page.mouse.move(500, 500);
    const initialRequests = requests.length;
    await page.goto(url(`player/${player}/nethers/`), {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => {
        const body = document.querySelector('.recentNethers tbody');
        const key = body && Object.keys(body).find(value => value.startsWith('__reactProps$'));
        return key && typeof body[key].onPointerMove === 'function';
    });
    await page.waitForTimeout(180);
    const isRunPrefetch = request => request.headers['next-router-prefetch'] === '1' && new URL(request.url).pathname.startsWith('/stats/run/');
    assert.equal(requests.slice(initialRequests).filter(isRunPrefetch).length, 0, 'Stationary pointer must not prefetch newly rendered rows');
    const first = page.locator('.recentNethers tbody tr').first();
    await page.mouse.move(0, 0);
    const deliberatePrefetch = page.waitForRequest(request => request.headers()['next-router-prefetch'] === '1' && new URL(request.url()).pathname.startsWith('/stats/run/'));
    await first.hover();
    await deliberatePrefetch;
    const runId = await first.getAttribute('data-run');
    await first.focus();
    await first.press('Enter');
    await page.waitForURL(current => current.pathname.endsWith(`/run/${runId}/`));
    await page.locator('.run-card').waitFor();
    await context.close();
    console.log('PASS: tracker table ignores stationary pointer, prefetches real movement and navigates by keyboard');
}

async function verifyDebugPrefetch() {
    const {context, page} = await createContext();
    const historyPath = `/stats/player/${player}/nethers/`;
    const prepared = page.waitForResponse(response => new URL(response.url()).pathname === historyPath
        && response.request().headers()['next-router-prefetch'] === '1' && response.status() === 200);
    await page.goto(url(`player/${player}/`), {waitUntil: 'domcontentloaded'});
    const debug = page.getByRole('button', {name: 'Debug', exact: true});
    await debug.waitFor();
    await (await prepared).finished();
    assert.ok(new URL(page.url()).pathname.endsWith(`/player/${player}/`), 'History prefetch must finish before clicking Debug');
    await debug.click();
    await page.waitForURL(current => current.pathname === historyPath);
    await page.waitForFunction(() => {
        const body = document.querySelector('.recentNethers tbody');
        const key = body && Object.keys(body).find(value => value.startsWith('__reactProps$'));
        return key && typeof body[key].onPointerMove === 'function';
    });
    await context.close();
    console.log('PASS: the single Debug route prefetches while its profile is visible and opens hydrated history');
}

try {
    if (process.env.PERF_DEBUG_ONLY === '1') {
        await verifyDebugPrefetch();
    } else if (process.env.PERF_TRACKER_ONLY === '1') {
        await verifyTracker();
    } else if (process.env.PERF_COLD_ONLY !== '1') {
        const {context, page} = await createContext();
        await page.goto(url('?days=9999'), {waitUntil: 'domcontentloaded'});
        await boardReady(page);

        // Enter and Space must work without relying on mouse-down events.
        await page.getByRole('button', {name: '24 hours', exact: true}).focus();
        await page.keyboard.press('Enter');
        await rangeReady(page, 1);
        await page.getByRole('button', {name: '7 days', exact: true}).focus();
        await page.keyboard.press('Space');
        await rangeReady(page, 7);
        console.log('PASS: Enter/Space change ranges, pending clears and one range stays selected');

        await page.goto(url('?days=9999'), {waitUntil: 'domcontentloaded'});
        await boardReady(page);
        const links = page.locator('a.boardLink:visible');
        assert.ok(await links.count() > 4, 'Lifetime fixtures must contain visible player links');
        await page.mouse.move(0, 0);
        const beforeSweep = requests.length;
        for (let index = 0; index < 5; index++) {
            const bounds = await links.nth(index).boundingBox();
            await page.mouse.move(bounds.x + 3, bounds.y + bounds.height / 2);
        }
        await page.mouse.move(0, 0);
        await page.waitForTimeout(180);
        const sweepPrefetches = requests.slice(beforeSweep).filter(request => request.headers['next-router-prefetch'] === '1');
        assert.equal(sweepPrefetches.length, 0, 'Pointer sweeps should cancel speculative route work');
        await links.first().hover();
        await page.waitForTimeout(450);
        assert.ok(requests.slice(beforeSweep).some(request => request.headers['next-router-prefetch'] === '1'), 'Deliberate hover should prefetch');
        await links.first().click();
        await page.locator('.playerStats .stat').first().waitFor();
        await page.goBack();
        await boardReady(page);
        assert.equal(await page.locator('a.boardLink .playerName').first().evaluate(element => element.style.opacity), '1');
        console.log('PASS: pointer sweeps cancel prefetch; deliberate hover loads target; Back clears pending state');

        await page.goto(url(`player/${player}/runs/`), {waitUntil: 'domcontentloaded'});
        await page.locator('.fastRunsGridRow').first().waitFor();
        const runLinks = await page.locator('.fastRunsGridRow').evaluateAll(rows => rows.slice(0, 2).map(row => row.getAttribute('href')));
        assert.equal(runLinks.length, 2, 'History fixture must provide two runs');
        const ids = runLinks.map(link => link.split('/').filter(Boolean).at(-1));
        const html = await (await context.request.get(new URL(runLinks[0], base.origin).href)).text();
        assert.match(html, /class="run-card"/, 'Initial run HTML includes the split card');
        assert.match(html, new RegExp(`class="secretId">${ids[0]}<`));
        const historicalRequests = requests.length;
        await page.goto(new URL(runLinks[0], base.origin).href, {waitUntil: 'domcontentloaded'});
        await page.locator('.run-card .secretId').filter({hasText: ids[0]}).waitFor();
        const icons = await page.locator('.run-card img.icon').evaluateAll(elements => elements.map(element => ({
            src: element.getAttribute('src'), width: element.width, height: element.height,
            decoding: element.decoding, priority: element.fetchPriority,
        })));
        assert.ok(icons.length > 0);
        for (const icon of icons) {
            assert.match(icon.src, /^\/stats\/[^/]+\.webp$/);
            assert.equal(icon.width, 40);
            assert.equal(icon.height, 40);
            assert.equal(icon.decoding, 'async');
            assert.equal(icon.priority, 'low');
        }
        assert.match(await page.locator('.run-card img.cardHead').getAttribute('src'), /^https:\/\/mc-api\.io\/render\/FACE\//);
        await page.waitForTimeout(3_400);
        assert.equal(requests.slice(historicalRequests).filter(request => request.url.includes('/api/getWorld/') || request.url.includes('/api/ars/liveruns')).length, 0);
        console.log('PASS: historical run card exists in first HTML and makes no getWorld/live-list request after hydration');

        await page.goto(url(`player/${player}/runs/`), {waitUntil: 'domcontentloaded'});
        await page.locator('.fastRunsGridRow').first().click();
        await page.waitForURL(current => current.pathname.endsWith(`/run/${ids[0]}/`));
        await page.waitForFunction(id => document.querySelector('.run-card .secretId')?.textContent === id, ids[0]);
        await page.goBack();
        await page.locator('.fastRunsGridRow').nth(1).click();
        await page.waitForURL(current => current.pathname.endsWith(`/run/${ids[1]}/`));
        await page.waitForFunction(id => document.querySelector('.run-card .secretId')?.textContent === id, ids[1]);
        await page.goBack();
        await page.goForward();
        await page.waitForFunction(id => document.querySelector('.run-card .secretId')?.textContent === id, ids[1]);
        console.log('PASS: separate run routes and browser Back/Forward retain the correct run snapshot');

        const {context: touchContext, page: touchPage} = await createContext({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}});
        await touchPage.goto(base.href, {waitUntil: 'domcontentloaded'});
        await boardReady(touchPage);
        await touchPage.getByRole('button', {name: 'Lifetime', exact: true}).tap();
        await rangeReady(touchPage, 9999);
        console.log('PASS: touch range changes complete and release pending state');
        await touchContext.close();
        await page.goto(url(`player/${player}/session/`), {waitUntil: 'domcontentloaded'});
        for (const category of ['Nether Enters', 'First Portal', 'Stronghold', 'End Enter', 'Finish']) {
            await page.getByRole('heading', {name: category, exact: true}).waitFor();
        }
        await hydratedRange(page);
        await page.getByRole('heading', {name: 'Nether Enters', exact: true}).click();
        await page.getByText('24h/3h', {exact: true}).waitFor();
        console.log('PASS: session profile renders all five session cards and hydrates screenshot interactions');
        await context.close();

        const {context: overlayContext, page: overlayPage} = await createContext();
        await overlayPage.addInitScript(() => {
            window.__intervalDelays = [];
            const original = window.setInterval;
            window.setInterval = (callback, delay, ...args) => {
                window.__intervalDelays.push(delay);
                return original(callback, delay, ...args);
            };
        });
        await overlayPage.goto(url(`obs/session/${player}/`), {waitUntil: 'domcontentloaded'});
        await overlayPage.locator('.sessionStats .stat-line').first().waitFor();
        await overlayPage.waitForTimeout(500);
        assert.equal(await overlayPage.evaluate(() => window.__intervalDelays.filter(delay => delay === 20).length), 0);
        await overlayPage.goto(url('obs/'), {waitUntil: 'domcontentloaded'});
        await overlayPage.waitForFunction(() => {
            const input = document.querySelector('.obsSetup .nameSearch input');
            return input && Object.keys(input).some(key => key.startsWith('__reactProps$'));
        });
        await overlayPage.getByPlaceholder('Username', {exact: true}).last().fill(player);
        await overlayPage.locator('[data-test="result"]').filter({hasText: player}).first().click();
        await overlayPage.waitForFunction(() => {
            const size = document.querySelector('.sizeHint')?.textContent?.split('x').map(Number);
            return size?.length === 2 && size.every(value => value > 0);
        });
        const previousSize = await overlayPage.locator('.sizeHint').textContent();
        await overlayPage.setViewportSize({width: 1100, height: 900});
        await overlayPage.waitForFunction(previous => document.querySelector('.sizeHint')?.textContent !== previous, previousSize);
        assert.equal(await overlayPage.evaluate(() => window.__intervalDelays.filter(delay => delay === 20).length), 0);
        console.log('PASS: ordinary overlays install no 20ms poll; preview dimensions update after a real resize');
        await overlayContext.close();
        await verifyDebugPrefetch();
        await verifyTracker();
    }

    if (process.env.PERF_COLD_BASE_URL) {
        const coldBase = new URL(process.env.PERF_COLD_BASE_URL);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(coldBase.hostname)) throw new Error('Local Docker cold URL required');
        const {context: coldContext, page: coldPage} = await createContext({}, coldBase);
        await coldPage.goto(coldBase.href, {waitUntil: 'domcontentloaded'});
        await coldPage.getByText('Leaderboard data is temporarily unavailable. Please try again shortly.', {exact: true}).waitFor();
        assert.equal(await coldPage.locator('.stats-row table').count(), 0, 'An absent cache must not appear as empty rankings');
        const retry = coldPage.getByRole('button', {name: 'Retry leaderboards', exact: true});
        await coldPage.waitForFunction(() => {
            const button = [...document.querySelectorAll('button')].find(element => element.textContent === 'Retry leaderboards');
            return button && Object.keys(button).some(key => key.startsWith('__reactProps$'));
        });
        const retried = coldPage.waitForRequest(request => request.headers().rsc === '1');
        await retry.click();
        await retried;
        await coldPage.getByRole('button', {name: 'Retry leaderboards', exact: true}).waitFor();
        assert.equal(await retry.isEnabled(), true);
        await coldPage.goto(new URL(`player/${player}/?days=9999`, coldBase).href, {waitUntil: 'domcontentloaded'});
        await coldPage.locator('.playerStats .stat').first().waitFor();
        await hydratedRange(coldPage);
        await coldPage.getByRole('button', {name: '7 days', exact: true}).focus();
        await coldPage.keyboard.press('Enter');
        await rangeReady(coldPage, 7);
        await coldPage.locator('.playerStats .stat').first().waitFor();
        console.log('PASS: absent Redis boards show a usable retry state; cold profile SQL fallback renders and changes ranges');
        await coldContext.close();
    }
    assert.deepEqual(errors, [], 'No browser runtime or hydration errors');
} finally {
    await browser.close();
}
