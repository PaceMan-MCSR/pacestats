/** Local Docker production controls: keyboard activation and pending-navigation guards. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'));
const base=new URL(process.env.PERF_BASE_URL??'http://127.0.0.1:5050/stats/');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try{
    for(const path of ['', 'aa/']){
        const context=await browser.newContext({viewport:{width:1365,height:900}});
        let release=()=>{};
        try{
            await context.route('**/*',route=>{
                const url=new URL(route.request().url());
                if(url.pathname.includes('/_next/image')&&/^https?:/.test(url.searchParams.get('url')??''))
                    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                if(url.origin===base.origin)return route.continue();
                return route.request().resourceType()==='image'
                    ?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'})
                    :route.abort();
            });
            const page=await context.newPage(),navigations=[];
            page.setDefaultTimeout(30_000);
            page.on('pageerror',error=>errors.push(error.message));
            page.on('request',request=>{
                const url=new URL(request.url());
                if(request.headers().rsc==='1'&&request.headers()['next-router-prefetch']!=='1')
                    navigations.push(url.searchParams.get('category'));
            });
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1_250_000,uploadThroughput:625_000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            assert.equal((await page.goto(new URL(`${path}?days=9999`,base).href,{waitUntil:'domcontentloaded'})).status(),200);
            await page.waitForFunction(()=>{
                const toggle=document.querySelector('.filterToggle');
                return toggle&&Object.keys(toggle).some(key=>key.startsWith('__reactProps$'));
            });
            const toggle=page.getByRole('button',{name:'Toggle category',exact:true});
            await toggle.focus();await page.keyboard.press('Enter');
            const conversion=page.getByRole('button',{name:'Conversion',exact:true});
            await conversion.waitFor({state:'visible'});
            assert.equal(await toggle.getAttribute('aria-expanded'),'true');
            await conversion.focus();await page.keyboard.press('Space');
            await page.waitForURL(url=>url.searchParams.get('category')==='conversion');
            await page.waitForFunction(()=>document.querySelector('.filterGroup').style.opacity==='1');
            const fastest=page.getByRole('button',{name:'Fastest',exact:true});
            let entered;
            const started=new Promise(done=>{entered=done;});
            const gate=new Promise(done=>{release=done;});
            const delay=async route=>{
                if(route.request().headers().rsc!=='1'||new URL(route.request().url()).searchParams.get('category')!=='fastest')return route.fallback();
                entered();await gate;await route.continue().catch(()=>{});
            };
            await page.route('**/*',delay);
            const mark=navigations.length;
            await fastest.focus();await page.keyboard.press('Enter');await started;
            assert.equal(await conversion.isDisabled(),true);
            assert.equal(await page.getByRole('button',{name:'Qty + Average',exact:true}).isDisabled(),true);
            // Use a real pointer press; locator.click() would refuse a disabled control.
            await conversion.scrollIntoViewIfNeeded();
            const bounds=await conversion.boundingBox();assert.ok(bounds);
            await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
            await page.waitForTimeout(150);
            assert.deepEqual(navigations.slice(mark),['fastest'],'Pending disabled categories cannot start another navigation');
            release();await page.waitForURL(url=>url.searchParams.get('category')==='fastest');
            await page.waitForFunction(()=>document.querySelector('.filterGroup').style.opacity==='1');
            await page.unroute('**/*',delay);
            const all=page.getByRole('button',{name:'Qty + Average',exact:true});
            await all.focus();await page.keyboard.press('Enter');
            await page.waitForURL(url=>!url.searchParams.has('category'));
            assert.equal(new URL(page.url()).searchParams.get('days'),'9999');
            await toggle.focus();await page.keyboard.press('Space');
            // The collapsed grid clips mounted children; their own boxes
            // remain nonzero, so Playwright's visibility check is insufficient.
            await page.waitForFunction(()=>document.querySelector('.filterToggle')?.getAttribute('aria-expanded')==='false'
                && document.querySelector('.filterGroup .collapsePanel')?.hasAttribute('inert'));
            assert.equal(await toggle.getAttribute('aria-expanded'),'false');
            console.log(`PASS: ${path||'front'} category Enter/Space, pending disabled clicks, default category and retained range`);
        }finally{release();await context.close();}
    }
    assert.deepEqual(errors,[]);
}finally{await browser.close();}
