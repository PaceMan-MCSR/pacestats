/** Local Docker: OBS inputs produce valid URLs and bounded precision cannot crash previews. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'));
const base=new URL(process.env.PERF_BASE_URL??'http://127.0.0.1:5050/stats/');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext(),requests=[],errors=[],sockets=[];
let zero=false;
try{
    await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
        if(url.pathname==='/stats/api/getPlayerNames/')return json(['NoFearr1337']);
        if(url.pathname==='/stats/api/searchPlayers/')return json([{id:'fixture',name:'NoFearr1337',color:null}]);
        if(url.pathname==='/stats/api/getPlayerInfo/')return json({nofearr1337:{id:'fixture',nick:'NoFearr1337',displayName:null,color:null,bgColor:null}});
        if(['/stats/api/getSessionNethers/','/stats/api/getSessionStats/'].includes(url.pathname)){
            requests.push(Object.fromEntries(url.searchParams));
            return json(url.pathname.includes('getSessionNethers')?{count:7,avg:'1:00',rnph:zero?0:1.25}:{nether:{count:7,avg:'1:00'}});
        }
        if(url.pathname.includes('/_next/image')&&/^https?:/.test(url.searchParams.get('url')??''))
            return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
        if(url.origin===base.origin)return route.continue();
        return route.request().resourceType()==='image'
            ?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'})
            :route.abort();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>sockets.push(socket.url()));
    assert.equal((await page.goto(new URL('obs/',base).href,{waitUntil:'domcontentloaded'})).status(),200);
    const search=page.locator('.obsSetup .nameSearch input');
    await page.waitForFunction(()=>{
        const input=document.querySelector('.obsSetup .nameSearch input');
        return input&&Object.keys(input).some(key=>key.startsWith('__reactProps$'));
    });
    await search.fill('NoFearr');
    await page.locator('.obsSetup .nameSearch li[data-test="result"]').first().click();
    await page.locator('.urlBox').first().waitFor();
    const urls=()=>page.locator('.urlBox p').allTextContents();
    const edit=async(selector,value,expected)=>{
        const field=page.locator(selector);await field.fill(value);await field.press('Tab');
        assert.equal(await field.inputValue(),String(expected));
    };
    for(const [raw,expected]of [['-1',1],['0',1],['1.9',1],['10000000',9999999],['',24]]){
        await edit('input[aria-label="Time period (hours)"]',raw,expected);
        for(const value of await urls())assert.equal(new URL(value.trim(),base).searchParams.get('hours'),String(expected));
    }
    for(const [raw,expected]of [['-1',0],['0',0],['2.9',2],['10000000',9999999],['',2]]){
        await edit('input[aria-label="Max session break (hours)"]',raw,expected);
        for(const value of await urls())assert.equal(new URL(value.trim(),base).searchParams.get('hoursBetween'),String(expected));
    }
    for(const [raw,expected]of [['-1',0],['4',3],['2.9',2],['',0]]){
        await edit('input.avgDp',raw,expected);
        assert.equal(new URL((await urls())[0].trim(),base).searchParams.get('dp'),String(expected));
    }
    for(const [raw,expected]of [['-1',0],['101',100],['1000000',100],['4',4],['',0]]){
        await edit('input.nphDp',raw,expected);
        assert.equal(new URL((await urls())[0].trim(),base).searchParams.get('nphDp'),String(expected));
    }
    await edit('input[aria-label="Time period (hours)"]','-1',1);
    await page.getByRole('button',{name:'Preview updated hours',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.sessionNethers.demoBrowser h1')?.textContent.trim()==='7');
    console.log('PASS: OBS draft/blur bounds, generated URLs, preview updates and valid four-digit NPH precision');

    for(const [precision,expected]of [['101','1.'+'25'+'0'.repeat(98)],['-1','1'],['NaN','1'],['4','1.2500']]){
        await page.goto(new URL(`obs/sessionNethers/NoFearr1337/?demo=true&nph=true&nphDp=${precision}`,base).href,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('.sessionNethers h1')?.textContent.trim()==='7');
        await page.waitForFunction(value=>document.querySelectorAll('.sessionNethers h1')[2]?.textContent.trim()===value,expected);
    }
    zero=true;
    await page.goto(new URL('obs/sessionNethers/NoFearr1337/?demo=true&nph=true&nphDp=1000000000',base).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(value=>document.querySelectorAll('.sessionNethers h1')[2]?.textContent.trim()===value,'0.'+'0'.repeat(100));
    for(const params of requests){
        assert.ok(Number.isSafeInteger(Number(params.hours))&&Number(params.hours)>=1&&Number(params.hours)<=9999999);
        assert.ok(Number.isSafeInteger(Number(params.hoursBetween))&&Number(params.hoursBetween)>=0&&Number(params.hoursBetween)<=9999999);
        if(params.dp!==undefined)assert.ok(Number.isSafeInteger(Number(params.dp))&&Number(params.dp)>=0&&Number(params.dp)<=3);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(sockets,[]);
    console.log('PASS: direct precision URLs cannot throw toFixed errors or allocate unbounded zero strings; no invalid requests or demo sockets');
}finally{await context.close();await browser.close();}
