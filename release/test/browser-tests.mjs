import VanillaTest from '/node_modules/vanilla-test/index.js';

const PRIMARY_APPLICATION_ID='dbopfs-release-test-primary';
const PEER_APPLICATION_ID='dbopfs-release-test-peer';
const WORKER_APPLICATION_ID='dbopfs-release-test-worker';
const FRAMEWORK_VERSION='1.4.9';
const startedAt=new Date();
const startedMark=performance.now();
const framework=new VanillaTest();
const cases=[];

let DBOPFS;
let primaryDatabase;
let peerDatabase;

function serializeError(error){
    return {
        message:error?.message||String(error),
        name:error?.name||'Error',
        stack:error?.stack||null
    };
}

function assert(condition,message='Assertion failed.'){
    if(!condition){
        throw new Error(message);
    }
}

function assertEqual(actual,expected,message='Values are not equal.'){
    if(!Object.is(actual,expected)){
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function canonicalValue(value){
    if(Array.isArray(value)){
        return value.map(canonicalValue);
    }
    if(value&&typeof value==='object'){
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key=>[key,canonicalValue(value[key])])
        );
    }
    return value;
}

function assertDeepEqual(actual,expected,message='Values are not deeply equal.'){
    const actualJSON=JSON.stringify(canonicalValue(actual));
    const expectedJSON=JSON.stringify(canonicalValue(expected));

    if(actualJSON!==expectedJSON){
        throw new Error(`${message}\nExpected: ${expectedJSON}\nActual: ${actualJSON}`);
    }
}

function withTimeout(promise,timeout,message){
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(
            ()=>reject(new Error(`${message} (${timeout}ms).`)),
            timeout
        );

        Promise.resolve(promise).then(
            value=>{
                clearTimeout(timer);
                resolve(value);
            },
            error=>{
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

async function waitFor(predicate,timeout,message){
    const deadline=performance.now()+timeout;

    while(performance.now()<deadline){
        if(predicate()){
            return;
        }

        await new Promise(resolve=>setTimeout(resolve,25));
    }

    throw new Error(`${message} (${timeout}ms).`);
}

async function runCase(description,operation,{skip=false,reason=''}={}){
    const caseStart=performance.now();
    let error=null;
    let status='passed';

    framework.expects(description);

    try{
        if(skip){
            status='skipped';
        }else{
            await operation();
        }
    }catch(caught){
        error=serializeError(caught);
        status='failed';
    }

    if(status==='failed'){
        framework.fail();
    }else{
        framework.pass();
    }

    framework.done();
    cases.push({
        description,
        durationMs:Number((performance.now()-caseStart).toFixed(3)),
        error,
        reason:status==='skipped'?reason:null,
        status
    });
}

async function removeApplicationScope(applicationId){
    const root=await navigator.storage.getDirectory();
    let applications;

    try{
        applications=await root.getDirectoryHandle('apps',{create:false});
    }catch(error){
        if(error?.name==='NotFoundError'){
            return;
        }
        throw error;
    }

    try{
        await applications.removeEntry(applicationId,{recursive:true});
    }catch(error){
        if(error?.name!=='NotFoundError'){
            throw error;
        }
    }
}

function workerRequest(worker,data,transfer=[],timeout=10000){
    const channel=new MessageChannel();

    return withTimeout(
        new Promise((resolve,reject)=>{
            channel.port1.onmessage=event=>{
                channel.port1.close();

                if(event.data?.error){
                    const error=new Error(event.data.error.message);
                    error.name=event.data.error.name;
                    reject(error);
                    return;
                }

                resolve(event.data);
            };
            channel.port1.start();

            try{
                worker.postMessage(data,[...transfer,channel.port2]);
            }catch(error){
                channel.port1.close();
                channel.port2.close();
                reject(error);
            }
        }),
        timeout,
        'The DBOPFS worker did not respond'
    );
}

function restoreProperty(target,name,descriptor){
    if(descriptor){
        Object.defineProperty(target,name,descriptor);
    }else{
        delete target[name];
    }
}

function publishResults(result){
    globalThis.__DBOPFS_RELEASE_RESULTS__=result;
    globalThis.__DBOPFS_RELEASE_STATE__=result.summary.failed?'failed':'passed';
    document.documentElement.dataset.status=globalThis.__DBOPFS_RELEASE_STATE__;

    const output=document.querySelector('#results');
    if(output){
        output.textContent=JSON.stringify(result,null,2);
    }

    globalThis.dispatchEvent(new CustomEvent('dbopfs-release-tests-complete',{
        detail:result
    }));
}

async function runSuite(){
    await runCase(
        'initializes the DBOPFS singleton on real localhost OPFS with the declared app id',
        async()=>{
            assert(
                typeof navigator.storage?.getDirectory==='function',
                'Chrome did not expose Origin Private File System storage.'
            );

            const readyEventPromise=new Promise(resolve=>{
                globalThis.addEventListener('dbopfs-ready',resolve,{once:true});
            });
            const imported=await import('/arcane/modules/DBOPFS.js');
            DBOPFS=imported.default;
            primaryDatabase=globalThis.dbopfs;

            assert(typeof DBOPFS==='function','DBOPFS did not expose its default class export.');
            assert(primaryDatabase,'DBOPFS did not install window.dbopfs.');
            await withTimeout(primaryDatabase.readyPromise,10000,'DBOPFS did not become ready');

            const readyEvent=await withTimeout(
                readyEventPromise,
                10000,
                'DBOPFS did not dispatch dbopfs-ready'
            );

            assertEqual(primaryDatabase.ready,true,'DBOPFS ready remained false.');
            assertEqual(primaryDatabase.applicationId,PRIMARY_APPLICATION_ID);
            assertEqual(primaryDatabase.storagePath,`apps/${PRIMARY_APPLICATION_ID}`);
            assertEqual(readyEvent.detail.dbopfs,primaryDatabase);
            assertEqual(readyEvent.detail.applicationId,PRIMARY_APPLICATION_ID);
            assertEqual(readyEvent.detail.storagePath,`apps/${PRIMARY_APPLICATION_ID}`);

            await primaryDatabase.clearAllStorage();
        }
    );

    await runCase('stores and retrieves JSON, text, JSONL, and NDJSON records',async()=>{
        const table='release-crud';
        const jsonValue={enabled:true,name:'arcane',nested:{count:3}};
        const jsonLines='{"id":1,"kind":"jsonl"}\n{"id":2,"kind":"jsonl"}\n';
        const ndjson='{"id":3,"kind":"ndjson"}\n{"id":4,"kind":"ndjson"}';

        await primaryDatabase.set(table,'profile.json',jsonValue);
        await primaryDatabase.set(table,'note.txt','plain text value');
        await primaryDatabase.set(table,'events.jsonl',jsonLines);
        await primaryDatabase.set(table,'events.ndjson',ndjson);

        assertDeepEqual(await primaryDatabase.get(table,'profile.json',true),jsonValue);
        assertEqual(await primaryDatabase.get(table,'note.txt',true),'plain text value');
        assertDeepEqual(
            await primaryDatabase.get(table,'events.jsonl',true),
            [{id:1,kind:'jsonl'},{id:2,kind:'jsonl'}]
        );
        assertDeepEqual(
            await primaryDatabase.get(table,'events.ndjson',true),
            [{id:3,kind:'ndjson'},{id:4,kind:'ndjson'}]
        );

        const rawFile=await primaryDatabase.readFile(table,'note.txt');
        assertEqual(await rawFile.text(),'plain text value');
    });

    await runCase('executes batch writes, batch reads, and table/database enumeration',async()=>{
        const table='release-batch';
        const items={
            'alpha.json':{order:1},
            'beta.txt':'second',
            'gamma.json':{order:3}
        };
        const setResults=await primaryDatabase.setMany(table,items);

        assertEqual(setResults.length,3);
        assert(setResults.every(result=>result.status==='fulfilled'),'setMany rejected an item.');

        const getResults=await primaryDatabase.getMany(
            table,
            ['alpha.json','beta.txt','gamma.json']
        );
        assert(getResults.every(result=>result.status==='fulfilled'),'getMany rejected an item.');
        assertDeepEqual(getResults.map(result=>result.value),[
            {order:1},
            'second',
            {order:3}
        ]);
        assertDeepEqual(await primaryDatabase.getAll(table),items);

        const allTables=await primaryDatabase.getAll();
        assertDeepEqual(allTables[table],items);
    });

    await runCase('serializes append operations and concurrent writes to one file',async()=>{
        const table='release-write-locks';

        await primaryDatabase.set(table,'append.txt','alpha');
        await primaryDatabase.set(table,'append.txt','|beta',true);
        assertEqual(await primaryDatabase.get(table,'append.txt',true),'alpha|beta');

        await primaryDatabase.set(table,'concurrent.txt','');
        await Promise.all([
            primaryDatabase.set(table,'concurrent.txt','A',true),
            primaryDatabase.set(table,'concurrent.txt','B',true),
            primaryDatabase.set(table,'concurrent.txt','C',true),
            primaryDatabase.set(table,'concurrent.txt','D',true)
        ]);
        assertEqual(await primaryDatabase.get(table,'concurrent.txt',true),'ABCD');

        await Promise.all([
            primaryDatabase.set(table,'last-write.txt','first'),
            primaryDatabase.set(table,'last-write.txt','second'),
            primaryDatabase.set(table,'last-write.txt','third')
        ]);
        assertEqual(await primaryDatabase.get(table,'last-write.txt',true),'third');
    });

    await runCase(
        'reports metadata, keys, discovery, filters, counts, deletion, clearing, and table removal',
        async()=>{
            const table='release-inspection';
            await primaryDatabase.setMany(table,{
                'alpha-one.json':{value:1},
                'alpha-two.txt':'two',
                'beta.txt':'beta'
            });

            const metadata=await primaryDatabase.getFileMetadata(table,'beta.txt');
            assert(typeof metadata.lastModified==='number'&&metadata.lastModified>0);
            assertEqual(metadata.size,new TextEncoder().encode('beta').byteLength);
            assertEqual(typeof metadata.type,'string');

            const keys=(await primaryDatabase.getAllKeys(table)).sort();
            assertDeepEqual(keys,['alpha-one.json','alpha-two.txt','beta.txt']);
            assert((await primaryDatabase.getTableNames(true)).includes(table));
            assertDeepEqual(
                Object.keys(await primaryDatabase.filterKeyIncludes(table,'alpha')).sort(),
                ['alpha-one.json','alpha-two.txt']
            );
            assertEqual(await primaryDatabase.count(table),3);
            assertEqual(await primaryDatabase.hasKey(table,'beta.txt'),true);
            assertEqual(await primaryDatabase.hasKey(table,'missing.txt'),false);

            await primaryDatabase.delete(table,'alpha-one.json');
            assertEqual(await primaryDatabase.get(table,'alpha-one.json',true),null);
            const deleteResults=await primaryDatabase.deleteMany(
                table,
                ['alpha-two.txt','beta.txt']
            );
            assert(deleteResults.every(result=>result.status==='fulfilled'));
            assertEqual(await primaryDatabase.count(table),0);

            await primaryDatabase.set(table,'temporary.txt','temporary');
            await primaryDatabase.clear(table);
            assertEqual(await primaryDatabase.count(table),0);

            await primaryDatabase.deleteTable(table);
            assert(!(await primaryDatabase.getTableNames(true)).includes(table));
        }
    );

    await runCase('isolates identical records and clear-all operations by application id',async()=>{
        const syntheticDocument={
            documentElement:{dataset:{}},
            querySelector(){return null;}
        };

        globalThis.dbopfs=null;
        try{
            peerDatabase=new DBOPFS({
                applicationId:PEER_APPLICATION_ID,
                documentObject:syntheticDocument,
                storage:navigator.storage
            });
        }finally{
            globalThis.dbopfs=primaryDatabase;
        }

        await peerDatabase.readyPromise;
        await peerDatabase.clearAllStorage();

        await primaryDatabase.set('release-isolation','shared.json',{owner:'primary'});
        await peerDatabase.set('release-isolation','shared.json',{owner:'peer'});
        assertDeepEqual(
            await primaryDatabase.get('release-isolation','shared.json',true),
            {owner:'primary'}
        );
        assertDeepEqual(
            await peerDatabase.get('release-isolation','shared.json',true),
            {owner:'peer'}
        );

        await primaryDatabase.clearAllStorage();
        assertEqual(
            await primaryDatabase.get('release-isolation','shared.json',true),
            null
        );
        assertDeepEqual(
            await peerDatabase.get('release-isolation','shared.json',true),
            {owner:'peer'}
        );
    });

    await runCase('executes the production DBOPFS worker against real OPFS',async()=>{
        await removeApplicationScope(WORKER_APPLICATION_ID);
        globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_READY__=false;
        globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__=null;

        const worker=new Worker('/arcane/modules/DBOPFSWorker.js');
        globalThis.__DBOPFS_RELEASE_WORKER__=worker;

        if(new URLSearchParams(location.search).get('coverage')==='1'){
            await waitFor(
                ()=>globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_READY__
                    ||globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__,
                10000,
                'The Chrome driver did not attach worker coverage'
            );

            if(globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__){
                throw new Error(globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__);
            }
        }

        const encoder=new TextEncoder();
        const fileData=encoder.encode('worker-backed OPFS data').buffer;
        const writeResult=await workerRequest(
            worker,
            {
                append:false,
                applicationId:WORKER_APPLICATION_ID,
                directoryName:'release-worker',
                fileData,
                fileName:'worker.txt',
                operation:'write'
            },
            [fileData]
        );
        assertEqual(writeResult.success,true);

        const readResult=await workerRequest(worker,{
            applicationId:WORKER_APPLICATION_ID,
            directoryName:'release-worker',
            fileName:'worker.txt',
            operation:'read'
        });
        assertEqual(
            new TextDecoder().decode(readResult.fileData),
            'worker-backed OPFS data'
        );

        let unsafeError=null;
        try{
            const emptyData=new ArrayBuffer(0);
            await workerRequest(
                worker,
                {
                    append:false,
                    applicationId:'../unsafe',
                    directoryName:'release-worker',
                    fileData:emptyData,
                    fileName:'unsafe.txt',
                    operation:'write'
                },
                [emptyData]
            );
        }catch(error){
            unsafeError=error;
        }
        assertEqual(unsafeError?.name,'SecurityError');
    });

    const backupSupported=typeof CompressionStream==='function'
        &&typeof DecompressionStream==='function'
        &&typeof createImageBitmap==='function'
        &&typeof HTMLCanvasElement.prototype.toBlob==='function';

    await runCase(
        'downloads and restores the compressed PNG backup format when Chrome supports it',
        async()=>{
            const table='release-backup';
            const expected={message:'restored',sequence:[1,2,3]};
            let capturedBlob=null;
            let capturedDownloadName='';
            const createObjectURLDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');
            const revokeObjectURLDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
            const clickDescriptor=Object.getOwnPropertyDescriptor(
                HTMLAnchorElement.prototype,
                'click'
            );

            Object.defineProperty(URL,'createObjectURL',{
                configurable:true,
                value(blob){
                    capturedBlob=blob;
                    return 'blob:dbopfs-release-test';
                },
                writable:true
            });
            Object.defineProperty(URL,'revokeObjectURL',{
                configurable:true,
                value(){},
                writable:true
            });
            Object.defineProperty(HTMLAnchorElement.prototype,'click',{
                configurable:true,
                value(){capturedDownloadName=this.download;},
                writable:true
            });

            try{
                await primaryDatabase.set(table,'backup.json',expected);
                await primaryDatabase.downloadCompressedPNG('dbopfs-release');
            }finally{
                restoreProperty(URL,'createObjectURL',createObjectURLDescriptor);
                restoreProperty(URL,'revokeObjectURL',revokeObjectURLDescriptor);
                restoreProperty(HTMLAnchorElement.prototype,'click',clickDescriptor);
            }

            assert(capturedBlob instanceof Blob,'Backup did not produce a Blob.');
            assertEqual(capturedBlob.type,'image/png');
            assert(capturedBlob.size>0,'Backup PNG was empty.');
            assert(
                /^dbopfs-release-\d{4}-\d{2}-\d{2}-/.test(capturedDownloadName),
                'Backup download name did not use the requested prefix.'
            );

            await primaryDatabase.clear(table);
            assertEqual(await primaryDatabase.get(table,'backup.json',true),null);
            await primaryDatabase.restoreFromPNG(capturedBlob);
            assertDeepEqual(await primaryDatabase.get(table,'backup.json',true),expected);
        },
        {
            reason:'Chrome lacks a required compression, image-bitmap, or canvas API.',
            skip:!backupSupported
        }
    );

    await runCase('removes all release-test OPFS application scopes',async()=>{
        await removeApplicationScope(PRIMARY_APPLICATION_ID);
        await removeApplicationScope(PEER_APPLICATION_ID);
        await removeApplicationScope(WORKER_APPLICATION_ID);
    });

    const vanillaResults=framework.report(false);
    const summary={
        failed:cases.filter(testCase=>testCase.status==='failed').length,
        passed:cases.filter(testCase=>testCase.status==='passed').length,
        skipped:cases.filter(testCase=>testCase.status==='skipped').length,
        total:cases.length
    };
    const persisted=typeof navigator.storage.persisted==='function'
        ?await navigator.storage.persisted().catch(()=>null)
        :null;

    publishResults({
        applicationIds:{
            peer:PEER_APPLICATION_ID,
            primary:PRIMARY_APPLICATION_ID,
            worker:WORKER_APPLICATION_ID
        },
        cases,
        complete:true,
        durationMs:Number((performance.now()-startedMark).toFixed(3)),
        environment:{
            compressionStream:typeof CompressionStream==='function',
            decompressionStream:typeof DecompressionStream==='function',
            opfs:typeof navigator.storage?.getDirectory==='function',
            origin:location.origin,
            persisted,
            secureContext:globalThis.isSecureContext,
            userAgent:navigator.userAgent
        },
        finishedAt:new Date().toISOString(),
        framework:{
            name:'vanilla-test',
            results:vanillaResults,
            version:FRAMEWORK_VERSION
        },
        schemaVersion:1,
        startedAt:startedAt.toISOString(),
        summary
    });
}

runSuite().catch(error=>{
    const serialized=serializeError(error);
    const summary={failed:1,passed:0,skipped:0,total:1};

    try{
        framework.expects('the browser release harness completes');
        framework.fail();
        framework.done();
    }catch{
        // Preserve the original fatal harness error below.
    }

    let vanillaResults={failed:[],passed:[]};
    try{
        vanillaResults=framework.report(false);
    }catch{
        // The machine-readable fatal result remains available to the driver.
    }

    publishResults({
        cases:[{
            description:'the browser release harness completes',
            durationMs:Number((performance.now()-startedMark).toFixed(3)),
            error:serialized,
            reason:null,
            status:'failed'
        }],
        complete:true,
        durationMs:Number((performance.now()-startedMark).toFixed(3)),
        environment:{
            origin:location.origin,
            userAgent:navigator.userAgent
        },
        fatalError:serialized,
        finishedAt:new Date().toISOString(),
        framework:{
            name:'vanilla-test',
            results:vanillaResults,
            version:FRAMEWORK_VERSION
        },
        schemaVersion:1,
        startedAt:startedAt.toISOString(),
        summary
    });
});
