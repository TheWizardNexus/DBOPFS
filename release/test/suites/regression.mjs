import {assertEqual,expectError} from '../harness.mjs';
import {ensureReleaseWorker,workerRequest} from '../support.mjs';

async function primaryDatabase(context){
    if(!context.primaryDatabase){
        throw new Error('The Functional suite did not initialize DBOPFS.');
    }
    await context.primaryDatabase.readyPromise;
    return context.primaryDatabase;
}

export default {
    name:'Regression',
    cases:[
        {
            id:'regression.write.append',
            description:'sequential append writes preserve the existing file prefix',
            run:async context=>{
                const database=await primaryDatabase(context);
                await database.set('release-write-locks','append.txt','alpha');
                await database.set('release-write-locks','append.txt','|beta',true);
                assertEqual(
                    await database.get('release-write-locks','append.txt',true),
                    'alpha|beta'
                );
            }
        },
        {
            id:'regression.write.concurrent-append',
            description:'concurrent append writes serialize in invocation order',
            run:async context=>{
                const database=await primaryDatabase(context);
                await database.set('release-write-locks','concurrent.txt','');
                await Promise.all([
                    database.set('release-write-locks','concurrent.txt','A',true),
                    database.set('release-write-locks','concurrent.txt','B',true),
                    database.set('release-write-locks','concurrent.txt','C',true),
                    database.set('release-write-locks','concurrent.txt','D',true)
                ]);
                assertEqual(
                    await database.get('release-write-locks','concurrent.txt',true),
                    'ABCD'
                );
            }
        },
        {
            id:'regression.write.concurrent-overwrite',
            description:'concurrent overwrite writes leave the last invoked value',
            run:async context=>{
                const database=await primaryDatabase(context);
                await Promise.all([
                    database.set('release-write-locks','last-write.txt','first'),
                    database.set('release-write-locks','last-write.txt','second'),
                    database.set('release-write-locks','last-write.txt','third')
                ]);
                assertEqual(
                    await database.get('release-write-locks','last-write.txt',true),
                    'third'
                );
            }
        },
        {
            id:'regression.worker.unsafe-scope',
            description:'the production worker rejects path-like application identities',
            run:async context=>{
                const worker=await ensureReleaseWorker(context);
                const emptyData=new ArrayBuffer(0);
                await expectError(
                    ()=>workerRequest(worker,{
                        append:false,
                        applicationId:'../unsafe',
                        directoryName:'release-worker',
                        fileData:emptyData,
                        fileName:'unsafe.txt',
                        operation:'write'
                    },[emptyData]),
                    {name:'SecurityError'}
                );
            }
        }
    ]
};
