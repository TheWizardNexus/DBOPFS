import {waitFor,withTimeout} from './harness.mjs';

export async function removeApplicationScope(applicationId){
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

export function restoreProperty(target,name,descriptor){
    if(descriptor){
        Object.defineProperty(target,name,descriptor);
    }else{
        delete target[name];
    }
}

export function workerRequest(worker,data,transfer=[],timeout=10000){
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

export async function ensureReleaseWorker(context){
    if(!context.workerSetupPromise){
        context.workerSetupPromise=(async()=>{
            await removeApplicationScope(context.applicationIds.worker);
            globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_READY__=false;
            globalThis.__DBOPFS_RELEASE_WORKER_COVERAGE_ERROR__=null;

            const worker=new Worker('/arcane/modules/DBOPFSWorker.js');
            context.worker=worker;
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

            return worker;
        })();
    }

    return context.workerSetupPromise;
}
