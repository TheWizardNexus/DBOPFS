import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

import {startStaticServer} from './static-server.mjs';

const WORKSPACE_ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const FILES_DIRECTORY=resolve(WORKSPACE_ROOT,'release/files');
const BADGES_DIRECTORY=resolve(WORKSPACE_ROOT,'release/badges');
const PACKAGE_JSON_PATH=resolve(WORKSPACE_ROOT,'package.json');
const SOURCE_MANIFEST_PATH=resolve(WORKSPACE_ROOT,'release/test/source-manifest.json');
const BROWSER_HARNESS_PATH=resolve(
    WORKSPACE_ROOT,
    'release/scripts/run-browser-release-tests.mjs'
);
const TEMPORARY_PREFIX='dbopfs-packed-release-';
const RUNTIME_PATHS=Object.freeze([
    'arcane/modules/AppDataScope.js',
    'arcane/modules/DBOPFS.js',
    'arcane/modules/DBOPFSWorker.js'
]);
const GENERATED_FILE_NAMES=Object.freeze([
    'coverage-raw.json',
    'coverage-summary.json',
    'npm-pack.json',
    'packed-install.json',
    'release-evidence.md',
    'SHA256SUMS.txt',
    'test-results.json'
]);

function serializeError(error){
    return {
        code:error?.code||null,
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
        harnessArguments:[],
        headed:false,
        timeout:120000
    };

    for(let index=0;index<argv.length;index++){
        const argument=argv[index];

        switch(argument){
            case '--chrome':{
                const value=resolve(optionValue(argv,index,argument));
                options.chromePath=value;
                options.harnessArguments.push(argument,value);
                index++;
                break;
            }
            case '--headed':
                options.headed=true;
                options.harnessArguments.push(argument);
                break;
            case '--timeout':{
                const value=optionValue(argv,index,argument);
                options.timeout=Number(value);
                options.harnessArguments.push(argument,value);
                index++;
                break;
            }
            case '--output-dir':
                throw new TypeError(
                    'release:test always writes to release/files; --output-dir is not supported.'
                );
            default:
                throw new TypeError(`Unknown argument: ${argument}`);
        }
    }

    if(!Number.isFinite(options.timeout)||options.timeout<1000){
        throw new TypeError('--timeout must be a number of at least 1000 milliseconds.');
    }

    return options;
}

function isInside(parentPath,candidatePath){
    const parent=resolve(parentPath);
    const candidate=resolve(candidatePath);
    const boundary=parent.endsWith(sep)?parent:`${parent}${sep}`;

    return candidate===parent||candidate.startsWith(boundary);
}

function assertInside(parentPath,candidatePath,label){
    const candidate=resolve(candidatePath);

    if(!isInside(parentPath,candidate)){
        throw new Error(`${label} escapes ${parentPath}: ${candidatePath}`);
    }

    return candidate;
}

function assertSafeTemporaryFixture(fixturePath){
    const resolvedFixture=resolve(fixturePath);
    const resolvedTemporaryRoot=resolve(tmpdir());

    if(dirname(resolvedFixture)!==resolvedTemporaryRoot
        ||!basename(resolvedFixture).startsWith(TEMPORARY_PREFIX)
        ||basename(resolvedFixture)===TEMPORARY_PREFIX){
        throw new Error(`Refusing to clean an unsafe temporary path: ${fixturePath}`);
    }

    return resolvedFixture;
}

function sha256(value){
    return createHash('sha256').update(value).digest('hex');
}

async function fileSha256(filePath){
    return sha256(await readFile(filePath));
}

async function readJSON(filePath){
    return JSON.parse(await readFile(filePath,'utf8'));
}

async function readJSONIfPresent(filePath){
    try{
        return await readJSON(filePath);
    }catch(error){
        if(error?.code==='ENOENT'){
            return null;
        }
        throw error;
    }
}

async function writeJSON(filePath,value){
    await mkdir(dirname(filePath),{recursive:true});
    await writeFile(filePath,`${JSON.stringify(value,null,2)}\n`,'utf8');
}

function commandError(command,args,result){
    const rendered=[command,...args].join(' ');
    const signalText=result.signal?` (signal ${result.signal})`:'';
    const error=new Error(
        `Command failed with exit code ${result.code}${signalText}: ${rendered}`
    );

    error.code='RELEASE_COMMAND_FAILED';
    error.command=rendered;
    error.exitCode=result.code;
    error.stderr=result.stderr;
    error.stdout=result.stdout;
    return error;
}

function runCommand(command,args,{capture=false,cwd=WORKSPACE_ROOT,env=process.env}={}){
    return new Promise((resolveRun,rejectRun)=>{
        const child=spawn(command,args,{
            cwd,
            env,
            shell:false,
            stdio:capture?['ignore','pipe','pipe']:'inherit',
            windowsHide:true
        });
        let stderr='';
        let stdout='';

        if(capture){
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data',chunk=>{stdout+=chunk;});
            child.stderr.on('data',chunk=>{stderr+=chunk;});
        }

        child.once('error',rejectRun);
        child.once('close',(code,signal)=>{
            const result={code,signal,stderr,stdout};

            if(code!==0){
                rejectRun(commandError(command,args,result));
                return;
            }

            resolveRun(result);
        });
    });
}

function npmInvocation(argumentsList){
    const npmExecutable=process.env.npm_execpath;

    if(npmExecutable&&existsSync(npmExecutable)){
        return {
            args:[npmExecutable,...argumentsList],
            command:process.execPath,
            display:['npm',...argumentsList]
        };
    }

    return {
        args:argumentsList,
        command:process.platform==='win32'?'npm.cmd':'npm',
        display:['npm',...argumentsList]
    };
}

async function runNpm(argumentsList,options={}){
    const invocation=npmInvocation(argumentsList);
    const result=await runCommand(invocation.command,invocation.args,options);

    return {...result,display:invocation.display};
}

function packagePathSegments(packageName){
    if(typeof packageName!=='string'||packageName.length===0){
        throw new TypeError('package.json must declare a package name.');
    }

    const segments=packageName.split('/');
    const scoped=packageName.startsWith('@');

    if((scoped&&segments.length!==2)||(!scoped&&segments.length!==1)
        ||segments.some(segment=>!segment||segment==='.'||segment==='..')){
        throw new TypeError(`Unsupported npm package name: ${packageName}`);
    }

    return segments;
}

function packageTarballName(packageMetadata){
    return `${packageMetadata.name.replace(/^@/,'').replaceAll('/','-')}`
        +`-${packageMetadata.version}.tgz`;
}

function moduleTarget(packageMetadata){
    const exported=packageMetadata.exports?.['.'];
    const target=typeof exported==='string'
        ?exported
        :packageMetadata.module||packageMetadata.main;

    if(typeof target!=='string'||target.length===0){
        throw new TypeError('package.json does not expose a string module entry point.');
    }

    return target.replace(/^\.\//,'');
}

async function removePreviousOutputs(packageMetadata){
    await mkdir(FILES_DIRECTORY,{recursive:true});
    await mkdir(BADGES_DIRECTORY,{recursive:true});

    const previousPack=await readJSONIfPresent(resolve(FILES_DIRECTORY,'npm-pack.json'));
    const tarballs=new Set([packageTarballName(packageMetadata)]);

    for(const entry of Array.isArray(previousPack)?previousPack:[]){
        if(typeof entry?.filename==='string'){
            tarballs.add(entry.filename);
        }
    }

    for(const filename of GENERATED_FILE_NAMES){
        await rm(resolve(FILES_DIRECTORY,filename),{force:true});
    }

    for(const filename of tarballs){
        if(basename(filename)!==filename||!filename.endsWith('.tgz')){
            throw new Error(`Refusing to remove an unsafe tarball name: ${filename}`);
        }
        await rm(resolve(FILES_DIRECTORY,filename),{force:true});
    }

    await Promise.all([
        rm(resolve(BADGES_DIRECTORY,'tests.json'),{force:true}),
        rm(resolve(BADGES_DIRECTORY,'coverage.json'),{force:true})
    ]);
}

function validateHarnessResults(testResults,coverageSummary){
    if(testResults?.complete!==true
        ||testResults?.driver?.status!=='passed'
        ||testResults?.summary?.failed!==0){
        throw new Error('The existing browser release harness did not pass.');
    }

    if(testResults?.framework?.name!=='vanilla-test'){
        throw new Error('The browser release harness did not use vanilla-test.');
    }

    if(testResults?.sourceIntegrity?.passed!==true
        ||testResults.sourceIntegrity.files?.length!==RUNTIME_PATHS.length){
        throw new Error('The browser release harness did not preserve all runtime sources.');
    }

    if(!Number.isFinite(coverageSummary?.total?.byteCoveragePercent)
        ||coverageSummary.files?.length!==RUNTIME_PATHS.length){
        throw new Error('The browser release harness did not capture all runtime coverage.');
    }
}

async function runBrowserHarness(options){
    console.log('Release gate 1/3: vanilla-test browser suite and precise coverage');
    await runCommand(process.execPath,[
        BROWSER_HARNESS_PATH,
        '--output-dir',
        'release/files',
        ...options.harnessArguments
    ]);

    const testResults=await readJSON(resolve(FILES_DIRECTORY,'test-results.json'));
    const coverageSummary=await readJSON(
        resolve(FILES_DIRECTORY,'coverage-summary.json')
    );

    validateHarnessResults(testResults,coverageSummary);
    return {coverageSummary,testResults};
}

function parsePackOutput(stdout){
    let parsed;

    try{
        parsed=JSON.parse(stdout.trim());
    }catch(error){
        throw new Error(`npm pack did not return valid JSON: ${error.message}`);
    }

    if(!Array.isArray(parsed)||parsed.length!==1||!parsed[0]?.filename){
        throw new Error('npm pack returned an unexpected result.');
    }

    return parsed;
}

async function packPackage(packageMetadata){
    console.log('Release gate 2/3: npm pack with lifecycle scripts disabled');
    const pack=await runNpm([
        'pack',
        '--json',
        '--pack-destination',
        'release/files',
        '--ignore-scripts'
    ],{
        capture:true,
        env:{...process.env,npm_config_ignore_scripts:'true'}
    });
    const results=parsePackOutput(pack.stdout);
    const result=results[0];

    if(result.name!==packageMetadata.name||result.version!==packageMetadata.version){
        throw new Error(
            `npm packed ${result.name}@${result.version}; expected `
            +`${packageMetadata.name}@${packageMetadata.version}.`
        );
    }

    if(basename(result.filename)!==result.filename||!result.filename.endsWith('.tgz')){
        throw new Error(`npm pack returned an unsafe filename: ${result.filename}`);
    }

    const tarballPath=assertInside(
        FILES_DIRECTORY,
        resolve(FILES_DIRECTORY,result.filename),
        'npm tarball'
    );
    const tarballStat=await stat(tarballPath);

    if(!tarballStat.isFile()){
        throw new Error(`npm pack did not create ${result.filename}.`);
    }

    await writeJSON(resolve(FILES_DIRECTORY,'npm-pack.json'),results);
    return {command:pack.display,result,results,tarballPath};
}

function validateSourceManifest(manifest){
    if(manifest?.schemaVersion!==1
        ||manifest?.algorithm!=='sha256'
        ||!Array.isArray(manifest.files)
        ||manifest.files.length!==RUNTIME_PATHS.length){
        throw new Error('The runtime source manifest must contain exactly three SHA-256 files.');
    }

    const actualPaths=manifest.files.map(file=>file.path).sort();
    const expectedPaths=[...RUNTIME_PATHS].sort();

    if(JSON.stringify(actualPaths)!==JSON.stringify(expectedPaths)){
        throw new Error('The runtime source manifest contains an unexpected file set.');
    }

    for(const file of manifest.files){
        if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isInteger(file.bytes)){
            throw new Error(`The source manifest entry is invalid: ${file.path}`);
        }
    }
}

async function verifyInstalledRuntime(installedPackageRoot,manifest){
    validateSourceManifest(manifest);
    const files=[];

    for(const expected of manifest.files){
        const installedPath=assertInside(
            installedPackageRoot,
            resolve(installedPackageRoot,expected.path),
            'installed runtime file'
        );
        const source=await readFile(installedPath);
        const actualHash=sha256(source);
        const actualBytes=source.byteLength;

        files.push({
            actual:{bytes:actualBytes,sha256:actualHash},
            expected:{bytes:expected.bytes,sha256:expected.sha256},
            matches:actualHash===expected.sha256&&actualBytes===expected.bytes,
            path:expected.path
        });
    }

    return {
        algorithm:'sha256',
        exactRuntimeFileCount:files.length,
        files,
        passed:files.length===3&&files.every(file=>file.matches)
    };
}

async function verifyBundledStrongType(installedPackageRoot,packageMetadata){
    const dependencyRoot=resolve(installedPackageRoot,'node_modules/strong-type');
    const indexPath=resolve(dependencyRoot,'index.js');
    const packagePath=resolve(dependencyRoot,'package.json');
    const indexStat=await lstat(indexPath);

    if(!indexStat.isFile()){
        throw new Error('The packed package lacks nested node_modules/strong-type/index.js.');
    }

    const dependencyMetadata=await readJSON(packagePath);
    const expectedVersion=packageMetadata.dependencies?.['strong-type'];

    if(expectedVersion&&dependencyMetadata.version!==expectedVersion){
        throw new Error(
            `Nested strong-type is ${dependencyMetadata.version}; expected ${expectedVersion}.`
        );
    }

    return {
        exists:true,
        nestedPath:'node_modules/strong-type/index.js',
        packageName:dependencyMetadata.name,
        sha256:await fileSha256(indexPath),
        version:dependencyMetadata.version
    };
}

function installedModulePointer(packageMetadata){
    const segments=[
        'node_modules',
        ...packagePathSegments(packageMetadata.name),
        ...moduleTarget(packageMetadata).split('/')
    ];

    return `/${segments.map(segment=>encodeURIComponent(segment)).join('/')}`;
}

async function runInstalledBrowserSmoke({
    chromeExecutable,
    fixturePath,
    modulePointer,
    options,
    packageMetadata
}){
    const smokePagePath=resolve(fixturePath,'packed-smoke.html');
    const smokeMarkup=`<!doctype html>
<html lang="en" data-arcane-app-id="dbopfs-packed-release-smoke">
<head>
    <meta charset="utf-8">
    <meta name="arcane-app-id" content="dbopfs-packed-release-smoke">
    <link rel="icon" href="data:,">
    <title>DBOPFS packed install smoke test</title>
</head>
<body><p>DBOPFS packed install smoke test</p></body>
</html>\n`;
    await writeFile(smokePagePath,smokeMarkup,'utf8');

    const diagnostics={console:[],httpErrors:[],pageErrors:[],requestFailures:[]};
    const {default:puppeteer}=await import('puppeteer-core');
    let browser=null;
    let server=null;

    try{
        server=await startStaticServer({root:fixturePath});
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
        const browserVersion=await browser.version();
        const page=await browser.newPage();
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
        page.on('response',response=>{
            if(!response.ok()){
                diagnostics.httpErrors.push({
                    status:response.status(),
                    url:response.url()
                });
            }
        });

        const response=await page.goto(`${server.origin}/packed-smoke.html`,{
            timeout:options.timeout,
            waitUntil:'load'
        });

        if(!response?.ok()){
            throw new Error(`Packed smoke page returned HTTP ${response?.status()||'unknown'}.`);
        }

        const expected={
            package:packageMetadata.name,
            source:'installed npm tarball',
            version:packageMetadata.version
        };
        const evaluation=await page.evaluate(async({expected,modulePointer})=>{
            const imported=await import(modulePointer);
            const database=globalThis.dbopfs;

            if(typeof imported.default!=='function'||!database){
                throw new Error('The installed module did not expose DBOPFS.');
            }

            await database.readyPromise;
            let actual;

            try{
                await database.set('packed-release-smoke','round-trip.json',expected);
                actual=await database.get(
                    'packed-release-smoke',
                    'round-trip.json',
                    true
                );

                if(JSON.stringify(actual)!==JSON.stringify(expected)){
                    throw new Error('The installed package set/get round trip changed the value.');
                }
            }finally{
                await database.clearAllStorage();
            }

            return {
                actual,
                applicationId:database.applicationId,
                defaultExportType:typeof imported.default,
                expected,
                ready:database.ready,
                storagePath:database.storagePath
            };
        },{expected,modulePointer});

        const consoleErrors=diagnostics.console.filter(message=>message.type==='error');
        if(consoleErrors.length
            ||diagnostics.httpErrors.length
            ||diagnostics.pageErrors.length
            ||diagnostics.requestFailures.length){
            throw new Error('Chrome reported an error while testing the installed package.');
        }

        return {
            browserVersion,
            chromeExecutable,
            diagnostics,
            modulePointer,
            onlyIntegrationChange:'module pointer',
            passed:true,
            setGet:evaluation
        };
    }finally{
        const closing=[];
        if(browser){
            closing.push(browser.close());
        }
        if(server){
            closing.push(server.close());
        }

        const closeResults=await Promise.allSettled(closing);
        const closeFailure=closeResults.find(result=>result.status==='rejected');
        if(closeFailure){
            throw closeFailure.reason;
        }
    }
}

async function verifyPackedInstall({harness,options,pack,packageMetadata}){
    console.log('Release gate 3/3: fresh packed install, integrity, and Chrome smoke test');
    const generatedAt=new Date().toISOString();
    const result={
        cleanup:{removed:false,safeTemporaryPrefix:TEMPORARY_PREFIX},
        error:null,
        generatedAt,
        installation:{
            freshOsTemporaryFixture:true,
            scriptsDisabled:true
        },
        package:{
            name:packageMetadata.name,
            tarball:pack.result.filename,
            version:packageMetadata.version
        },
        schemaVersion:1,
        status:'failed'
    };
    let fixturePath=null;

    try{
        fixturePath=assertSafeTemporaryFixture(
            await mkdtemp(join(tmpdir(),TEMPORARY_PREFIX))
        );
        result.cleanup.fixturePath=fixturePath;
        const fixturePackage={
            name:'dbopfs-packed-release-fixture',
            private:true,
            type:'module',
            version:'0.0.0'
        };
        await writeJSON(resolve(fixturePath,'package.json'),fixturePackage);

        const installArguments=[
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            '--save-exact',
            pack.tarballPath
        ];
        const install=await runNpm(installArguments,{
            capture:true,
            cwd:fixturePath,
            env:{
                ...process.env,
                npm_config_audit:'false',
                npm_config_fund:'false',
                npm_config_ignore_scripts:'true'
            }
        });
        result.installation.command=install.display;

        const installedPackageRoot=resolve(
            fixturePath,
            'node_modules',
            ...packagePathSegments(packageMetadata.name)
        );
        const installedMetadata=await readJSON(
            resolve(installedPackageRoot,'package.json')
        );

        if(installedMetadata.name!==packageMetadata.name
            ||installedMetadata.version!==packageMetadata.version){
            throw new Error(
                `Installed ${installedMetadata.name}@${installedMetadata.version}; expected `
                +`${packageMetadata.name}@${packageMetadata.version}.`
            );
        }

        const manifest=await readJSON(SOURCE_MANIFEST_PATH);
        result.runtimeIntegrity=await verifyInstalledRuntime(
            installedPackageRoot,
            manifest
        );
        if(!result.runtimeIntegrity.passed){
            throw new Error('The installed package runtime hashes do not match exactly.');
        }

        result.bundledDependency=await verifyBundledStrongType(
            installedPackageRoot,
            packageMetadata
        );
        const pointer=installedModulePointer(packageMetadata);
        const installedTarget=assertInside(
            installedPackageRoot,
            resolve(installedPackageRoot,moduleTarget(packageMetadata)),
            'installed module target'
        );
        const targetStat=await stat(installedTarget);

        if(!targetStat.isFile()){
            throw new Error(`The installed module target is not a file: ${installedTarget}`);
        }

        const chromeExecutable=options.chromePath
            ||harness.testResults?.driver?.chromeExecutable;
        if(!chromeExecutable||!existsSync(chromeExecutable)){
            throw new Error('The installed Chrome executable from the browser harness is missing.');
        }

        result.browserSmoke=await runInstalledBrowserSmoke({
            chromeExecutable,
            fixturePath,
            modulePointer:pointer,
            options,
            packageMetadata
        });
        result.status='passed';
    }catch(error){
        result.error=serializeError(error);
    }finally{
        if(fixturePath){
            try{
                const safeFixture=assertSafeTemporaryFixture(fixturePath);
                await rm(safeFixture,{force:true,recursive:true});
                result.cleanup.removed=true;
            }catch(error){
                result.cleanup.error=serializeError(error);
                result.error=result.error||serializeError(error);
                result.status='failed';
            }
        }
    }

    return result;
}

function testBadge(testResults){
    const summary=testResults?.summary;

    if(!summary||!Number.isFinite(summary.failed)||!Number.isFinite(summary.passed)){
        return {color:'red',label:'tests',message:'unavailable',schemaVersion:1};
    }

    const message=summary.failed
        ?`${summary.failed} failed`
        :`${summary.passed} passed${summary.skipped?`, ${summary.skipped} skipped`:''}`;

    return {
        color:summary.failed?'red':'brightgreen',
        label:'tests',
        message,
        schemaVersion:1
    };
}

function coverageBadge(coverageSummary){
    const percent=coverageSummary?.total?.byteCoveragePercent;

    if(!Number.isFinite(percent)){
        return {color:'red',label:'coverage',message:'unavailable',schemaVersion:1};
    }

    return {
        color:'blue',
        label:'coverage',
        message:`${percent.toFixed(2)}%`,
        namedLogo:'googlechrome',
        schemaVersion:1
    };
}

function markdownCell(value){
    return String(value??'n/a').replaceAll('|','\\|').replaceAll('\n',' ');
}

function releaseEvidenceMarkdown({
    coverageSummary,
    failure,
    pack,
    packedInstall,
    packageMetadata,
    testResults
}){
    const summary=testResults?.summary||{};
    const coverage=coverageSummary?.total||{};
    const status=failure||packedInstall?.status!=='passed'?'FAILED':'PASSED';
    const lines=[
        '# Release evidence',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '| Gate | Result | Evidence |',
        '| --- | --- | --- |',
        `| Package | ${markdownCell(packageMetadata.name)} | ${markdownCell(packageMetadata.version)} |`,
        `| Overall release gate | ${status} | ${failure?markdownCell(`${failure.stage}: ${failure.error.message}`):'All gates passed'} |`,
        `| Browser tests | ${testResults?.driver?.status||'not run'} | ${summary.passed??0} passed, ${summary.failed??0} failed, ${summary.skipped??0} skipped; ${markdownCell(testResults?.framework?.name)} ${markdownCell(testResults?.framework?.version)} |`,
        `| Precise coverage | ${Number.isFinite(coverage.byteCoveragePercent)?`${coverage.byteCoveragePercent.toFixed(2)}%`:'not available'} | ${coverage.coveredBytes??0} / ${coverage.totalBytes??0} executed source bytes; no release threshold is asserted |`,
        `| npm pack | ${pack?'passed':'not completed'} | ${markdownCell(pack?.result?.filename)} |`,
        `| Fresh install | ${packedInstall?.status||'not run'} | npm lifecycle scripts disabled: ${packedInstall?.installation?.scriptsDisabled===true} |`,
        `| Installed Chrome smoke | ${packedInstall?.browserSmoke?.passed?'passed':'not completed'} | imported ${markdownCell(packedInstall?.browserSmoke?.modulePointer)}; set/get round trip |`,
        `| Temporary fixture cleanup | ${packedInstall?.cleanup?.removed?'passed':'not completed'} | cleanup restricted to the mkdtemp path |`,
        '',
        '## Installed runtime integrity',
        '',
        '| Runtime file | Expected SHA-256 | Installed SHA-256 | Match |',
        '| --- | --- | --- | --- |'
    ];

    const integrityFiles=packedInstall?.runtimeIntegrity?.files||[];
    if(integrityFiles.length){
        for(const file of integrityFiles){
            lines.push(
                `| ${markdownCell(file.path)} | ${file.expected.sha256} | `
                +`${file.actual.sha256} | ${file.matches?'yes':'no'} |`
            );
        }
    }else{
        lines.push('| not completed | n/a | n/a | no |');
    }

    lines.push(
        '',
        '## Bundled runtime dependency',
        '',
        packedInstall?.bundledDependency?.exists
            ?`Verified \`${packedInstall.bundledDependency.nestedPath}\` `
                +`(${packedInstall.bundledDependency.packageName} `
                +`${packedInstall.bundledDependency.version}, SHA-256 `
                +`${packedInstall.bundledDependency.sha256}).`
            :'Nested `node_modules/strong-type/index.js` verification was not completed.',
        '',
        '## Artifact inventory',
        '',
        '- `test-results.json`: vanilla-test browser results and source-integrity checks.',
        '- `coverage-summary.json` and `coverage-raw.json`: actual Chrome DevTools coverage.',
        '- `npm-pack.json`: machine-readable output from `npm pack --json`.',
        '- `packed-install.json`: clean-install, hash, nested-dependency, browser-smoke, and cleanup evidence.',
        '- `SHA256SUMS.txt`: SHA-256 checksums for the release files.',
        ''
    );

    return `${lines.join('\n')}\n`;
}

async function writeChecksums(){
    const entries=(await readdir(FILES_DIRECTORY,{withFileTypes:true}))
        .filter(entry=>entry.isFile()&&entry.name!=='SHA256SUMS.txt')
        .sort((left,right)=>left.name.localeCompare(right.name));
    const lines=[];

    for(const entry of entries){
        lines.push(`${await fileSha256(resolve(FILES_DIRECTORY,entry.name))}  ${entry.name}`);
    }

    await writeFile(
        resolve(FILES_DIRECTORY,'SHA256SUMS.txt'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
}

async function loadEvidenceOutputs(harness){
    const testResults=harness?.testResults
        ||await readJSONIfPresent(resolve(FILES_DIRECTORY,'test-results.json'));
    const coverageSummary=harness?.coverageSummary
        ||await readJSONIfPresent(resolve(FILES_DIRECTORY,'coverage-summary.json'));

    return {coverageSummary,testResults};
}

async function run(){
    const options=parseOptions(process.argv.slice(2));
    const packageMetadata=await readJSON(PACKAGE_JSON_PATH);

    packagePathSegments(packageMetadata.name);
    if(typeof packageMetadata.version!=='string'||packageMetadata.version.length===0){
        throw new TypeError('package.json must declare a package version.');
    }
    moduleTarget(packageMetadata);

    await removePreviousOutputs(packageMetadata);

    let failure=null;
    let harness=null;
    let pack=null;
    let packedInstall={
        cleanup:{removed:false,safeTemporaryPrefix:TEMPORARY_PREFIX},
        error:null,
        generatedAt:new Date().toISOString(),
        installation:{freshOsTemporaryFixture:false,scriptsDisabled:true},
        package:{name:packageMetadata.name,version:packageMetadata.version},
        schemaVersion:1,
        status:'not-run'
    };
    let stage='browser harness';

    try{
        harness=await runBrowserHarness(options);
        stage='npm pack';
        pack=await packPackage(packageMetadata);
        stage='packed install verification';
        packedInstall=await verifyPackedInstall({
            harness,
            options,
            pack,
            packageMetadata
        });
        if(packedInstall.status!=='passed'){
            const packedError=new Error(
                packedInstall.error?.message||'Packed install verification failed.'
            );
            packedError.code=packedInstall.error?.code||'PACKED_INSTALL_FAILED';
            throw packedError;
        }
    }catch(error){
        failure={error:serializeError(error),stage};
    }

    let finalizationFailure=null;

    try{
        await writeJSON(resolve(FILES_DIRECTORY,'packed-install.json'),packedInstall);
        const evidence=await loadEvidenceOutputs(harness);
        await Promise.all([
            writeJSON(resolve(BADGES_DIRECTORY,'tests.json'),testBadge(evidence.testResults)),
            writeJSON(
                resolve(BADGES_DIRECTORY,'coverage.json'),
                coverageBadge(evidence.coverageSummary)
            )
        ]);
        const markdown=releaseEvidenceMarkdown({
            ...evidence,
            failure,
            pack,
            packedInstall,
            packageMetadata
        });
        await writeFile(
            resolve(FILES_DIRECTORY,'release-evidence.md'),
            markdown,
            'utf8'
        );
        await writeChecksums();
    }catch(error){
        finalizationFailure={error:serializeError(error),stage:'evidence finalization'};
    }

    const releaseFailure=failure||finalizationFailure;
    if(releaseFailure){
        const error=new Error(
            `Release gate failed during ${releaseFailure.stage}: `
            +releaseFailure.error.message
        );
        error.code=releaseFailure.error.code||'RELEASE_GATE_FAILED';
        throw error;
    }

    const summary=harness.testResults.summary;
    const coverage=harness.coverageSummary.total.byteCoveragePercent;
    console.log(
        `Release gate PASSED for ${packageMetadata.name}@${packageMetadata.version}: `
        +`${summary.passed} tests passed; ${coverage.toFixed(2)}% measured coverage.`
    );
    console.log(`Tarball: ${resolve(FILES_DIRECTORY,pack.result.filename)}`);
    console.log(`Evidence: ${resolve(FILES_DIRECTORY,'release-evidence.md')}`);
}

await run().catch(error=>{
    console.error(error?.stack||error);
    process.exitCode=1;
});
