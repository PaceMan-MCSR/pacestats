/** Production Docker style parity, interactions and cold client-navigation resource ordering. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'), 'Use the local Docker environment');
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const servers = [process.env.PERF_BASELINE_URL ?? 'http://127.0.0.1:5101/stats/',
    process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5102/stats/'].map(value => new URL(value));
for (const server of servers) assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname));
const output = resolve(process.env.PERF_OUTPUT ?? 'test-artifacts/performance/bundles/route-css-parity.json');
const shared = ['body','nav.navbar','.navbar-brand','.navbar-nav .nav-link','.searchWrapper','.searchBox .wrapper','.searchBox input',
    '.main','.main .container','.main .header','.main .subheader','.rangeButtons','.rangeButtons button','.filterGroup',
    '.filterToggle','.filterButtons','.collapsePanel','.tableWrapper','.tableWrapper .tableHeader','.table','.table th','.table td','.avatar'];
const routes = [
    {id:'front',path:'?days=9999',selectors:[]},
    {id:'aa',path:'aa/?days=9999',selectors:[]},
    {id:'profile',path:'player/NoFearr1337/?days=9999',selectors:['.playerStats','.playerStats .header','.playerStats .stat',
        '.playerStats .stat h4','.playerStats .twitch','.playerSkin','.recentContainer','.recentRuns','.openHistory button','.statHeader div']},
    {id:'history',path:'player/NoFearr1337/runs/',selectors:['.fastRunsGrid','.fastRunsGridHeader','.fastRunsGridRow','.fastRunsGridCell',
        '.fastRunsGridPagination','.fastRunsPageSize','.fastRunsPageButton','.runsBackButton']},
    {id:'aa-history',path:'player/CroProYT/runs/aa/',selectors:['.recentRunsFull','.titleHead','.btn','.recentRunsFull td']},
    {id:'obs',path:'obs/',selectors:['.obsSetup','.settings','.hours','.nameSearch','.font-wrapper','.colorPicker','.colorPickerInput input',
        '.sessionNethers','.sessionStats','.demoBrowser','.urlBox','.sizeHint','.avgDp','.nphDp','.fontExample']},
];
const properties = ['display','position','color','backgroundColor','backgroundImage','fontFamily','fontSize','fontWeight','lineHeight',
    'textAlign','whiteSpace','verticalAlign','boxSizing','width','height','minWidth','maxWidth','minHeight','maxHeight',
    'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft',
    'borderTopColor','borderTopStyle','borderTopWidth','borderRightColor','borderRightStyle','borderRightWidth','borderRadius',
    'gap','gridTemplateColumns','gridTemplateRows','transform','transformOrigin','overflowX','overflowY','opacity','visibility','zIndex','filter'];
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const errors = [], results = [], navigation = [];
async function contextFor(base,width) {
    const context = await browser.newContext({viewport:{width,height:900}});
    await context.route('**/*',route => {
        if (new URL(route.request().url()).origin === base.origin) return route.continue();
        if (route.request().resourceType() === 'image') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
        return route.abort();
    });
    const page = await context.newPage();page.setDefaultTimeout(30_000);
    page.on('pageerror',error => errors.push(error.message));
    return {context,page};
}
async function ready(page,id) {
    await page.locator('.main').first().waitFor({state:'attached'});
    if (id === 'front' || id === 'aa') {
        await page.waitForFunction(() => document.querySelectorAll('.stats-row:not([aria-busy="true"]) tbody tr').length > 0);
    } else if (id === 'history') await page.locator('.fastRunsGridRow').first().waitFor();
    else if (id === 'aa-history') await page.locator('tbody tr').first().waitFor();
    else if (id === 'profile') await page.locator('.playerStats .stat').first().waitFor();
    else if (id === 'obs') await page.locator('.obsSetup .nameSearch input').waitFor();
    await page.waitForFunction(() => {
        const element = document.querySelector('.navbar-brand,.hamburgerButton');
        return element && Object.keys(element).some(key => key.startsWith('__reactProps$'));
    });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0,0);
    await page.waitForTimeout(100);
}
async function capture(page,selectors) {
    return page.evaluate(({selectors,properties}) => Object.fromEntries(selectors.map(selector => [selector,
        [...document.querySelectorAll(selector)].slice(0,3).map(element => {
            const style = getComputedStyle(element);
            const values = Object.fromEntries(properties.map(property => [property,style[property]]));
            if (element.matches('input')) values.placeholderColor = getComputedStyle(element,'::placeholder').color;
            return values;
        }),
    ])),{selectors:[...shared,...selectors],properties});
}
async function prepareObs(page) {
    await page.locator('.obsSetup .nameSearch input').fill('NoFearr1337');
    await page.locator('.obsSetup .nameSearch li').first().click();
    await page.locator('.obsSetup .sessionNethers').waitFor();
    await page.locator('.obsSetup .sessionStats').waitFor();
    await page.waitForTimeout(100);
}
try {
    for (const width of [1440,390]) for (const route of routes) {
        const pair = [];
        for (let index=0;index<servers.length;index++) {
            const {context,page} = await contextFor(servers[index],width);
            try {
                await page.goto(new URL(route.path,servers[index]).href,{waitUntil:'domcontentloaded'});
                await ready(page,route.id);
                if (route.id === 'obs') await prepareObs(page);
                const normal = await capture(page,route.selectors), states = {normal};
                if (route.id === 'front' || route.id === 'aa') {
                    await page.getByRole('button',{name:'Toggle category',exact:true}).click();
                    await page.locator('.collapsePanel.open').waitFor();
                    await page.waitForTimeout(400);
                    states.filters = await capture(page,['.filterButtons button','.collapsePanelInner']);
                }
                if (route.id === 'profile') {
                    // Exercise the actual custom-colour selectors on real
                    // profile markup even when the local player has defaults.
                    await page.evaluate(() => {
                        const variables={'--cc-fg':'#445566','--cc-fg-90':'#102030','--cc-fg-80':'#203040',
                            '--cc-fg-70':'#304050','--cc-fg-60':'#405060','--cc-bg':'#334455','--cc-name':'#00aaff',
                            '--cc-fg-text':'#defabc','--cc-bg-text':'#aabbcc','--cc-fg-text-filter':'none','--cc-bg-text-filter':'none'};
                        const card=document.querySelector('.playerStats .nph');
                        if(!card?.querySelector('.openHistory button')) throw new Error('Local lifetime fixture requires the tracked-nether card');
                        card.classList.add('ccStat');
                        card.querySelector('.openHistory').classList.add('ccOpenHistory');
                        const recent=document.querySelector('.recentRuns table')?.parentElement;
                        recent?.classList.add('ccRecentRuns');
                        for(const element of [card,recent].filter(Boolean)) for(const [name,value] of Object.entries(variables)) element.style.setProperty(name,value);
                    });
                    await page.waitForTimeout(180);
                    const selectors=['.nph.ccStat','.nph.ccStat h4','.openHistory.ccOpenHistory button','.ccRecentRuns .table','.ccRecentRuns .table td'];
                    states.custom=await capture(page,selectors);
                    assert.equal(states.custom['.openHistory.ccOpenHistory button'][0].backgroundColor,'rgb(16, 32, 48)');
                    await page.locator('.openHistory button').hover();
                    await page.waitForTimeout(180);
                    states.customHover=await capture(page,selectors);
                    assert.equal(states.customHover['.openHistory.ccOpenHistory button'][0].backgroundColor,'rgb(32, 48, 64)');
                    await page.mouse.move(0,0);
                }
                if (width < 576) {
                    await page.getByRole('button',{name:'Open navigation'}).click();
                    await page.locator('.mobileDrawer').waitFor();
                    states.drawer = await capture(page,['.mobileDrawerRoot','.mobileDrawerBackdrop','.mobileDrawer','.mobileDrawer > a','.mobileDrawer input']);
                    await page.keyboard.press('Escape');
                    await page.locator('.mobileDrawer').waitFor({state:'detached'});
                }
                pair.push(states);
            } finally {await context.close();}
        }
        assert.deepEqual(pair[1],pair[0],`Computed styles differ: ${route.id}, width=${width}`);
        results.push({route:route.id,width,styles:pair[1]});
        console.log(`PASS styles: ${route.id} width=${width}`);
    }

    // Real client links get clicked immediately, without waiting through the
    // hover-prefetch delay. This exposes CSS that starts only after RSC arrives.
    for (let index=0;index<servers.length;index++) {
        const base=servers[index],{context,page}=await contextFor(base,1440),steps=[];
        try {
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1250000,uploadThroughput:625000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            const requests=[];
            page.on('request',request=>requests.push({url:request.url(),type:request.resourceType(),
                rsc:request.headers().rsc??null,prefetch:request.headers()['next-router-prefetch']??null}));
            await page.goto(base.href,{waitUntil:'domcontentloaded'});
            await ready(page,'front');
            const originalFront=await capture(page,[]);
            await page.getByRole('button',{name:'Lifetime',exact:true}).click();
            await page.waitForURL(url=>url.searchParams.get('days')==='9999');
            await page.waitForFunction(()=>document.querySelector('.rangeButtons')?.getAttribute('aria-busy')==='false');
            await ready(page,'front');
            async function step(name,action,id) {
                const start=await page.evaluate(()=>performance.now()), requestStart=requests.length;
                await action();await ready(page,id);
                const timing=await page.evaluate(start=>({readyMs:performance.now()-start,
                    resources:performance.getEntriesByType('resource').filter(entry=>entry.startTime>=start).map(entry=>({
                        url:entry.name,initiator:entry.initiatorType,startMs:entry.startTime-start,
                        responseStartMs:entry.responseStart-start,responseEndMs:entry.responseEnd-start,
                        duration:entry.duration,bytes:entry.transferSize,
                    }))}),start);
                steps.push({name,...timing,requests:requests.slice(requestStart)});
            }
            const playerLink=page.locator('a.boardLink[href*="/NoFearr1337/"]').first();
            assert.ok(await playerLink.count(),'The local lifetime fixture includes NoFearr1337');
            await step('front-to-profile',()=>playerLink.click(),'profile');
            const originalProfile=await capture(page,routes.find(route=>route.id==='profile').selectors);
            await step('profile-to-history',()=>page.getByRole('button',{name:'More runs',exact:true}).click(),'history');
            await step('history-to-profile',()=>page.locator('.runsBackButton').click(),'profile');
            assert.deepEqual(await capture(page,routes.find(route=>route.id==='profile').selectors),originalProfile,
                'A return from history keeps profile layout/theme styles');
            await step('profile-to-front',()=>page.locator('nav.navbar:visible').getByRole('link',{name:'Leaderboards',exact:true}).click(),'front');
            assert.deepEqual(await capture(page,[]),originalFront,'Loaded profile/history CSS cannot alter the front page');
            const obsLink=page.locator('nav.navbar:visible').getByRole('link',{name:'OBS Overlays',exact:true});
            await step('front-to-obs',()=>obsLink.click(),'obs');
            await prepareObs(page);
            await step('obs-to-front',()=>page.locator('nav.navbar:visible').getByRole('link',{name:'Leaderboards',exact:true}).click(),'front');
            assert.deepEqual(await capture(page,[]),originalFront,'Loaded OBS CSS cannot alter the front page');
            navigation.push({label:index?'candidate':'baseline',steps});
            console.log(`PASS client navigation/resource trace: ${index?'candidate':'baseline'}`);
        } finally {await context.close();}
    }
    assert.deepEqual(errors,[]);
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({checks:'computed desktop/mobile styles, filters, drawer, selected OBS previews, bidirectional client navigation, cold immediate-click RSC/CSS ordering',results,navigation,errors},null,2));
    console.log(JSON.stringify({styleCases:results.length,navigationCases:navigation.length*6,output}));
} finally {await browser.close();}
