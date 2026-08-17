import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

import {startStaticServer} from './static-server.mjs';

const WORKSPACE_ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const DEFAULT_OUTPUT_DIRECTORY=resolve(WORKSPACE_ROOT,'release/files');
const SOURCE_MANIFEST_PATH=resolve(WORKSPACE_ROOT,'release/test/source-manifest.json');
const VANILLA_TEST_VERSION='2.1.0';
const TEST_SUITE_NAMES=Object.freeze(['Unit','Functional','Integration','Regression']);
const MODULE_URL_PATTERN=/^\/arcane\/modules\/[^/]+\.js$/;

function serializeError(error){
    return {
        message:error?.message||String(error),
        name:error?.name||'Error',
        stack:error?.stack||null
    };
}

function optionValue(argv,index,name){
    const value=argv[index+1];
    if(!value||value.startsWith('--')){
        throw new TypeError(`${name} requires a value.`);
    }
    return value;
}

function parseOptions(argv){
    const options={
        chromePath:null,
        headed:false,
        outputDirectory:DEFAULT_OUTPUT_DIRECTORY,
        timeout:120000
    };

    for(let index=0;index<argv.length;index++){
        const argument=argv[index];

        switch(argument){
            case '--chrome':
                options.chromePath=resolve(optionValue(argv,index,argument));
                index++;
                break;
            case '--headed':
                options.headed=true;
                break;
            case '--output-dir':{
                const configured=optionValue(argv,index,argument);
                options.outputDirectory=resolve(WORKSPACE_ROOT,configured);
                index++;
                break;
            }
            case '--timeout':
                options.timeout=Number(optionValue(argv,index,argument));
                index++;
                break;
            default:
                throw new TypeError(`Unknown argument: ${argument}`);
        }
    }

    if(!Number.isFinite(options.timeout)||options.timeout<1000){
        throw new TypeError('--timeout must be a number of at least 1000 milliseconds.');
    }

    return options;
}

function executableCandidates(explicitPath){
    const environment=process.env;
    const candidates=[
        explicitPath,
        environment.CHROME_PATH,
        environment.PUPPETEER_EXECUTABLE_PATH
    ];

    const programFiles=environment.ProgramFiles||environment.PROGRAMFILES;
    const programFilesX86=environment['ProgramFiles(x86)']
        ||environment['PROGRAMFILES(X86)'];
    const localAppData=environment.LOCALAPPDATA;

    if(programFiles){
        candidates.push(join(programFiles,'Google/Chrome/Application/chrome.exe'));
    }
    if(programFilesX86){
        candidates.push(join(programFilesX86,'Google/Chrome/Application/chrome.exe'));
    }
    if(localAppData){
        candidates.push(join(localAppData,'Google/Chrome/Application/chrome.exe'));
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

function findChromeExecutable(explicitPath){
    const executable=executableCandidates(explicitPath).find(candidate=>existsSync(candidate));

    if(!executable){
        throw new Error(
            'Google Chrome was not found. Pass --chrome <path> or set CHROME_PATH.'
        );
    }

    return executable;
}

function assertInsideWorkspace(filePath){
    const resolvedPath=resolve(filePath);
    const boundary=WORKSPACE_ROOT.endsWith(sep)
        ?WORKSPACE_ROOT
        :`${WORKSPACE_ROOT}${sep}`;

    if(resolvedPath!==WORKSPACE_ROOT&&!resolvedPath.startsWith(boundary)){
        throw new Error(`Manifest path escapes the workspace: ${filePath}`);
    }

    return resolvedPath;
}

async function verifySourceIntegrity(){
    const manifest=JSON.parse(await readFile(SOURCE_MANIFEST_PATH,'utf8'));

    if(manifest.schemaVersion!==1||manifest.algorithm!=='sha256'||!Array.isArray(manifest.files)){
        throw new Error('The DBOPFS source manifest is invalid.');
    }

    const files=[];

    for(const expected of manifest.files){
        const absolutePath=assertInsideWorkspace(resolve(WORKSPACE_ROOT,expected.path));
        const source=await readFile(absolutePath);
        const actualHash=createHash('sha256').update(source).digest('hex');
        const actualBytes=source.byteLength;
        const hashMatches=actualHash===String(expected.sha256).toLowerCase();
        const bytesMatch=actualBytes===expected.bytes;

        files.push({
            actual:{bytes:actualBytes,sha256:actualHash},
            expected:{bytes:expected.bytes,sha256:String(expected.sha256).toLowerCase()},
            matches:hashMatches&&bytesMatch,
            path:expected.path
        });
    }

    return {
        algorithm:'sha256',
        files,
        passed:files.every(file=>file.matches),
        schemaVersion:1
    };
}

async function installedPackageVersion(packageName){
    const packagePath=resolve(WORKSPACE_ROOT,'node_modules',packageName,'package.json');
    const metadata=JSON.parse(await readFile(packagePath,'utf8'));
    return metadata.version;
}

function validateBrowserResults(results){
    if(!results||!Array.isArray(results.cases)||!Array.isArray(results.suites)){
        throw new Error('The browser page did not report structured test cases and suites.');
    }
    if(results.suites.length!==TEST_SUITE_NAMES.length){
        throw new Error('The browser page did not report exactly four test suites.');
    }

    const ids=new Set();
    const descriptions=new Set();
    for(const testCase of results.cases){
        if(!testCase?.id||ids.has(testCase.id)){
            throw new Error(`The browser page reported an invalid or duplicate test ID: ${testCase?.id}.`);
        }
        if(!testCase.description||descriptions.has(testCase.description)){
            throw new Error(
                `The browser page reported an invalid or duplicate test description: `
                +`${testCase.description}.`
            );
        }
        if(!TEST_SUITE_NAMES.includes(testCase.suite)){
            throw new Error(`The browser page reported an unknown suite: ${testCase.suite}.`);
        }
        if(!['failed','passed','skipped'].includes(testCase.status)){
            throw new Error(`The browser page reported an unknown test status: ${testCase.status}.`);
        }
        ids.add(testCase.id);
        descriptions.add(testCase.description);
    }

    const frameworkPassed=results.framework?.results?.passed;
    const frameworkFailed=results.framework?.results?.failed;
    if(!Array.isArray(frameworkPassed)||!Array.isArray(frameworkFailed)){
        throw new Error('The browser page did not report vanilla-test case results.');
    }
    if(frameworkPassed.length+frameworkFailed.length!==results.cases.length){
        throw new Error('The vanilla-test total does not match the browser case registry.');
    }
    if(results.framework.results.total!==results.cases.length){
        throw new Error('The vanilla-test result object reported the wrong total.');
    }
    if(frameworkFailed.length!==results.cases.filter(testCase=>
        testCase.status==='failed'
    ).length){
        throw new Error('The vanilla-test failure total does not match the browser cases.');
    }
    if(results.framework.results.failureCount!==frameworkFailed.length){
        throw new Error('The vanilla-test result object reported the wrong failure count.');
    }
    if(results.framework.results.ok!==(frameworkFailed.length===0)){
        throw new Error('The vanilla-test result object reported the wrong completion status.');
    }

    const normalizeFrameworkDescriptor=descriptor=>String(descriptor)
        .replace(/^\d+\) \.expects /,'');
    const expectedPassed=results.cases
        .filter(testCase=>testCase.status!=='failed')
        .map(testCase=>`[${testCase.suite}] ${testCase.description}`);
    const expectedFailed=results.cases
        .filter(testCase=>testCase.status==='failed')
        .map(testCase=>`[${testCase.suite}] ${testCase.description}`);
    const actualPassed=frameworkPassed.map(normalizeFrameworkDescriptor);
    const actualFailed=frameworkFailed.map(normalizeFrameworkDescriptor);
    if(JSON.stringify(actualPassed)!==JSON.stringify(expectedPassed)
        ||JSON.stringify(actualFailed)!==JSON.stringify(expectedFailed)){
        throw new Error('The vanilla-test descriptors do not match the browser case ledger.');
    }

    results.suites.forEach((suite,index)=>{
        const expectedName=TEST_SUITE_NAMES[index];
        if(suite?.name!==expectedName){
            throw new Error(
                `The browser page reported suite ${suite?.name||'unknown'} at `
                +`the ${expectedName} position.`
            );
        }
        const cases=results.cases.filter(testCase=>testCase.suite===expectedName);
        const expected={
            failed:cases.filter(testCase=>testCase.status==='failed').length,
            passed:cases.filter(testCase=>testCase.status==='passed').length,
            skipped:cases.filter(testCase=>testCase.status==='skipped').length,
            total:cases.length
        };
        for(const field of Object.keys(expected)){
            if(suite[field]!==expected[field]){
                throw new Error(`${expectedName} reported an inconsistent ${field} total.`);
            }
        }
    });

    const aggregate=results.suites.reduce((total,suite)=>({
        failed:total.failed+suite.failed,
        passed:total.passed+suite.passed,
        skipped:total.skipped+suite.skipped,
        total:total.total+suite.total
    }),{failed:0,passed:0,skipped:0,total:0});
    for(const field of Object.keys(aggregate)){
        if(results.summary?.[field]!==aggregate[field]){
            throw new Error(`The browser page reported an inconsistent ${field} summary.`);
        }
    }
}

function modulePathFromUrl(url){
    try{
        const pathname=decodeURIComponent(new URL(url).pathname);
        return MODULE_URL_PATTERN.test(pathname)?pathname.slice(1):null;
    }catch{
        return null;
    }
}

function rawCoverageRanges(rawScriptCoverage){
    const points=[];

    for(const functionCoverage of rawScriptCoverage.functions||[]){
        for(const range of functionCoverage.ranges||[]){
            points.push({offset:range.startOffset,range,type:'start'});
            points.push({offset:range.endOffset,range,type:'end'});
        }
    }

    points.sort((left,right)=>{
        if(left.offset!==right.offset){
            return left.offset-right.offset;
        }
        if(left.type!==right.type){
            return left.type==='end'?-1:1;
        }

        const leftLength=left.range.endOffset-left.range.startOffset;
        const rightLength=right.range.endOffset-right.range.startOffset;
        return left.type==='start'
            ?rightLength-leftLength
            :leftLength-rightLength;
    });

    const countStack=[];
    const ranges=[];
    let previousOffset=0;

    for(const point of points){
        const activeCount=countStack[countStack.length-1]||0;

        if(activeCount>0&&previousOffset<point.offset){
            const previousRange=ranges[ranges.length-1];
            if(previousRange?.end===previousOffset){
                previousRange.end=point.offset;
            }else{
                ranges.push({start:previousOffset,end:point.offset});
            }
        }

        previousOffset=point.offset;
        if(point.type==='start'){
            countStack.push(point.range.count);
        }else{
            countStack.pop();
        }
    }

    return ranges.filter(range=>range.end>range.start);
}

function normalizeCoverageEntry(entry,context){
    const modulePath=modulePathFromUrl(entry.url);

    if(!modulePath){
        return null;
    }

    return {
        context,
        modulePath,
        ranges:entry.ranges,
        rawScriptCoverage:entry.rawScriptCoverage||null,
        text:entry.text,
        url:entry.url
    };
}

function mergeRanges(ranges){
    const sorted=ranges
        .filter(range=>range.end>range.start)
        .map(range=>({start:range.start,end:range.end}))
        .sort((left,right)=>left.start-right.start||left.end-right.end);
    const merged=[];

    for(const range of sorted){
        const previous=merged[merged.length-1];
        if(previous&&range.start<=previous.end){
            previous.end=Math.max(previous.end,range.end);
        }else{
            merged.push(range);
        }
    }

    return merged;
}

function summarizeCoverage(entries){
    const byModule=new Map();

    for(const entry of entries){
        const existing=byModule.get(entry.modulePath)||{
            modulePath:entry.modulePath,
            ranges:[],
            text:entry.text
        };

        if(existing.text!==entry.text){
            throw new Error(`Coverage captured conflicting sources for ${entry.modulePath}.`);
        }

        existing.ranges.push(...entry.ranges);
        byModule.set(entry.modulePath,existing);
    }

    const files=[...byModule.values()]
        .sort((left,right)=>left.modulePath.localeCompare(right.modulePath))
        .map(file=>{
            const ranges=mergeRanges(file.ranges);
            const coveredBytes=ranges.reduce(
                (total,range)=>total+(range.end-range.start),
                0
            );
            const totalBytes=file.text.length;

            return {
                byteCoveragePercent:totalBytes
                    ?Number(((coveredBytes/totalBytes)*100).toFixed(2))
                    :100,
                coveredBytes,
                modulePath:file.modulePath,
                totalBytes
            };
        });
    const totalBytes=files.reduce((total,file)=>total+file.totalBytes,0);
    const coveredBytes=files.reduce((total,file)=>total+file.coveredBytes,0);

    return {
        files,
        metric:'executed source bytes from precise V8 block coverage',
        total:{
            byteCoveragePercent:totalBytes
                ?Number(((coveredBytes/totalBytes)*100).toFixed(2))
                :100,
            coveredBytes,
            totalBytes
        }
    };
}

class WorkerCoverageCollector{
    constructor(worker){
        this.client=worker.client;
        this.url=worker.url();
        this.active=false;
    }

    async start(){
        if(!this.client||typeof this.client.send!=='function'){
            throw new Error('Puppeteer did not expose the Chrome worker CDP session.');
        }

        await Promise.all([
            this.client.send('Debugger.enable'),
            this.client.send('Profiler.enable')
        ]);
        await this.client.send('Profiler.startPreciseCoverage',{
            callCount:true,
            detailed:true
        });
        this.active=true;
    }

    async stop(){
        if(!this.active){
            return [];
        }

        this.active=false;
        let response;

        try{
            response=await this.client.send('Profiler.takePreciseCoverage');
            const entries=[];

            for(const rawScriptCoverage of response.result||[]){
                const modulePath=modulePathFromUrl(rawScriptCoverage.url);
                if(!modulePath){
                    continue;
                }

                const source=await this.client.send('Debugger.getScriptSource',{
                    scriptId:rawScriptCoverage.scriptId
                });
                entries.push({
                    context:'worker',
                    modulePath,
                    ranges:rawCoverageRanges(rawScriptCoverage),
                    rawScriptCoverage,
                    text:source.scriptSource,
                    url:rawScriptCoverage.url
                });
            }

            return entries;
        }finally{
            await Promise.allSettled([
                this.client.send('Profiler.stopPreciseCoverage'),
                this.client.send('Profiler.disable'),
                this.client.send('Debugger.disable')
            ]);
        }
    }
}

async function writeJSON(filePath,value){
    await mkdir(resolve(filePath,'..'),{recursive:true});
    await writeFile(filePath,`${JSON.stringify(value,null,2)}\n`,'utf8');
}

async function run(){
    const options=parseOptions(process.argv.slice(2));
    const runStartedAt=new Date();
    const diagnostics={
        console:[],
        pageErrors:[],
        requestFailures:[]
    };
    const coverageEntries=[];
    const workerCollectors=[];
    const workerSetupTasks=[];

    let browser=null;
    let browserResults=null;
    let browserVersion=null;
    let chromeExecutable=null;
    let page=null;
    let pageCoverageActive=false;
    let puppeteerVersion=null;
    let runError=null;
    let server=null;
    let sourceIntegrity=null;
    let vanillaTestVersion=null;

    try{
        sourceIntegrity=await verifySourceIntegrity();
        if(!sourceIntegrity.passed){
            throw new Error('DBOPFS source-preservation verification failed.');
        }

        vanillaTestVersion=await installedPackageVersion('vanilla-test');
        if(vanillaTestVersion!==VANILLA_TEST_VERSION){
            throw new Error(
                `Expected vanilla-test ${VANILLA_TEST_VERSION}, found ${vanillaTestVersion}.`
            );
        }
        puppeteerVersion=await installedPackageVersion('puppeteer-core');

        chromeExecutable=findChromeExecutable(options.chromePath);
        server=await startStaticServer({root:WORKSPACE_ROOT});

        const {default:puppeteer}=await import('puppeteer-core');
        browser=await puppeteer.launch({
            args:[
                '--disable-background-networking',
                '--disable-component-update',
                '--no-default-browser-check',
                '--no-first-run'
            ],
            executablePath:chromeExecutable,
            headless:!options.headed
        });
        browserVersion=await browser.version();
        page=await browser.newPage();
        page.setDefaultTimeout(options.timeout);

        page.on('console',message=>{
            diagnostics.console.push({text:message.text(),type:message.type()});
        });
        page.on('pageerror',error=>{
            diagnostics.pageErrors.push(serializeError(error));
        });
        page.on('requestfailed',request=>{
            diagnostics.requestFailures.push({
                errorText:request.failure()?.errorText||'Request failed',
                method:request.method(),
                url:request.url()
            });
        });
        page.on('workercreated',worker=>{
            if(modulePathFromUrl(worker.url())!=='arcane/modules/DBOPFSWorker.js'){
                return;
            }

            const setup=(async()=>{
                const collector=new WorkerCoverageCollector(worker);
                await collector.start();
                workerCollectors.push(collector);
                await page.evaluate(()=>{
                    globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_READY__=true;
                });
            })();

            workerSetupTasks.push(setup);
            void setup.catch(async error=>{
                const message=error?.message||String(error);
                await page.evaluate(workerError=>{
                    globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__=workerError;
                },message).catch(()=>{});
            });
        });

        await page.coverage.startJSCoverage({
            includeRawScriptCoverage:true,
            reportAnonymousScripts:false,
            resetOnNavigation:false,
            useBlockCoverage:true
        });
        pageCoverageActive=true;

        const testUrl=`${server.origin}/release/test/index.html?coverage=1`;
        const response=await page.goto(testUrl,{
            timeout:options.timeout,
            waitUntil:'load'
        });

        if(!response?.ok()){
            throw new Error(`Release test page returned HTTP ${response?.status()||'unknown'}.`);
        }

        await page.waitForFunction(
            ()=>globalThis.__DBOPFS_RELEASE_RESULTS__?.complete===true,
            {polling:50,timeout:options.timeout}
        );
        browserResults=await page.evaluate(()=>globalThis.__DBOPFS_RELEASE_RESULTS__);

        const pageCoverage=await page.coverage.stopJSCoverage();
        pageCoverageActive=false;
        for(const entry of pageCoverage){
            const normalized=normalizeCoverageEntry(entry,'page');
            if(normalized){
                coverageEntries.push(normalized);
            }
        }

        await Promise.allSettled(workerSetupTasks);
        for(const collector of workerCollectors){
            coverageEntries.push(...await collector.stop());
        }
    }catch(error){
        runError=serializeError(error);

        if(pageCoverageActive&&page){
            try{
                const pageCoverage=await page.coverage.stopJSCoverage();
                pageCoverageActive=false;
                for(const entry of pageCoverage){
                    const normalized=normalizeCoverageEntry(entry,'page');
                    if(normalized){
                        coverageEntries.push(normalized);
                    }
                }
            }catch(coverageError){
                diagnostics.pageErrors.push(serializeError(coverageError));
            }
        }

        for(const collector of workerCollectors){
            try{
                coverageEntries.push(...await collector.stop());
            }catch(coverageError){
                diagnostics.pageErrors.push(serializeError(coverageError));
            }
        }
    }finally{
        if(browser){
            await browser.close().catch(error=>{
                diagnostics.pageErrors.push(serializeError(error));
            });
        }
        if(server){
            await server.close().catch(error=>{
                diagnostics.pageErrors.push(serializeError(error));
            });
        }
    }

    let coverageSummary={
        files:[],
        metric:'executed source bytes from precise V8 block coverage',
        total:{byteCoveragePercent:0,coveredBytes:0,totalBytes:0}
    };
    try{
        coverageSummary=summarizeCoverage(coverageEntries);
    }catch(error){
        runError=runError||serializeError(error);
    }

    const expectedModules=(sourceIntegrity?.files||[]).map(file=>file.path).sort();
    const capturedModules=coverageSummary.files.map(file=>file.modulePath).sort();
    const missingModules=expectedModules.filter(path=>!capturedModules.includes(path));

    if(!runError&&missingModules.length){
        runError=serializeError(new Error(
            `Precise coverage did not capture: ${missingModules.join(', ')}.`
        ));
    }
    if(!runError&&browserResults?.framework?.name!=='vanilla-test'){
        runError=serializeError(new Error('The browser page did not report vanilla-test.'));
    }
    if(!runError&&browserResults?.framework?.version!==VANILLA_TEST_VERSION){
        runError=serializeError(new Error('The browser page reported the wrong vanilla-test version.'));
    }
    if(!runError){
        try{
            validateBrowserResults(browserResults);
        }catch(error){
            runError=serializeError(error);
        }
    }
    if(!runError&&browserResults?.fatalError){
        runError=browserResults.fatalError;
    }
    if(!runError&&browserResults?.teardown?.status!=='passed'){
        runError=serializeError(new Error('The browser page teardown did not pass.'));
    }
    if(!runError&&diagnostics.pageErrors.length){
        runError=serializeError(new Error('Chrome reported an uncaught page or coverage error.'));
    }
    if(!runError&&diagnostics.requestFailures.length){
        runError=serializeError(new Error('Chrome reported a failed network request.'));
    }

    const browserFailures=browserResults?.summary?.failed??(browserResults?0:1);
    const releasePassed=!runError&&browserFailures===0;
    const finishedAt=new Date();
    const driver={
        browserVersion,
        chromeExecutable,
        diagnostics,
        durationMs:finishedAt.getTime()-runStartedAt.getTime(),
        error:runError,
        finishedAt:finishedAt.toISOString(),
        missingCoverageModules:missingModules,
        puppeteerCoreVersion:puppeteerVersion,
        startedAt:runStartedAt.toISOString(),
        status:releasePassed?'passed':'failed',
        vanillaTestVersion
    };
    const testResults=browserResults
        ?{...browserResults,driver,sourceIntegrity}
        :{
            cases:[],
            complete:false,
            driver,
            framework:{name:'vanilla-test',results:{failed:[],passed:[]},version:VANILLA_TEST_VERSION},
            schemaVersion:1,
            sourceIntegrity,
            suites:TEST_SUITE_NAMES.map(name=>({
                failed:0,
                name,
                passed:0,
                skipped:0,
                total:0
            })),
            summary:{failed:0,passed:0,skipped:0,total:0},
            teardown:{durationMs:0,error:runError,status:'not-run'}
        };
    const rawCoverage={
        entries:coverageEntries,
        generatedAt:finishedAt.toISOString(),
        schemaVersion:1,
        source:'Chrome DevTools precise V8 JavaScript coverage via Puppeteer-core',
        summary:coverageSummary
    };

    await writeJSON(resolve(options.outputDirectory,'test-results.json'),testResults);
    await writeJSON(resolve(options.outputDirectory,'coverage-raw.json'),rawCoverage);
    await writeJSON(resolve(options.outputDirectory,'coverage-summary.json'),coverageSummary);

    console.log(
        `DBOPFS browser release tests: ${releasePassed?'PASSED':'FAILED'} `
        +`(${browserResults?.summary?.passed||0} passed, `
        +`${browserFailures} failed, ${browserResults?.summary?.skipped||0} skipped)`
    );
    for(const suiteName of TEST_SUITE_NAMES){
        const suite=browserResults?.suites?.find(result=>result.name===suiteName)
            ||{failed:0,passed:0,skipped:0,total:0};
        console.log(
            `  ${suiteName}: ${suite.passed} passed, ${suite.failed} failed, `
            +`${suite.skipped} skipped, ${suite.total} total`
        );
    }
    console.log(
        `Precise module byte coverage: ${coverageSummary.total.byteCoveragePercent.toFixed(2)}%`
    );
    console.log(`Artifacts: ${options.outputDirectory}`);

    process.exitCode=releasePassed?0:1;
}

await run().catch(error=>{
    console.error(error?.stack||error);
    process.exitCode=1;
});
