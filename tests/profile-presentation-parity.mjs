/** Compare real rendered profile/tracker/AA tables in two local Docker builds. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const servers = [process.env.PERF_BASELINE_URL,process.env.PERF_BASE_URL].map(value => new URL(value));
for(const server of servers) assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname),'Local Docker URL required');
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const context = await browser.newContext(), page = await context.newPage(), errors = [];
page.on('pageerror',error => errors.push(error.message));
await context.route('**/*',route => servers.some(server => server.origin === new URL(route.request().url()).origin) ? route.continue()
    : route.request().resourceType()==='image' ? route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}) : route.abort());
const paths = ['player/NoFearr1337/','player/NoFearr1337/?days=9999','player/NoFearr1337/nethers/',
    'player/CroProYT/aa/','player/CroProYT/aa/?days=9999','player/CroProYT/runs/aa/'];
try {
    for(const path of paths) {
        const snapshots = [];
        for(const server of servers) {
            assert.equal((await page.goto(new URL(path,server).href,{waitUntil:'domcontentloaded'})).status(),200);
            await page.waitForFunction(() => [...document.querySelectorAll('table tbody tr')].some(element => Object.keys(element).some(key => key.startsWith('__reactProps$'))));
            snapshots.push(await page.locator('main table').evaluateAll(tables => tables.map(table => ({
                headings:[...table.querySelectorAll('th')].map(cell => cell.textContent.trim()),
                rows:[...table.querySelectorAll('tbody tr')].map(row => ({
                    href:row.getAttribute('href'),runId:row.getAttribute('data-run'),
                    cells:[...row.cells].map(cell => ({text:cell.textContent.trim(),
                        live:cell.querySelectorAll('.liveIndicator').length,
                        links:[...cell.querySelectorAll('a')].map(link => link.getAttribute('href')),
                        images:[...cell.querySelectorAll('img')].map(image => ({src:image.getAttribute('src'),alt:image.alt})),
                    })),
                })),
            }))));
        }
        assert.deepEqual(snapshots[1],snapshots[0],`Rendered profile table changed: ${path}`);
        console.log(`PASS: baseline profile/table parity ${path}`);
    }
    await page.goto(new URL('player/CroProYT/aa/',servers[1]).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => {const button = document.querySelector('.rangeButtons button');return button && Object.keys(button).some(key=>key.startsWith('__reactProps$'));});
    for(const [days,label] of [[1,'24 hours'],[7,'7 days'],[30,'30 days'],[9999,'Lifetime']]) {
        await page.getByRole('button',{name:label,exact:true}).click();
        await page.waitForURL(url => url.searchParams.get('days')===String(days));
        await page.waitForFunction(() => document.querySelector('.rangeButtons')?.getAttribute('aria-busy')==='false');
    }
    await page.getByRole('button',{name:'More runs',exact:true}).click();
    await page.waitForURL(/\/runs\/aa\//);
    const before = await page.locator('.recentRunsFull tbody tr').count();
    await page.getByRole('button',{name:'Load more runs',exact:true}).click();
    await page.waitForFunction(count => document.querySelectorAll('.recentRunsFull tbody tr').length > count,before);
    await page.getByRole('button',{name:'Back to Profile',exact:true}).click();
    await page.waitForURL(/\/aa\/$/);
    assert.deepEqual(errors,[]);
    console.log('PASS: AA profile ranges, More runs, next history page and Back to Profile');
} finally {await context.close();await browser.close();}
