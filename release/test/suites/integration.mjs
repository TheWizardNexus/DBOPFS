import {
    assert,
    assertDeepEqual,
    assertEqual
} from '../harness.mjs';
import {
    ensureReleaseWorker,
    restoreProperty,
    workerRequest
} from '../support.mjs';

async function ensurePrimaryDatabase(context){
    if(!context.primaryDatabase){
        throw new Error('The Functional suite did not initialize DBOPFS.');
    }
    await context.primaryDatabase.readyPromise;
    return context.primaryDatabase;
}

async function ensureIsolation(context){
    if(!context.isolationSetupPromise){
        context.isolationSetupPromise=(async()=>{
            const primary=await ensurePrimaryDatabase(context);
            const syntheticDocument={
                documentElement:{dataset:{}},
                querySelector(){return null;}
            };

            globalThis.dbopfs=null;
            try{
                context.peerDatabase=new context.DBOPFS({
                    applicationId:context.applicationIds.peer,
                    documentObject:syntheticDocument,
                    storage:navigator.storage
                });
            }finally{
                globalThis.dbopfs=primary;
            }

            await context.peerDatabase.readyPromise;
            await context.peerDatabase.clearAllStorage();
        })();
    }

    await context.isolationSetupPromise;
    await context.primaryDatabase.set(
        'release-isolation',
        'shared.json',
        {owner:'primary'}
    );
    await context.peerDatabase.set(
        'release-isolation',
        'shared.json',
        {owner:'peer'}
    );
}

async function ensurePrimaryCleared(context){
    await ensureIsolation(context);
    await context.primaryDatabase.clearAllStorage();
}

async function ensureWorkerWrite(context){
    if(!context.workerWritePromise){
        context.workerWritePromise=(async()=>{
            const worker=await ensureReleaseWorker(context);
            const fileData=new TextEncoder().encode('worker-backed OPFS data').buffer;
            context.workerWriteResult=await workerRequest(worker,{
                append:false,
                applicationId:context.applicationIds.worker,
                directoryName:'release-worker',
                fileData,
                fileName:'worker.txt',
                operation:'write'
            },[fileData]);
        })();
    }
    await context.workerWritePromise;
}

function backupUnavailable(context){
    return !context.capabilities.backup;
}

function patchProperty(patches,target,name,descriptor){
    const originalDescriptor=Object.getOwnPropertyDescriptor(target,name);
    Object.defineProperty(target,name,descriptor);
    patches.push({name,originalDescriptor,target});
}

function restorePatches(patches){
    const errors=[];
    for(const patch of [...patches].reverse()){
        try{
            restoreProperty(patch.target,patch.name,patch.originalDescriptor);
        }catch(error){
            errors.push(error);
        }
    }
    return errors;
}

async function ensureBackup(context){
    if(!context.backupSetupPromise){
        context.backupSetupPromise=(async()=>{
            const database=await ensurePrimaryDatabase(context);
            const table='release-backup';
            const expected={message:'restored',sequence:[1,2,3]};
            let capturedBlob=null;
            let capturedDownloadName='';
            const patches=[];
            let operationError=null;

            try{
                patchProperty(patches,URL,'createObjectURL',{
                    configurable:true,
                    value(blob){
                        capturedBlob=blob;
                        return 'blob:dbopfs-release-test';
                    },
                    writable:true
                });
                patchProperty(patches,URL,'revokeObjectURL',{
                    configurable:true,
                    value(){},
                    writable:true
                });
                patchProperty(patches,HTMLAnchorElement.prototype,'click',{
                    configurable:true,
                    value(){capturedDownloadName=this.download;},
                    writable:true
                });
                await database.set(table,'backup.json',expected);
                await database.downloadCompressedPNG('dbopfs-release');
            }catch(error){
                operationError=error;
            }

            const restorationErrors=restorePatches(patches);
            if(restorationErrors.length){
                throw new AggregateError(
                    operationError?[operationError,...restorationErrors]:restorationErrors,
                    'The backup test could not restore its patched browser globals.'
                );
            }
            if(operationError){
                throw operationError;
            }

            context.backup={
                blob:capturedBlob,
                downloadName:capturedDownloadName,
                expected,
                table
            };
        })();
    }

    await context.backupSetupPromise;
}

async function clearBackupSource(context){
    await ensureBackup(context);
    await context.primaryDatabase.clear(context.backup.table);
}

const backupSkipReason='Chrome lacks a required compression, image-bitmap, or canvas API.';

export default {
    name:'Integration',
    cases:[
        {
            id:'integration.scope.primary-record',
            description:'the primary application reads its own identically named record',
            run:async context=>{
                await ensureIsolation(context);
                assertDeepEqual(
                    await context.primaryDatabase.get(
                        'release-isolation',
                        'shared.json',
                        true
                    ),
                    {owner:'primary'}
                );
            }
        },
        {
            id:'integration.scope.peer-record',
            description:'the peer application reads its own identically named record',
            run:async context=>{
                await ensureIsolation(context);
                assertDeepEqual(
                    await context.peerDatabase.get(
                        'release-isolation',
                        'shared.json',
                        true
                    ),
                    {owner:'peer'}
                );
            }
        },
        {
            id:'integration.scope.primary-clear',
            description:'clearing the primary application removes its isolated record',
            run:async context=>{
                await ensurePrimaryCleared(context);
                assertEqual(
                    await context.primaryDatabase.get(
                        'release-isolation',
                        'shared.json',
                        true
                    ),
                    null
                );
            }
        },
        {
            id:'integration.scope.peer-survives-clear',
            description:'clearing the primary application preserves the peer record',
            run:async context=>{
                await ensurePrimaryCleared(context);
                assertDeepEqual(
                    await context.peerDatabase.get(
                        'release-isolation',
                        'shared.json',
                        true
                    ),
                    {owner:'peer'}
                );
            }
        },
        {
            id:'integration.worker.write',
            description:'the production worker writes bytes to its application OPFS scope',
            run:async context=>{
                await ensureWorkerWrite(context);
                assertEqual(context.workerWriteResult.success,true);
            }
        },
        {
            id:'integration.worker.read',
            description:'the production worker reads the exact bytes written to OPFS',
            run:async context=>{
                await ensureWorkerWrite(context);
                const worker=await ensureReleaseWorker(context);
                const result=await workerRequest(worker,{
                    applicationId:context.applicationIds.worker,
                    directoryName:'release-worker',
                    fileName:'worker.txt',
                    operation:'read'
                });
                assertEqual(
                    new TextDecoder().decode(result.fileData),
                    'worker-backed OPFS data'
                );
            }
        },
        {
            id:'integration.backup.blob',
            description:'compressed backup export produces a browser Blob',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await ensureBackup(context);
                assert(context.backup.blob instanceof Blob,'Backup did not produce a Blob.');
            }
        },
        {
            id:'integration.backup.mime',
            description:'compressed backup export uses the PNG MIME type',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await ensureBackup(context);
                assertEqual(context.backup.blob.type,'image/png');
            }
        },
        {
            id:'integration.backup.nonempty',
            description:'compressed backup export contains encoded payload bytes',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await ensureBackup(context);
                assert(context.backup.blob.size>0,'Backup PNG was empty.');
            }
        },
        {
            id:'integration.backup.filename',
            description:'compressed backup export prefixes its timestamped download name',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await ensureBackup(context);
                assert(
                    /^dbopfs-release-\d{4}-\d{2}-\d{2}-/.test(
                        context.backup.downloadName
                    ),
                    'Backup download name did not use the requested prefix.'
                );
            }
        },
        {
            id:'integration.backup.clear-source',
            description:'clearing the backup source removes the stored record',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await clearBackupSource(context);
                assertEqual(
                    await context.primaryDatabase.get(
                        context.backup.table,
                        'backup.json',
                        true
                    ),
                    null
                );
            }
        },
        {
            id:'integration.backup.restore',
            description:'PNG backup restore recreates the exported structured record',
            skip:backupUnavailable,
            reason:backupSkipReason,
            run:async context=>{
                await clearBackupSource(context);
                await context.primaryDatabase.restoreFromPNG(context.backup.blob);
                assertDeepEqual(
                    await context.primaryDatabase.get(
                        context.backup.table,
                        'backup.json',
                        true
                    ),
                    context.backup.expected
                );
            }
        }
    ]
};
