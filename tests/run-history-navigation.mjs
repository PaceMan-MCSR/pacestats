/** Run inside local Docker against a development or production build. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5050/stats/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Local Docker URL required');
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const context = await browser.newContext({viewport: {width: 1365, height: 900}});
await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === base.origin) return route.continue();
    if (route.request().resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
    return route.abort();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settled = () => page.locator('.fastRunsGrid[aria-busy="false"]').waitFor();
const query = request => new URL(request.url()).searchParams;
const responseFor = predicate => page.waitForResponse(response => response.url().includes('/api/getPlayerRuns/')
    && query(response).get('page') === '0' && predicate(query(response)));
async function change(action, predicate) {
    const response = responseFor(predicate);
    await action();
    const result = await response;
    assert.equal(result.status(), 200);
    await result.finished();
    await settled();
    return result.json();
}
try {
    const prepared = page.waitForResponse(response => new URL(response.url()).pathname === '/stats/player/NoFearr1337/runs/'
        && response.request().headers()['next-router-prefetch'] === '1' && response.status() === 200);
    await page.goto(new URL('player/NoFearr1337/', base).href, {waitUntil: 'domcontentloaded'});
    await (await prepared).finished();
    assert.equal(new URL(page.url()).pathname, '/stats/player/NoFearr1337/');
    await page.getByRole('button', {name: 'More runs', exact: true}).click();
    await page.waitForURL(current => current.pathname.endsWith('/runs/'));
    await page.locator('.fastRunsGridRow').first().waitFor();
    console.log('PASS: the single More runs destination fully prepares while the profile is visible');
    await page.goto(new URL('player/NoFearr1337/runs/', base).href, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => {
        const button = document.querySelector('.filterToggle');
        return button && Object.keys(button).some(key => key.startsWith('__reactProps$'));
    });
    await page.getByRole('button', {name: 'Filters', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', {name: 'Sub 2 Enter', exact: true}).waitFor();
    const preset = await change(() => page.getByRole('button', {name: 'Sub 2 Enter', exact: true}).click(), params => params.get('filters').includes('120000'));
    assert.ok(preset.rows.every(row => row.nether < 120000));
    const entered = await change(() => page.getByRole('textbox', {name: 'Filter 1 time', exact: true}).fill('2:15'), params => params.get('filters').includes('135000'));
    assert.ok(entered.rows.every(row => row.nether < 135000));
    await page.getByRole('combobox', {name: 'Filter 1 column', exact: true}).selectOption('date');
    await change(() => page.getByRole('combobox', {name: 'Filter 1 operator', exact: true}).selectOption('during'), params => params.get('filters').includes('endValue'));
    assert.equal(await page.locator('input[type="date"]').count(), 1);
    await page.getByRole('button', {name: 'Reset all filters', exact: true}).click();
    await settled();
    assert.equal(await page.getByRole('combobox', {name: 'Filter 1 column', exact: true}).count(), 0);
    await page.getByRole('button', {name: 'Add filter', exact: true}).click();
    await page.getByRole('combobox', {name: 'Filter 1 column', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Remove filter 1', exact: true}).click();
    await settled();
    console.log('PASS: keyboard filter panel, native time/date/column/operator controls, presets and reset preserve API results');

    // Block only one old filter/sort response, then switch again. The obsolete
    // browser request must be aborted and cannot overwrite the newer result.
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    let blocked;
    const enteredGate = new Promise(resolve => {blocked = resolve;});
    const delayed = async route => {
        if (query(route.request()).get('sort') !== 'finish') return route.fallback();
        blocked();
        await gate;
        await route.continue().catch(() => {});
    };
    await page.route('**/api/getPlayerRuns/**', delayed);
    const aborted = page.waitForEvent('requestfailed', {predicate: request => request.url().includes('/api/getPlayerRuns/') && query(request).get('sort') === 'finish'});
    await page.getByRole('button', {name: /^Sort by Finish/}).click();
    await enteredGate;
    const newest = responseFor(params => params.get('sort') === 'nether');
    await page.getByRole('button', {name: /^Sort by Nether/}).click();
    release();
    assert.match((await aborted).failure().errorText, /ABORTED/);
    const latest = await (await newest).json();
    await settled();
    assert.equal(await page.locator('[aria-sort="ascending"]').getByRole('button').getAttribute('aria-label'), 'Sort by Nether, currently ascending');
    assert.equal(Number(new URL(await page.locator('.fastRunsGridRow').first().getAttribute('href'), base).pathname.split('/').filter(Boolean).at(-1)), latest.rows[0].id);
    await page.unroute('**/api/getPlayerRuns/**', delayed);
    console.log('PASS: superseded sort requests abort; only the latest query renders');

    let fail = true;
    const failure = async route => {
        if (query(route.request()).get('sort') !== 'end' || query(route.request()).get('page') !== '0' || !fail) return route.fallback();
        fail = false;
        await route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"fixture unavailable"}'});
    };
    await page.route('**/api/getPlayerRuns/**', failure);
    await page.getByRole('button', {name: /^Sort by End/}).click();
    await page.getByRole('alert').getByRole('button', {name: 'Retry run history', exact: true}).waitFor();
    const recovered = responseFor(params => params.get('sort') === 'end');
    await page.getByRole('button', {name: 'Retry run history', exact: true}).click();
    assert.equal((await recovered).status(), 200);
    await settled();
    await page.getByRole('alert').filter({hasText: 'Could not load run history.'}).waitFor({state: 'detached'});
    console.log('PASS: failed run-history requests expose Retry and recover without reloading the page');
    assert.deepEqual(errors, []);
} catch (error) {
    console.error({url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 1200)});
    console.error(await page.evaluate(() => ({buttonKeys: Object.keys(document.querySelector('.filterToggle') ?? {}), scripts: [...document.scripts].map(script => script.src).filter(Boolean)})));
    throw error;
} finally {
    await context.close();
    await browser.close();
}
