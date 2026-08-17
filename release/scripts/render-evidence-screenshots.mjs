import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import puppeteer from 'puppeteer-core';

const PROJECT_ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const TEST_RESULTS_PATH=resolve(PROJECT_ROOT,'release/files/test-results.json');
const COVERAGE_RESULTS_PATH=resolve(PROJECT_ROOT,'release/files/coverage-summary.json');
const TEST_SCREENSHOT_PATH=resolve(PROJECT_ROOT,'docs/assets/vanilla-test-results.png');
const COVERAGE_SCREENSHOT_PATH=resolve(PROJECT_ROOT,'docs/assets/chrome-coverage-results.png');
const SUITE_NAMES=Object.freeze(['Unit','Functional','Integration','Regression']);
const MODULE_PATHS=Object.freeze([
    'arcane/modules/AppDataScope.js',
    'arcane/modules/DBOPFS.js',
    'arcane/modules/DBOPFSWorker.js'
]);

function assert(condition,message){
    if(!condition){
        throw new Error(message);
    }
}

async function readJSON(filePath){
    return JSON.parse(await readFile(filePath,'utf8'));
}

function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,character=>({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#39;'
    })[character]);
}

function number(value){
    return new Intl.NumberFormat('en-US').format(value);
}

function validateTestResults(results){
    assert(results?.complete===true,'Test evidence is not marked complete.');
    assert(results?.driver?.status==='passed','The browser test driver did not pass.');
    assert(results?.teardown?.status==='passed','The browser test teardown did not pass.');
    assert(!results.fatalError,'The browser test evidence contains a fatal error.');
    assert(results?.framework?.name==='vanilla-test','The test evidence did not use vanilla-test.');
    assert(Array.isArray(results.cases),'The test evidence has no case registry.');
    assert(Array.isArray(results.suites)&&results.suites.length===SUITE_NAMES.length,
        'The test evidence must contain exactly four suites.');

    const ids=new Set();
    const descriptions=new Set();
    for(const testCase of results.cases){
        assert(typeof testCase.id==='string'&&testCase.id.length>0,
            'A test case has no stable ID.');
        assert(typeof testCase.description==='string'&&testCase.description.length>0,
            `${testCase.id} has no description.`);
        assert(!ids.has(testCase.id),`Duplicate test ID: ${testCase.id}.`);
        assert(!descriptions.has(testCase.description),
            `Duplicate test description: ${testCase.description}.`);
        assert(SUITE_NAMES.includes(testCase.suite),`${testCase.id} has an unknown suite.`);
        assert(['failed','passed','skipped'].includes(testCase.status),
            `${testCase.id} has an unknown status.`);
        ids.add(testCase.id);
        descriptions.add(testCase.description);
    }

    const aggregate={failed:0,passed:0,skipped:0,total:0};
    results.suites.forEach((suite,index)=>{
        assert(suite.name===SUITE_NAMES[index],
            `Expected ${SUITE_NAMES[index]} at suite position ${index+1}.`);
        const cases=results.cases.filter(testCase=>testCase.suite===suite.name);
        const expected={
            failed:cases.filter(testCase=>testCase.status==='failed').length,
            passed:cases.filter(testCase=>testCase.status==='passed').length,
            skipped:cases.filter(testCase=>testCase.status==='skipped').length,
            total:cases.length
        };
        for(const key of Object.keys(expected)){
            assert(suite[key]===expected[key],`${suite.name} has an inconsistent ${key} total.`);
            aggregate[key]+=expected[key];
        }
    });
    for(const key of Object.keys(aggregate)){
        assert(results.summary?.[key]===aggregate[key],
            `The test summary has an inconsistent ${key} total.`);
    }
    assert(results.summary.failed===0,'Failing tests cannot be rendered as passing evidence.');
}

function validateCoverageResults(coverage){
    assert(Array.isArray(coverage?.files)&&coverage.files.length===MODULE_PATHS.length,
        'Coverage evidence must contain all three runtime modules.');
    const coveredBytes=coverage.files.reduce((total,file)=>total+file.coveredBytes,0);
    const totalBytes=coverage.files.reduce((total,file)=>total+file.totalBytes,0);
    assert(coveredBytes===coverage.total?.coveredBytes,
        'Coverage file bytes do not match the overall covered byte count.');
    assert(totalBytes===coverage.total?.totalBytes,
        'Coverage file bytes do not match the overall total byte count.');
    coverage.files.forEach((file,index)=>{
        assert(file.modulePath===MODULE_PATHS[index],
            `Expected ${MODULE_PATHS[index]} at coverage position ${index+1}.`);
        const percent=Number(((file.coveredBytes/file.totalBytes)*100).toFixed(2));
        assert(percent===file.byteCoveragePercent,
            `${file.modulePath} has an inconsistent coverage percentage.`);
    });
    const percent=Number(((coveredBytes/totalBytes)*100).toFixed(2));
    assert(percent===coverage.total.byteCoveragePercent,
        'The total coverage percentage is inconsistent.');
}

function chromeCandidates(){
    const environment=process.env;
    const candidates=[
        environment.CHROME_PATH,
        environment.PUPPETEER_EXECUTABLE_PATH
    ];
    const programFiles=environment.ProgramFiles||environment.PROGRAMFILES;
    const programFilesX86=environment['ProgramFiles(x86)']||environment['PROGRAMFILES(X86)'];
    const localAppData=environment.LOCALAPPDATA;
    if(programFiles){
        candidates.push(resolve(programFiles,'Google/Chrome/Application/chrome.exe'));
    }
    if(programFilesX86){
        candidates.push(resolve(programFilesX86,'Google/Chrome/Application/chrome.exe'));
    }
    if(localAppData){
        candidates.push(resolve(localAppData,'Google/Chrome/Application/chrome.exe'));
    }
    candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    );
    return [...new Set(candidates.filter(Boolean).map(candidate=>resolve(candidate)))];
}

function findChrome(){
    const executablePath=chromeCandidates().find(candidate=>existsSync(candidate));
    if(!executablePath){
        throw new Error('Google Chrome was not found for evidence screenshot rendering.');
    }
    return executablePath;
}

function shell(title,content,footer){
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:1500px;background:#050c17;color:#e6e1f6}
body{min-height:780px;padding:54px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:radial-gradient(circle at 0 100%,#07383b 0,transparent 30%),linear-gradient(135deg,#050c17 45%,#211a31)}
.window{overflow:hidden;border:1px solid #40506b;border-radius:23px;background:#0d1425;box-shadow:0 24px 60px #0007}
.bar{display:flex;align-items:center;gap:11px;height:51px;padding:0 23px;border-bottom:1px solid #40506b;background:#172033;font-size:13px;font-weight:700;letter-spacing:.04em}
.dot{width:11px;height:11px;border-radius:50%}.red{background:#ff7890}.yellow{background:#e8b64f}.teal{background:#4fd5c9}.bar-title{margin-left:8px;color:#fff}
main{padding:34px 38px 30px}.eyebrow{margin:0 0 11px;color:#ffc147;font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;color:#fff7ec;font:500 40px/1.05 Georgia,serif}.lede{margin:12px 0 23px;color:#cdc0ee;font:16px/1.45 system-ui,sans-serif}
.chips{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:25px}.chip{padding:9px 15px;border:1px solid #675191;border-radius:999px;background:#241c3d;color:#f0ddff;font-size:12px;font-weight:700}.chip.pass{border-color:#168f87;background:#093d3f;color:#68ffe7}
.footer{margin:24px 0 0;color:#9db2dc;font-size:11px;letter-spacing:.02em}
${content.css}
</style>
</head>
<body>
<section class="window">
<div class="bar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot teal"></span><span class="bar-title">${escapeHTML(title)}</span></div>
<main>${content.html}<p class="footer">${footer}</p></main>
</section>
</body>
</html>`;
}

function testEvidenceHTML(results){
    const browser=String(results.driver.browserVersion||'Google Chrome').replace('/',' ');
    const suiteColumns=results.suites.map(suite=>{
        const cases=results.cases.filter(testCase=>testCase.suite===suite.name);
        const rows=cases.map(testCase=>`<li>
<div class="case-top"><code>${escapeHTML(testCase.id)}</code><span>${Number(testCase.durationMs).toFixed(1)} ms</span></div>
<div class="case-description">${escapeHTML(testCase.description)}</div>
<div class="case-status ${escapeHTML(testCase.status)}">${escapeHTML(testCase.status)}</div>
</li>`).join('');
        return `<section class="suite">
<header><div><span class="suite-name">${escapeHTML(suite.name)}</span><span class="suite-total">${suite.total} cases</span></div><strong>${suite.passed}/${suite.total}</strong></header>
<ol>${rows}</ol>
</section>`;
    }).join('');
    const content={
        css:`
.suite-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;align-items:start}
.suite{overflow:hidden;border:1px solid #34435e;border-radius:13px;background:#0a1120}.suite header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px;border-bottom:1px solid #34435e;background:#141d30}.suite header div{display:grid;gap:3px}.suite-name{color:#78f7df;font:800 15px/1.1 system-ui,sans-serif}.suite-total{color:#99a9c8;font-size:9px}.suite header strong{color:#78f7df;font-size:13px}
.suite ol{margin:0;padding:0;list-style:none}.suite li{position:relative;min-height:56px;padding:8px 9px 9px;border-top:1px solid #233149}.suite li:first-child{border-top:0}.case-top{display:flex;justify-content:space-between;gap:7px;color:#8ea8dd;font-size:8px}.case-top code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.case-top span{flex:none}.case-description{margin-top:5px;padding-right:40px;color:#f5f1ff;font:600 10px/1.28 system-ui,sans-serif}.case-status{position:absolute;right:8px;bottom:9px;font-size:7px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.case-status.passed{color:#61f6d9}.case-status.failed{color:#ff8799}.case-status.skipped{color:#ffc65f}`,
        html:`<p class="eyebrow">Real-origin OPFS verification</p>
<h1>vanilla-test ${escapeHTML(results.framework.version)}</h1>
<p class="lede">Four focused suites · unchanged production DBOPFS runtime · ${escapeHTML(browser)}</p>
<div class="chips"><span class="chip pass">${results.summary.passed} passed</span><span class="chip">${results.summary.failed} failed</span><span class="chip">${results.summary.skipped} skipped</span><span class="chip">${results.summary.total} unique cases</span></div>
<div class="suite-grid">${suiteColumns}</div>`
    };
    return shell(
        'release/test · Google Chrome',
        content,
        `Source: release/files/test-results.json · Recorded ${escapeHTML(String(results.finishedAt).slice(0,10))} · IDs and values read from evidence`
    );
}

function coverageEvidenceHTML(coverage,results){
    const rows=coverage.files.map(file=>{
        const unused=Number((100-file.byteCoveragePercent).toFixed(2));
        return `<div class="coverage-row">
<div><strong>${escapeHTML(file.modulePath)}</strong><span>${number(file.coveredBytes)} / ${number(file.totalBytes)} executed bytes</span></div>
<div class="meter"><i style="width:${file.byteCoveragePercent}%"></i></div>
<b>${file.byteCoveragePercent.toFixed(2)}%</b><em>${unused.toFixed(2)}%</em>
</div>`;
    }).join('');
    const content={
        css:`
.coverage-head{display:grid;grid-template-columns:1.3fr 1fr 110px 110px;gap:24px;padding:0 12px 10px;border-bottom:1px solid #34435e;color:#8da7da;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.coverage-rows{display:grid}.coverage-row{display:grid;grid-template-columns:1.3fr 1fr 110px 110px;align-items:center;gap:24px;min-height:78px;padding:13px 12px;border-bottom:1px solid #34435e}.coverage-row>div:first-child{display:grid;gap:8px}.coverage-row strong{color:#fff;font-size:12px}.coverage-row span{color:#8da7da;font-size:10px}.meter{overflow:hidden;height:12px;border:1px solid #40506b;border-radius:999px;background:#222d45}.meter i{display:block;height:100%;background:linear-gradient(90deg,#14837e,#4ee0d2)}.coverage-row b{color:#61f6d9;font-size:12px}.coverage-row em{color:#ffc147;font-size:11px;font-style:normal}`,
        html:`<p class="eyebrow">Executed source bytes</p>
<h1>Runtime coverage</h1>
<p class="lede">All three preserved production modules captured from page and worker targets.</p>
<div class="chips"><span class="chip pass">${coverage.total.byteCoveragePercent.toFixed(2)}% covered</span><span class="chip">${number(coverage.total.coveredBytes)} / ${number(coverage.total.totalBytes)} bytes</span><span class="chip">No threshold asserted</span></div>
<div class="coverage-head"><span>Module</span><span>Coverage</span><span>Used</span><span>Unused</span></div>
<div class="coverage-rows">${rows}</div>`
    };
    return shell(
        'Chrome DevTools Protocol · precise V8 coverage',
        content,
        `Source: release/files/coverage-summary.json · Recorded ${escapeHTML(String(results.finishedAt).slice(0,10))} · Chrome precise block coverage`
    );
}

async function screenshot(page,html,outputPath){
    await page.setContent(html,{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    await mkdir(dirname(outputPath),{recursive:true});
    await page.screenshot({fullPage:true,path:outputPath,type:'png'});
}

async function run(){
    const [results,coverage]=await Promise.all([
        readJSON(TEST_RESULTS_PATH),
        readJSON(COVERAGE_RESULTS_PATH)
    ]);
    validateTestResults(results);
    validateCoverageResults(coverage);

    const browser=await puppeteer.launch({
        args:['--disable-background-networking','--no-default-browser-check','--no-first-run'],
        executablePath:findChrome(),
        headless:true
    });
    try{
        const page=await browser.newPage();
        await page.setViewport({deviceScaleFactor:1,height:800,width:1500});
        await screenshot(page,testEvidenceHTML(results),TEST_SCREENSHOT_PATH);
        await screenshot(page,coverageEvidenceHTML(coverage,results),COVERAGE_SCREENSHOT_PATH);
    }finally{
        await browser.close();
    }

    console.log(`Rendered ${TEST_SCREENSHOT_PATH}`);
    console.log(`Rendered ${COVERAGE_SCREENSHOT_PATH}`);
}

await run();
