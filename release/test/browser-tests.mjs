import {
    createTestRegistry,
    serializeError,
    SUITE_NAMES
} from './harness.mjs';
import {removeApplicationScope} from './support.mjs';
import unitSuite from './suites/unit.mjs';
import functionalSuite from './suites/functional.mjs';
import integrationSuite from './suites/integration.mjs';
import regressionSuite from './suites/regression.mjs';

const PRIMARY_APPLICATION_ID='dbopfs-release-test-primary';
const PEER_APPLICATION_ID='dbopfs-release-test-peer';
const WORKER_APPLICATION_ID='dbopfs-release-test-worker';
const FRAMEWORK_VERSION='2.1.0';
const startedAt=new Date();
const startedMark=performance.now();
const suites=[unitSuite,functionalSuite,integrationSuite,regressionSuite];
const applicationIds={
    peer:PEER_APPLICATION_ID,
    primary:PRIMARY_APPLICATION_ID,
    worker:WORKER_APPLICATION_ID
};

function emptySuites(){
    return SUITE_NAMES.map(name=>({
        failed:0,
        name,
        passed:0,
        skipped:0,
        total:0
    }));
}

function renderSuites(suiteResults){
    const output=document.querySelector('#suite-results');
    if(!output){
        return;
    }

    output.replaceChildren();
    for(const suite of suiteResults){
        const item=document.createElement('li');
        item.dataset.status=suite.failed?'failed':'passed';
        const name=document.createElement('strong');
        const totals=document.createElement('span');
        name.textContent=suite.name;
        totals.textContent=(
            `${suite.passed} passed · ${suite.failed} failed · `
            +`${suite.skipped} skipped · ${suite.total} total`
        );
        item.append(name,totals);
        output.append(item);
    }
}

function publishResults(result){
    const failed=Boolean(
        result.fatalError
        ||result.summary.failed
        ||result.teardown.status==='failed'
    );
    globalThis.__DBOPFS_RELEASE_RESULTS__=result;
    globalThis.__DBOPFS_RELEASE_STATE__=failed?'failed':'passed';
    document.documentElement.dataset.status=globalThis.__DBOPFS_RELEASE_STATE__;

    const summary=document.querySelector('#summary');
    if(summary){
        summary.textContent=(
            `${result.summary.passed} passed · ${result.summary.failed} failed · `
            +`${result.summary.skipped} skipped · ${result.summary.total} total`
        );
    }
    renderSuites(result.suites);

    const output=document.querySelector('#results');
    if(output){
        output.textContent=JSON.stringify(result,null,2);
    }

    globalThis.dispatchEvent(new CustomEvent('dbopfs-release-tests-complete',{
        detail:result
    }));
}

async function environmentMetadata(){
    const persisted=typeof navigator.storage?.persisted==='function'
        ?await navigator.storage.persisted().catch(()=>null)
        :null;

    return {
        compressionStream:typeof CompressionStream==='function',
        createImageBitmap:typeof createImageBitmap==='function',
        decompressionStream:typeof DecompressionStream==='function',
        opfs:typeof navigator.storage?.getDirectory==='function',
        origin:location.origin,
        persisted,
        secureContext:globalThis.isSecureContext,
        userAgent:navigator.userAgent
    };
}

async function cleanupScopes(){
    if(typeof navigator.storage?.getDirectory!=='function'){
        return;
    }

    const errors=[];
    for(const applicationId of Object.values(applicationIds)){
        try{
            await removeApplicationScope(applicationId);
        }catch(error){
            errors.push(error);
        }
    }
    if(errors.length){
        throw new AggregateError(errors,'One or more release-test OPFS scopes could not be removed.');
    }
}

async function runBrowserTests(){
    const registry=createTestRegistry({frameworkVersion:FRAMEWORK_VERSION});
    const context={
        applicationIds,
        capabilities:{
            backup:typeof CompressionStream==='function'
                &&typeof DecompressionStream==='function'
                &&typeof createImageBitmap==='function'
                &&typeof HTMLCanvasElement.prototype.toBlob==='function'
        }
    };
    let fatalError=null;
    let registryResult=null;
    let teardown={
        durationMs:0,
        error:null,
        status:'passed'
    };

    try{
        await cleanupScopes();
        registryResult=await registry.run(suites,context);
    }catch(error){
        fatalError=serializeError(error);
    }finally{
        const teardownMark=performance.now();
        try{
            await cleanupScopes();
        }catch(error){
            teardown={
                durationMs:Number((performance.now()-teardownMark).toFixed(3)),
                error:serializeError(error),
                status:'failed'
            };
        }
        if(teardown.status==='passed'){
            teardown.durationMs=Number((performance.now()-teardownMark).toFixed(3));
        }
    }

    const result=registryResult||{
        cases:[],
        framework:{
            name:'vanilla-test',
            results:{failed:[],passed:[]},
            version:FRAMEWORK_VERSION
        },
        suites:emptySuites(),
        summary:{failed:0,passed:0,skipped:0,total:0}
    };

    publishResults({
        applicationIds,
        cases:result.cases,
        complete:true,
        durationMs:Number((performance.now()-startedMark).toFixed(3)),
        environment:await environmentMetadata(),
        fatalError,
        finishedAt:new Date().toISOString(),
        framework:result.framework,
        schemaVersion:1,
        startedAt:startedAt.toISOString(),
        suites:result.suites,
        summary:result.summary,
        teardown
    });
}

await runBrowserTests();
