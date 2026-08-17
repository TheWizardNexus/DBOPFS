import {
    assertEqual,
    expectError
} from '../harness.mjs';

const scopeModule=()=>import('/arcane/modules/AppDataScope.js');

function declarationDocument({meta=undefined,root=undefined}={}){
    return {
        documentElement:{
            dataset:root===undefined?{}:{arcaneAppId:root}
        },
        querySelector(selector){
            if(selector!=='meta[name="arcane-app-id"]'||meta===undefined){
                return null;
            }
            return {getAttribute:()=>meta};
        }
    };
}

function directoryFixture(){
    const calls=[];
    const application={name:'unit-app'};
    const applications={
        async getDirectoryHandle(name,options){
            calls.push({level:'application',name,options});
            return application;
        }
    };
    const root={
        async getDirectoryHandle(name,options){
            calls.push({level:'root',name,options});
            return applications;
        }
    };
    return {
        application,
        calls,
        storage:{getDirectory:async()=>root}
    };
}

export default {
    name:'Unit',
    cases:[
        {
            id:'unit.scope.canonical.accepts',
            description:'canonical application IDs accept lowercase hyphenated values',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.canonicalApplicationId('arcane-notes-2'),'arcane-notes-2');
            }
        },
        {
            id:'unit.scope.canonical.minimum-length',
            description:'canonical application IDs accept the one-character boundary',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.canonicalApplicationId('a'),'a');
            }
        },
        {
            id:'unit.scope.canonical.max-length',
            description:'canonical application IDs accept the 64-character boundary',
            run:async()=>{
                const scope=await scopeModule();
                const value='a'.repeat(64);
                assertEqual(scope.canonicalApplicationId(value),value);
            }
        },
        {
            id:'unit.scope.canonical.rejects-non-string',
            description:'canonical application IDs reject non-string values',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId(42),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-empty',
            description:'canonical application IDs reject empty strings',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId(''),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-uppercase',
            description:'canonical application IDs reject uppercase letters',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId('Arcane-notes'),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-leading-digit',
            description:'canonical application IDs reject a leading digit',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId('2-arcane'),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-empty-segment',
            description:'canonical application IDs reject empty hyphenated segments',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId('arcane--notes'),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-overlength',
            description:'canonical application IDs reject values longer than 64 characters',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId('a'.repeat(65)),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.canonical.rejects-separator',
            description:'canonical application IDs reject path separators',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.canonicalApplicationId('arcane/notes'),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.declaration.meta',
            description:'document declarations read the arcane application metadata',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(
                    scope.declaredApplicationId(declarationDocument({meta:'metadata-app'})),
                    'metadata-app'
                );
            }
        },
        {
            id:'unit.scope.declaration.dataset',
            description:'document declarations read the root application dataset',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(
                    scope.declaredApplicationId(declarationDocument({root:'dataset-app'})),
                    'dataset-app'
                );
            }
        },
        {
            id:'unit.scope.declaration.matching',
            description:'matching metadata and root declarations resolve one identity',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(
                    scope.declaredApplicationId(declarationDocument({
                        meta:'matching-app',
                        root:'matching-app'
                    })),
                    'matching-app'
                );
            }
        },
        {
            id:'unit.scope.declaration.absent',
            description:'documents without an application declaration resolve to null',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.declaredApplicationId(declarationDocument()),null);
            }
        },
        {
            id:'unit.scope.declaration.conflict',
            description:'conflicting document declarations fail closed',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.declaredApplicationId(declarationDocument({
                        meta:'metadata-app',
                        root:'dataset-app'
                    })),
                    {code:'APP_DATA_SCOPE_MISMATCH'}
                );
            }
        },
        {
            id:'unit.scope.declaration.invalid',
            description:'invalid document declarations are rejected',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.declaredApplicationId(declarationDocument({meta:'Invalid App'})),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.browser.explicit',
            description:'browser identity resolution accepts an explicit application ID',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.resolveBrowserApplicationId({
                    applicationId:'explicit-app',
                    documentObject:null
                }),'explicit-app');
            }
        },
        {
            id:'unit.scope.browser.declared',
            description:'browser identity resolution falls back to the document declaration',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.resolveBrowserApplicationId({
                    documentObject:declarationDocument({meta:'declared-app'})
                }),'declared-app');
            }
        },
        {
            id:'unit.scope.browser.matching',
            description:'matching configured and declared browser identities resolve once',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.resolveBrowserApplicationId({
                    applicationId:'matching-app',
                    documentObject:declarationDocument({meta:'matching-app'})
                }),'matching-app');
            }
        },
        {
            id:'unit.scope.browser.mismatch',
            description:'browser identity resolution rejects configured and declared mismatches',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.resolveBrowserApplicationId({
                        applicationId:'configured-app',
                        documentObject:declarationDocument({meta:'declared-app'})
                    }),
                    {code:'APP_DATA_SCOPE_MISMATCH'}
                );
            }
        },
        {
            id:'unit.scope.browser.required',
            description:'browser identity resolution requires an application identity',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.resolveBrowserApplicationId({documentObject:null}),
                    {code:'APP_DATA_SCOPE_REQUIRED'}
                );
            }
        },
        {
            id:'unit.scope.local-storage-key',
            description:'application local-storage keys include the canonical ownership prefix',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.resolveApplicationLocalStorageKey('preferences',{
                    applicationId:'local-app',
                    documentObject:null
                }),'arcane.apps.local-app:preferences');
            }
        },
        {
            id:'unit.scope.local-storage-falsey-key',
            description:'application local-storage keys preserve a falsey numeric key',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(scope.resolveApplicationLocalStorageKey(0,{
                    applicationId:'local-app',
                    documentObject:null
                }),'arcane.apps.local-app:0');
            }
        },
        {
            id:'unit.scope.native.bound',
            description:'native identity resolution accepts the Arcane-bound application ID',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(await scope.resolveApplicationId({
                    arcane:{app:{current:async()=>({id:'native-app'})}},
                    documentObject:null
                }),'native-app');
            }
        },
        {
            id:'unit.scope.native.browser-only',
            description:'asynchronous identity resolution accepts a browser-only identity',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(await scope.resolveApplicationId({
                    applicationId:'browser-app',
                    arcane:null,
                    documentObject:null
                }),'browser-app');
            }
        },
        {
            id:'unit.scope.native.matching',
            description:'matching native and browser identities resolve one application ID',
            run:async()=>{
                const scope=await scopeModule();
                assertEqual(await scope.resolveApplicationId({
                    arcane:{app:{current:async()=>({id:'shared-app'})}},
                    documentObject:declarationDocument({meta:'shared-app'})
                }),'shared-app');
            }
        },
        {
            id:'unit.scope.native.mismatch',
            description:'native and browser identity mismatches fail closed',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.resolveApplicationId({
                        arcane:{app:{current:async()=>({id:'native-app'})}},
                        documentObject:declarationDocument({meta:'browser-app'})
                    }),
                    {code:'APP_DATA_SCOPE_MISMATCH'}
                );
            }
        },
        {
            id:'unit.scope.native.invalid-descriptor',
            description:'invalid native application descriptors are rejected',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.resolveApplicationId({
                        arcane:{app:{current:async()=>null}},
                        documentObject:null
                    }),
                    {code:'APP_DATA_SCOPE_INVALID'}
                );
            }
        },
        {
            id:'unit.scope.native.required',
            description:'asynchronous identity resolution rejects an unbound caller',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.resolveApplicationId({arcane:null,documentObject:null}),
                    {code:'APP_DATA_SCOPE_REQUIRED'}
                );
            }
        },
        {
            id:'unit.scope.directory.hierarchy',
            description:'application directory opening traverses apps then the canonical ID',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(fixture.calls.length,2);
                assertEqual(fixture.calls[0].name,'apps');
                assertEqual(fixture.calls[1].name,'unit-app');
            }
        },
        {
            id:'unit.scope.directory.default-create',
            description:'application directory opening creates both hierarchy levels by default',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(fixture.calls[0].options.create,true);
                assertEqual(fixture.calls[1].options.create,true);
            }
        },
        {
            id:'unit.scope.directory.result-handle',
            description:'application directory opening returns the scoped directory handle',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                const result=await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(result.directory,fixture.application);
            }
        },
        {
            id:'unit.scope.directory.result-id',
            description:'application directory opening returns the resolved application ID',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                const result=await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(result.applicationId,'unit-app');
            }
        },
        {
            id:'unit.scope.directory.result-path',
            description:'application directory opening returns its application-relative path',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                const result=await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(result.path,'apps/unit-app');
            }
        },
        {
            id:'unit.scope.directory.read-only',
            description:'read-only directory opening forwards create false at both levels',
            run:async()=>{
                const scope=await scopeModule();
                const fixture=directoryFixture();
                await scope.openApplicationDataDirectory({
                    applicationId:'unit-app',
                    arcane:null,
                    create:false,
                    documentObject:null,
                    storage:fixture.storage
                });
                assertEqual(fixture.calls[0].options.create,false);
                assertEqual(fixture.calls[1].options.create,false);
            }
        },
        {
            id:'unit.scope.directory.storage-unavailable',
            description:'directory opening rejects an unavailable storage manager',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.openApplicationDataDirectory({
                        applicationId:'unit-app',
                        arcane:null,
                        documentObject:null,
                        storage:null
                    }),
                    {code:'APP_DATA_STORAGE_UNAVAILABLE'}
                );
            }
        },
        {
            id:'unit.scope.directory.root-unavailable',
            description:'directory opening rejects an invalid OPFS root handle',
            run:async()=>{
                const scope=await scopeModule();
                await expectError(
                    ()=>scope.openApplicationDataDirectory({
                        applicationId:'unit-app',
                        arcane:null,
                        documentObject:null,
                        storage:{getDirectory:async()=>({})}
                    }),
                    {code:'APP_DATA_STORAGE_UNAVAILABLE'}
                );
            }
        }
    ]
};
