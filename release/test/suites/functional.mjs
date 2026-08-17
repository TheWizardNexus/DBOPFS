import {
    assert,
    assertDeepEqual,
    assertEqual,
    withTimeout
} from '../harness.mjs';

async function ensureDatabase(context){
    if(!context.databaseImportPromise){
        context.readyEventPromise=new Promise(resolve=>{
            globalThis.addEventListener('dbopfs-ready',resolve,{once:true});
        });
        context.databaseImportPromise=import('/arcane/modules/DBOPFS.js').then(imported=>{
            context.DBOPFS=imported.default;
            context.primaryDatabase=globalThis.dbopfs;
            return context.primaryDatabase;
        });
    }

    await context.databaseImportPromise;
    return context.primaryDatabase;
}

async function ensureReadyEvent(context){
    await ensureDatabase(context);
    if(!context.readyEventResultPromise){
        context.readyEventResultPromise=withTimeout(
            context.readyEventPromise,
            10000,
            'DBOPFS did not dispatch dbopfs-ready'
        ).then(event=>{
            context.readyEvent=event;
            return event;
        });
    }
    return context.readyEventResultPromise;
}

async function ensureTextRecord(context){
    if(!context.textRecordPromise){
        context.textRecordPromise=ensureDatabase(context).then(database=>
            database.set('release-crud','note.txt','plain text value')
        );
    }
    await context.textRecordPromise;
}

async function ensureBatch(context){
    if(!context.batchSetup){
        context.batchTable='release-batch';
        context.batchItems={
            'alpha.json':{order:1},
            'beta.txt':'second',
            'gamma.json':{order:3}
        };
        context.batchSetup=(async()=>{
            const database=await ensureDatabase(context);
            context.batchSetResults=await database.setMany(
                context.batchTable,
                context.batchItems
            );
        })();
    }
    await context.batchSetup;
}

async function ensureBatchReads(context){
    await ensureBatch(context);
    if(!context.batchReadPromise){
        context.batchReadPromise=context.primaryDatabase.getMany(
            context.batchTable,
            ['alpha.json','beta.txt','gamma.json']
        ).then(results=>{
            context.batchGetResults=results;
        });
    }
    await context.batchReadPromise;
}

async function ensureInspection(context){
    if(!context.inspectionSetup){
        context.inspectionTable='release-inspection';
        context.inspectionSetup=(async()=>{
            const database=await ensureDatabase(context);
            await database.setMany(context.inspectionTable,{
                'alpha-one.json':{value:1},
                'alpha-two.txt':'two',
                'beta.txt':'beta'
            });
        })();
    }
    await context.inspectionSetup;
}

export default {
    name:'Functional',
    cases:[
        {
            id:'functional.environment.opfs',
            description:'Chrome exposes the Origin Private File System API',
            run:async()=>{
                assert(
                    typeof navigator.storage?.getDirectory==='function',
                    'Chrome did not expose Origin Private File System storage.'
                );
            }
        },
        {
            id:'functional.module.default-export',
            description:'DBOPFS exposes its class as the default module export',
            run:async context=>{
                await ensureDatabase(context);
                assert(typeof context.DBOPFS==='function','DBOPFS did not expose its class.');
            }
        },
        {
            id:'functional.module.singleton',
            description:'DBOPFS installs its browser singleton on window',
            run:async context=>{
                await ensureDatabase(context);
                assert(context.primaryDatabase,'DBOPFS did not install window.dbopfs.');
            }
        },
        {
            id:'functional.module.ready',
            description:'DBOPFS becomes ready after its ready promise resolves',
            run:async context=>{
                const database=await ensureDatabase(context);
                await withTimeout(database.readyPromise,10000,'DBOPFS did not become ready');
                assertEqual(database.ready,true,'DBOPFS ready remained false.');
            }
        },
        {
            id:'functional.module.application-id',
            description:'DBOPFS uses the declared application ID',
            run:async context=>{
                const database=await ensureDatabase(context);
                await database.readyPromise;
                assertEqual(database.applicationId,context.applicationIds.primary);
            }
        },
        {
            id:'functional.module.storage-path',
            description:'DBOPFS reports its application-relative storage path',
            run:async context=>{
                const database=await ensureDatabase(context);
                await database.readyPromise;
                assertEqual(database.storagePath,`apps/${context.applicationIds.primary}`);
            }
        },
        {
            id:'functional.ready-event.database',
            description:'the ready event exposes the initialized DBOPFS instance',
            run:async context=>{
                const event=await ensureReadyEvent(context);
                assertEqual(event.detail.dbopfs,context.primaryDatabase);
            }
        },
        {
            id:'functional.ready-event.application-id',
            description:'the ready event reports the declared application ID',
            run:async context=>{
                const event=await ensureReadyEvent(context);
                assertEqual(event.detail.applicationId,context.applicationIds.primary);
            }
        },
        {
            id:'functional.ready-event.storage-path',
            description:'the ready event reports the application storage path',
            run:async context=>{
                const event=await ensureReadyEvent(context);
                assertEqual(event.detail.storagePath,`apps/${context.applicationIds.primary}`);
            }
        },
        {
            id:'functional.records.json',
            description:'JSON records round-trip as structured values',
            run:async context=>{
                const database=await ensureDatabase(context);
                const expected={enabled:true,name:'arcane',nested:{count:3}};
                await database.set('release-crud','profile.json',expected);
                assertDeepEqual(await database.get('release-crud','profile.json',true),expected);
            }
        },
        {
            id:'functional.records.text',
            description:'text records round-trip without content changes',
            run:async context=>{
                await ensureTextRecord(context);
                assertEqual(
                    await context.primaryDatabase.get('release-crud','note.txt',true),
                    'plain text value'
                );
            }
        },
        {
            id:'functional.records.jsonl',
            description:'JSONL records parse into ordered row values',
            run:async context=>{
                const database=await ensureDatabase(context);
                await database.set(
                    'release-crud',
                    'events.jsonl',
                    '{"id":1,"kind":"jsonl"}\n{"id":2,"kind":"jsonl"}\n'
                );
                assertDeepEqual(
                    await database.get('release-crud','events.jsonl',true),
                    [{id:1,kind:'jsonl'},{id:2,kind:'jsonl'}]
                );
            }
        },
        {
            id:'functional.records.ndjson',
            description:'NDJSON records parse into ordered row values',
            run:async context=>{
                const database=await ensureDatabase(context);
                await database.set(
                    'release-crud',
                    'events.ndjson',
                    '{"id":3,"kind":"ndjson"}\n{"id":4,"kind":"ndjson"}'
                );
                assertDeepEqual(
                    await database.get('release-crud','events.ndjson',true),
                    [{id:3,kind:'ndjson'},{id:4,kind:'ndjson'}]
                );
            }
        },
        {
            id:'functional.records.raw-file',
            description:'readFile exposes the exact stored text bytes',
            run:async context=>{
                await ensureTextRecord(context);
                const file=await context.primaryDatabase.readFile('release-crud','note.txt');
                assertEqual(await file.text(),'plain text value');
            }
        },
        {
            id:'functional.batch.set-count',
            description:'setMany returns one result for every requested record',
            run:async context=>{
                await ensureBatch(context);
                assertEqual(context.batchSetResults.length,3);
            }
        },
        {
            id:'functional.batch.set-status',
            description:'setMany fulfills every valid record write',
            run:async context=>{
                await ensureBatch(context);
                assert(
                    context.batchSetResults.every(result=>result.status==='fulfilled'),
                    'setMany rejected a valid item.'
                );
            }
        },
        {
            id:'functional.batch.get-status',
            description:'getMany fulfills every existing record read',
            run:async context=>{
                await ensureBatchReads(context);
                assert(
                    context.batchGetResults.every(result=>result.status==='fulfilled'),
                    'getMany rejected an existing item.'
                );
            }
        },
        {
            id:'functional.batch.get-order',
            description:'getMany preserves the requested record order',
            run:async context=>{
                await ensureBatchReads(context);
                assertDeepEqual(context.batchGetResults.map(result=>result.value),[
                    {order:1},
                    'second',
                    {order:3}
                ]);
            }
        },
        {
            id:'functional.enumeration.table-values',
            description:'getAll returns every record in a selected table',
            run:async context=>{
                await ensureBatch(context);
                assertDeepEqual(
                    await context.primaryDatabase.getAll(context.batchTable),
                    context.batchItems
                );
            }
        },
        {
            id:'functional.enumeration.database-values',
            description:'database-wide getAll includes the selected table values',
            run:async context=>{
                await ensureBatch(context);
                const allTables=await context.primaryDatabase.getAll();
                assertDeepEqual(allTables[context.batchTable],context.batchItems);
            }
        },
        {
            id:'functional.metadata.last-modified',
            description:'file metadata reports a positive modification timestamp',
            run:async context=>{
                await ensureInspection(context);
                const metadata=await context.primaryDatabase.getFileMetadata(
                    context.inspectionTable,
                    'beta.txt'
                );
                assert(
                    typeof metadata.lastModified==='number'&&metadata.lastModified>0,
                    'The file modification timestamp is unavailable.'
                );
            }
        },
        {
            id:'functional.metadata.size',
            description:'file metadata reports the encoded byte length',
            run:async context=>{
                await ensureInspection(context);
                const metadata=await context.primaryDatabase.getFileMetadata(
                    context.inspectionTable,
                    'beta.txt'
                );
                assertEqual(metadata.size,new TextEncoder().encode('beta').byteLength);
            }
        },
        {
            id:'functional.metadata.type',
            description:'file metadata exposes a string MIME type',
            run:async context=>{
                await ensureInspection(context);
                const metadata=await context.primaryDatabase.getFileMetadata(
                    context.inspectionTable,
                    'beta.txt'
                );
                assertEqual(typeof metadata.type,'string');
            }
        },
        {
            id:'functional.enumeration.keys',
            description:'getAllKeys enumerates every file in the table',
            run:async context=>{
                await ensureInspection(context);
                const keys=(await context.primaryDatabase.getAllKeys(context.inspectionTable)).sort();
                assertDeepEqual(keys,['alpha-one.json','alpha-two.txt','beta.txt']);
            }
        },
        {
            id:'functional.enumeration.tables',
            description:'table discovery includes physically stored custom tables',
            run:async context=>{
                await ensureInspection(context);
                assert(
                    (await context.primaryDatabase.getTableNames(true))
                        .includes(context.inspectionTable),
                    'The inspection table was not discovered.'
                );
            }
        },
        {
            id:'functional.query.filter-keys',
            description:'key filtering returns only names containing the substring',
            run:async context=>{
                await ensureInspection(context);
                assertDeepEqual(
                    Object.keys(await context.primaryDatabase.filterKeyIncludes(
                        context.inspectionTable,
                        'alpha'
                    )).sort(),
                    ['alpha-one.json','alpha-two.txt']
                );
            }
        },
        {
            id:'functional.query.count',
            description:'count reports the number of records in a table',
            run:async context=>{
                await ensureInspection(context);
                assertEqual(await context.primaryDatabase.count(context.inspectionTable),3);
            }
        },
        {
            id:'functional.query.has-existing-key',
            description:'hasKey returns true for an existing record',
            run:async context=>{
                await ensureInspection(context);
                assertEqual(
                    await context.primaryDatabase.hasKey(context.inspectionTable,'beta.txt'),
                    true
                );
            }
        },
        {
            id:'functional.query.has-missing-key',
            description:'hasKey returns false for a missing record',
            run:async context=>{
                await ensureInspection(context);
                assertEqual(
                    await context.primaryDatabase.hasKey(context.inspectionTable,'missing.txt'),
                    false
                );
            }
        },
        {
            id:'functional.delete.single-record',
            description:'delete removes one selected record',
            run:async context=>{
                const database=await ensureDatabase(context);
                const table='release-delete-single';
                await database.set(table,'selected.json',{remove:true});
                await database.delete(table,'selected.json');
                assertEqual(
                    await database.get(table,'selected.json',true),
                    null
                );
            }
        },
        {
            id:'functional.delete.multiple-status',
            description:'deleteMany fulfills every requested record deletion',
            run:async context=>{
                const database=await ensureDatabase(context);
                const table='release-delete-many-status';
                await database.setMany(table,{
                    'first.txt':'first',
                    'second.txt':'second'
                });
                const results=await database.deleteMany(
                    table,
                    ['first.txt','second.txt']
                );
                assert(
                    results.every(result=>result.status==='fulfilled'),
                    'deleteMany rejected a valid deletion.'
                );
            }
        },
        {
            id:'functional.delete.multiple-empty',
            description:'deleteMany leaves the table empty after deleting all remaining records',
            run:async context=>{
                const database=await ensureDatabase(context);
                const table='release-delete-many-empty';
                await database.setMany(table,{
                    'first.txt':'first',
                    'second.txt':'second'
                });
                await database.deleteMany(table,['first.txt','second.txt']);
                assertEqual(await database.count(table),0);
            }
        },
        {
            id:'functional.delete.clear-table',
            description:'clear removes every record while retaining the table',
            run:async context=>{
                const database=await ensureDatabase(context);
                const table='release-clear-table';
                await database.set(table,'temporary.txt','temporary');
                await database.clear(table);
                assertEqual(await database.count(table),0);
            }
        },
        {
            id:'functional.delete.table',
            description:'deleteTable removes the physical table directory',
            run:async context=>{
                const database=await ensureDatabase(context);
                const table='release-delete-table';
                await database.set(table,'temporary.txt','temporary');
                await database.deleteTable(table);
                assert(
                    !(await database.getTableNames(true)).includes(table),
                    'The deleted table remains discoverable.'
                );
            }
        }
    ]
};
