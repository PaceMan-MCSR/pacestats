/** Local Docker regression: real disabled-button mouse/touch events and URL/API bounds. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const base=new URL(process.env.PERF_BASE_URL??'http://127.0.0.1:5050/stats/');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try{
    for(const touch of [false,true]){
        const context=await browser.newContext({viewport:{width:touch?390:1365,height:900},hasTouch:touch,isMobile:touch});
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
            const page=await context.newPage(),requests=[];
            page.setDefaultTimeout(30_000);
            page.on('pageerror',error=>errors.push(error.message));
            page.on('request',request=>{
                const url=new URL(request.url());
                if(url.pathname==='/stats/api/getPlayerRuns/')requests.push(Object.fromEntries(url.searchParams));
            });
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1_250_000,uploadThroughput:625_000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            const previous=page.getByRole('button',{name:'Go to previous page',exact:true});
            const next=page.getByRole('button',{name:'Go to next page',exact:true});
            const settled=()=>page.locator('.fastRunsGrid[aria-busy="false"]').waitFor();
            const ready=async()=>{
                await settled();
                await page.waitForFunction(()=>{
                    const button=document.querySelector('.fastRunsPageButton');
                    return button&&Object.keys(button).some(key=>key.startsWith('__reactProps$'));
                });
            };
            const flush=async()=>{
                await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
                await page.waitForTimeout(250);
            };
            const press=async button=>{
                await button.scrollIntoViewIfNeeded();
                const bounds=await button.boundingBox();assert.ok(bounds);
                const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
                if(touch)await page.touchscreen.tap(x,y);
                else await page.mouse.click(x,y);
                await flush();
            };
            const atPage=async expected=>{
                await page.waitForFunction(value=>Number(new URLSearchParams(location.search).get('page')??0)===value,expected);
                await settled();
            };
            const go=async query=>{
                assert.equal((await page.goto(new URL(`player/NoFearr1337/runs/?${query}`,base).href,{waitUntil:'domcontentloaded'})).status(),200);
                await ready();
            };
            const assertRequestsValid=()=>{
                assert.deepEqual(requests.filter(params=>!Number.isSafeInteger(Number(params.page))||Number(params.page)<0||Number(params.page)>1_000_000),[],`Invalid page request at ${page.url()}`);
                assert.ok(requests.every(params=>JSON.parse(params.filters??'[]').length<=10),'No request exceeds the API filter cap');
            };

            await go('page=0&pageSize=25&sort=date&direction=desc');
            assert.equal(await previous.isDisabled(),true);
            await press(previous);assertRequestsValid();await atPage(0);
            assert.equal(await page.getByRole('alert').filter({hasText:'Could not load run history.'}).count(),0);
            console.log(`PASS: ${touch?'touch':'mouse'} cannot activate the disabled first-page arrow`);

            if(!touch){
                await next.focus();await page.keyboard.press('Enter');await atPage(1);
                await previous.focus();await page.keyboard.press('Space');await atPage(0);
            }
            await press(next);await atPage(1);await flush();
            assert.equal(new URL(page.url()).searchParams.get('page'),'1','Pointer-down plus click changes only one page');
            await press(previous);await atPage(0);
            const total=Number((await page.locator('.fastRunsPageRange').innerText()).match(/of (\d+)/)[1]);
            const last=Math.max(0,Math.ceil(total/25)-1);
            assert.ok(last>1,'Populated local history is required');
            await go(`page=${last}&pageSize=25`);
            assert.equal(await next.isDisabled(),true);
            const mark=requests.length;
            await press(next);await atPage(last);
            assert.ok(!requests.slice(mark).some(params=>Number(params.page)>last));
            assertRequestsValid();
            console.log(`PASS: ${touch?'touch':'mouse'} last-page boundary and enabled navigation`);

            await go('page=0&pageSize=25');
            await page.getByRole('button',{name:'Filters',exact:true}).click();
            await page.getByRole('button',{name:'Sub 2 Enter',exact:true}).click();
            await page.getByRole('textbox',{name:'Filter 1 time',exact:true}).fill('0:00');
            await page.locator('.fastRunsGridEmpty').waitFor();await settled();
            assert.equal(await page.locator('.fastRunsPageRange').innerText(),'0–0 of 0');
            assert.equal(await previous.isDisabled(),true);assert.equal(await next.isDisabled(),true);
            await press(previous);await press(next);await atPage(0);assertRequestsValid();
            console.log(`PASS: ${touch?'touch':'mouse'} empty results disable both arrows`);

            await page.getByRole('button',{name:'Reset all filters',exact:true}).click();
            const add=page.getByRole('button',{name:'Add filter',exact:true});
            for(let index=0;index<10;index++){
                await add.click();
                await page.waitForFunction(count=>document.querySelectorAll('.runFilterRow').length===count,index+1);
            }
            assert.equal(await add.isDisabled(),true,'The editor respects the API ten-filter limit');
            await press(add);
            assert.equal(await page.locator('.runFilterRow').count(),10);
            await page.getByRole('button',{name:'Remove filter 5',exact:true}).click();
            assert.equal(await add.isEnabled(),true);
            await add.focus();await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.querySelectorAll('.runFilterRow').length===10);
            await settled();assertRequestsValid();
            assert.equal(await page.getByRole('alert').filter({hasText:'Could not load run history.'}).count(),0);
            console.log(`PASS: ${touch?'touch':'mouse'} filter limit, removal and keyboard re-add`);

            if(!touch){
                for(const query of ['page=-1','page=1.5','page=NaN','page=Infinity','page=1000001','page=0&pageSize=0']){
                    await go(query);await atPage(0);
                    assert.equal(await page.locator('.fastRunsGridRow').count(),25);
                    assertRequestsValid();
                }
                await go(`page=${last+5}&pageSize=25`);await atPage(last);
                assert.ok(await page.locator('.fastRunsGridRow').count()>0);
                await page.getByRole('combobox',{name:'Rows per page:',exact:true}).selectOption('100');
                await atPage(0);
                await page.waitForFunction(()=>document.querySelectorAll('.fastRunsGridRow').length===100);
                assertRequestsValid();
                console.log('PASS: malformed/oversized page URLs recover, expired last pages recover, and changing page size resets to zero');
            }
        }finally{await context.close();}
    }
    assert.deepEqual(errors,[]);
}finally{await browser.close();}
