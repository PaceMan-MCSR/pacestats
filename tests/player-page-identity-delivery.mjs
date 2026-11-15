/** Docker-only production identity requests and header-style parity. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'), 'Use the local Docker environment');
const servers = [process.env.PERF_BASELINE_URL ?? 'http://127.0.0.1:5121/stats/',
    process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5122/stats/'].map(url => new URL(url));
for (const server of servers) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname));
const output = resolve(process.env.PERF_OUTPUT ?? 'test-artifacts/performance/cold2/identity-delivery.json');
const cases = [
    {path: 'player/CroProYT/aa/', heading: 'AA Stats for CroProYT'},
    {path: 'player/CroProYT/runs/aa/', heading: 'Recent AA runs for CroProYT'},
    {path: 'player/NoFearr1337/session/', heading: 'Session stats for NoFearr1337'},
    {path: 'player/NoFearr1337/nethers/', heading: 'Recent NPH tracker data for NoFearr1337'},
    {path: 'player/COVlD19/aa/', heading: 'AA Stats for jojoe77777', custom: true},
    {path: 'player/COVlD19/runs/aa/', heading: 'Recent AA runs for jojoe77777', custom: true},
    {path: 'player/COVlD19/session/', heading: 'Session stats for jojoe77777', custom: true},
    {path: 'player/COVlD19/nethers/', heading: 'Recent NPH tracker data for jojoe77777', custom: true},
    {path: 'player/jojoe77777/aa/', heading: 'AA Stats for jojoe77777', custom: true},
    {path: 'player/cropROyt/runs/aa/', heading: 'Recent AA runs for CroProYT'},
];
const selectors = ['nav.navbar', '.navbar-brand', '.navbar-nav .nav-link', '.searchWrapper input', '.hamburgerButton'];
const properties = ['display', 'backgroundColor', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'height', 'borderTopColor'];
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const results = [], errors = [];
try {
    for (const width of [1440, 390]) for (const item of cases) {
        const pair = [];
        for (const [index, base] of servers.entries()) {
            const context = await browser.newContext({viewport: {width, height: 900}});
            try {
                await context.route('**/*', route => {
                    const request = route.request();
                    const url = new URL(request.url());
                    if (url.pathname.includes('/_next/image') && /^https?:/.test(url.searchParams.get('url') ?? '')) {
                        return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    }
                    if (url.origin === base.origin) return route.continue();
                    if (request.resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    return route.abort();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(45_000);
                page.on('pageerror', error => errors.push({path: item.path, index, message: error.message}));
                const requests = [], responses = [];
                page.on('request', request => {
                    if (new URL(request.url()).pathname === '/stats/api/getPlayerInfo/') requests.push(request.url());
                });
                page.on('response', response => {
                    if (new URL(response.url()).pathname === '/stats/api/getPlayerInfo/') responses.push(response.json());
                });
                const response = await page.goto(new URL(item.path, base).href, {waitUntil: 'load'});
                assert.equal(response.status(), 200, item.path);
                // The heading's avatar alt repeats the nickname in its
                // accessible name; compare the displayed text instead.
                await page.waitForFunction(heading => document.querySelector('main h1')?.textContent.trim() === heading, item.heading);
                await page.waitForFunction(() => {
                    const element = document.querySelector('.navbar-brand');
                    return element && Object.keys(element).some(key => key.startsWith('__reactProps$'));
                });
                const pathName = item.path.split('/')[1].toLocaleLowerCase();
                const lookupName = pathName === 'jojoe77777' ? 'covld19' : pathName;
                if (index) await page.waitForFunction(name => Boolean(window.__pacePlayerInfo?.[name]), lookupName);
                if (index === 0) {
                    const deadline = Date.now() + 10_000;
                    while (!responses.length && Date.now() < deadline) await page.waitForTimeout(20);
                    assert.ok(responses.length, `${item.path}: baseline header lookup completes`);
                }
                await Promise.all(responses);
                await page.evaluate(() => document.fonts.ready);
                await page.waitForTimeout(200);
                if (item.custom) {
                    const nav = page.locator('nav.navbar').first();
                    await page.waitForFunction(() => getComputedStyle(document.querySelector('nav.navbar')).backgroundColor !== 'rgb(33, 37, 41)');
                    assert.equal(await nav.evaluate(element => element.classList.contains('navbar-dark')), false);
                }
                const styles = await page.evaluate(({selectors, properties}) => Object.fromEntries(selectors.map(selector => [selector,
                    [...document.querySelectorAll(selector)].map(element => {
                        const computed = getComputedStyle(element);
                        return Object.fromEntries(properties.map(property => [property, computed[property]]));
                    }),
                ])), {selectors, properties});
                const seed = await page.evaluate(name => window.__pacePlayerInfo?.[name], lookupName);
                assert.equal(requests.length, index ? 0 : 1, `${item.path}: fresh browser header requests`);
                if (index) {
                    assert.ok(seed?.id, `${item.path}: initial HTML contains the identity seed`);
                    if (item.custom) assert.deepEqual(seed, {id: '45356178-b67b-4a36-83af-be61d3e09c46',
                        displayName: 'jojoe77777', color: '4287f5', bgColor: '040e1f'});
                }
                if (width < 576) {
                    await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
                    await page.locator('.mobileDrawer').waitFor();
                    styles.drawer = await page.locator('.mobileDrawer').evaluate(element => {
                        const style = getComputedStyle(element); return {backgroundColor: style.backgroundColor, color: style.color};
                    });
                    await page.keyboard.press('Escape');
                }
                pair.push(styles);
                results.push({path: item.path, width, kind: index ? 'final' : 'baseline', identityRequests: requests.length, seed, styles});
            } finally {await context.close();}
        }
        assert.deepEqual(pair[1], pair[0], `${item.path}: computed header style parity at ${width}px`);
        console.log(`PASS: ${item.path} width=${width}, identity API requests 1→0, same header styles`);
    }
    assert.deepEqual(errors, []);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify({results, errors}, null, 2)}\n`);
} finally {await browser.close();}
