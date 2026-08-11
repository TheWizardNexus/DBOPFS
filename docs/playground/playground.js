const elements={
    runtimeState:document.querySelector('#runtime-state'),
    runtimeDetail:document.querySelector('#runtime-detail'),
    form:document.querySelector('#record-form'),
    table:document.querySelector('#table-name'),
    file:document.querySelector('#file-name'),
    value:document.querySelector('#record-value'),
    append:document.querySelector('#append-value'),
    restoreFile:document.querySelector('#restore-file'),
    output:document.querySelector('#operation-output'),
    tree:document.querySelector('#storage-tree'),
    scope:document.querySelector('#scope-path'),
    generatedCode:document.querySelector('#generated-code')
};

let database=null;
let operationInProgress=false;
const capabilityState={
    backup:false,
    restore:false
};

function setCapability(name,available,label=''){
    const element=document.querySelector(`[data-capability="${name}"]`);

    if(!element){
        return;
    }

    element.dataset.state=available?'available':'unavailable';
    element.textContent=label||(available?'Available':'Unavailable');
}

function reportState(kind,title,detail){
    elements.runtimeState.className=`status-chip ${kind}`;
    elements.runtimeState.textContent=title;
    elements.runtimeDetail.textContent=detail;
}

function setDatabaseControls(enabled){
    for(const control of document.querySelectorAll('[data-requires-db]')){
        const missingOptionalCapability=(control.hasAttribute('data-requires-backup')&&!capabilityState.backup)
            ||(control.hasAttribute('data-requires-restore')&&!capabilityState.restore);
        control.disabled=!enabled||operationInProgress||missingOptionalCapability;
    }
}

function writeOutput(value){
    if(typeof value==='string'){
        elements.output.textContent=value;
        return;
    }

    elements.output.textContent=JSON.stringify(value,null,4);
}

function errorDetails(error){
    return {
        error:{
            name:error?.name||'Error',
            code:error?.code||null,
            message:error?.message||String(error)
        }
    };
}

function requireEntryName(value,label){
    const name=String(value||'').trim();

    if(!name){
        throw new Error(`${label} is required.`);
    }

    if(name==='.'||name==='..'||name.includes('/')||name.includes('\\')){
        throw new Error(`${label} must be one entry name, not a path.`);
    }

    return name;
}

function currentInput(){
    return {
        tableName:requireEntryName(elements.table.value,'Table'),
        fileName:requireEntryName(elements.file.value,'Record key'),
        sourceText:elements.value.value,
        append:elements.append.checked
    };
}

function extensionOf(fileName){
    const dot=fileName.lastIndexOf('.');
    return dot<0?'':fileName.slice(dot+1).toLowerCase();
}

function valueForWrite(fileName,sourceText,append){
    const extension=extensionOf(fileName);

    if(extension==='json'){
        if(append){
            throw new Error('Append is not available for .json records.');
        }

        return JSON.parse(sourceText);
    }

    return sourceText;
}

function literal(value){
    return JSON.stringify(value,null,4);
}

function updateGeneratedCode(action='set'){
    let input;

    try{
        input=currentInput();
    }catch(error){
        return;
    }

    const table=JSON.stringify(input.tableName);
    const file=JSON.stringify(input.fileName);
    const append=input.append?',\n    true':'';
    const actions={
        get:`const value=await dbopfs.get(${table},${file});`,
        list:`const records=await dbopfs.getAll(${table});`,
        count:`const total=await dbopfs.count(${table});`,
        metadata:`const metadata=await dbopfs.getFileMetadata(\n    ${table},\n    ${file}\n);`,
        delete:`await dbopfs.delete(${table},${file});`,
        'clear-table':`await dbopfs.clear(${table});`,
        backup:`await dbopfs.downloadCompressedPNG(\n    'dbopfs-playground-backup'\n);`,
        restore:`await dbopfs.restoreFromPNG(backupFile);`,
        reset:`await dbopfs.clearAllStorage();`
    };

    if(action!=='set'){
        elements.generatedCode.textContent=actions[action]||actions.get;
        return;
    }

    let value=input.sourceText;

    try{
        value=valueForWrite(input.fileName,input.sourceText,input.append);
    }catch(error){
        value=input.sourceText;
    }

    elements.generatedCode.textContent=`await dbopfs.set(\n    ${table},\n    ${file},\n    ${literal(value)}${append}\n);`;
}

async function renderTree(){
    if(!database){
        return;
    }

    const tables=(await database.getTableNames(true)).sort((a,b)=>a.localeCompare(b));
    const lines=[`${database.storagePath}/`];

    for(let tableIndex=0;tableIndex<tables.length;tableIndex++){
        const table=tables[tableIndex];
        const keys=(await database.getAllKeys(table)).sort((a,b)=>a.localeCompare(b));
        const tableIsLast=tableIndex===tables.length-1;
        lines.push(`${tableIsLast?'└──':'├──'} ${table}/`);

        for(let keyIndex=0;keyIndex<keys.length;keyIndex++){
            const keyIsLast=keyIndex===keys.length-1;
            lines.push(`${tableIsLast?'    ':'│   '}${keyIsLast?'└──':'├──'} ${keys[keyIndex]}`);
        }
    }

    elements.scope.textContent=database.storagePath;
    elements.tree.textContent=lines.join('\n');
}

async function performAction(action){
    if(!database||operationInProgress){
        return;
    }

    operationInProgress=true;
    setDatabaseControls(false);
    updateGeneratedCode(action);

    try{
        const input=currentInput();
        let result;

        switch(action){
            case 'set':{
                const value=valueForWrite(input.fileName,input.sourceText,input.append);
                result=await database.set(input.tableName,input.fileName,value,input.append);
                break;
            }
            case 'get':
                result=await database.get(input.tableName,input.fileName,true);
                break;
            case 'list':
                result=await database.getAll(input.tableName);
                break;
            case 'count':
                result={table:input.tableName,count:await database.count(input.tableName)};
                break;
            case 'metadata':
                result=await database.getFileMetadata(input.tableName,input.fileName);
                break;
            case 'delete':
                if(!window.confirm(`Delete ${input.tableName}/${input.fileName} from this playground?`)){
                    result={cancelled:true};
                    break;
                }
                result={deleted:await database.delete(input.tableName,input.fileName)};
                break;
            case 'clear-table':
                if(!window.confirm(`Delete every record in the ${input.tableName} playground table?`)){
                    result={cancelled:true};
                    break;
                }
                await database.clear(input.tableName);
                result={cleared:input.tableName};
                break;
            case 'backup':
                await database.downloadCompressedPNG('dbopfs-playground-backup');
                result={downloadStarted:true,scope:database.storagePath};
                break;
            case 'restore':{
                const backupFile=elements.restoreFile.files[0];
                if(!backupFile){
                    throw new Error('Select a DBOPFS PNG backup first.');
                }
                await database.restoreFromPNG(backupFile);
                result={restored:backupFile.name,scope:database.storagePath};
                break;
            }
            case 'reset':
                if(!window.confirm('Delete every record in the dbopfs-playground application scope?')){
                    result={cancelled:true};
                    break;
                }
                await database.clearAllStorage();
                result={reset:true,scope:database.storagePath};
                break;
            default:
                throw new Error('Unknown playground operation.');
        }

        writeOutput(result);
        await renderTree();
        reportState('success','Runtime ready',`${action} completed in ${database.storagePath}`);
    }catch(error){
        writeOutput(errorDetails(error));
        reportState('danger','Operation failed',error?.message||String(error));
    }finally{
        operationInProgress=false;
        setDatabaseControls(true);
    }
}

function installInteractions(){
    for(const button of document.querySelectorAll('[data-action]')){
        button.addEventListener('click',()=>performAction(button.dataset.action));
    }

    for(const input of [elements.table,elements.file,elements.value,elements.append]){
        input.addEventListener('input',()=>updateGeneratedCode('set'));
        input.addEventListener('change',()=>updateGeneratedCode('set'));
    }

    elements.form.addEventListener('submit',event=>event.preventDefault());
}

async function checkPersistence(){
    if(typeof navigator.storage?.persist!=='function'){
        setCapability('persist',false);
        return;
    }

    const alreadyPersistent=typeof navigator.storage.persisted==='function'
        ?await navigator.storage.persisted().catch(()=>false)
        :false;

    setCapability('persist',true,alreadyPersistent?'Granted':'Supported');
}

async function boot(){
    installInteractions();
    setDatabaseControls(false);
    updateGeneratedCode('set');

    setCapability('secure',globalThis.isSecureContext,globalThis.isSecureContext?'Secure':'Not secure');
    setCapability('opfs',typeof navigator.storage?.getDirectory==='function');
    setCapability('compress',typeof CompressionStream==='function');
    setCapability('decompress',typeof DecompressionStream==='function');
    setCapability('image',typeof createImageBitmap==='function');
    setCapability('worker',typeof Worker==='function');
    capabilityState.backup=typeof CompressionStream==='function';
    capabilityState.restore=typeof DecompressionStream==='function'
        &&typeof createImageBitmap==='function';
    await checkPersistence();

    if(!globalThis.isSecureContext||typeof navigator.storage?.getDirectory!=='function'){
        reportState('danger','Runtime unavailable','Use HTTPS or localhost in a browser with OPFS support.');
        setCapability('runtime',false);
        writeOutput({error:{message:'Secure-context OPFS is unavailable.'}});
        return;
    }

    try{
        await import('../arcane/modules/DBOPFS.js');
        database=window.dbopfs;

        if(!database?.readyPromise){
            throw new Error('The DBOPFS singleton did not initialize.');
        }

        await database.readyPromise;
        setCapability('runtime',true,'Ready');
        reportState('success','Runtime ready',`${database.applicationId} · ${database.storagePath}`);
        writeOutput({
            ready:database.ready,
            applicationId:database.applicationId,
            storagePath:database.storagePath
        });
        setDatabaseControls(true);
        await renderTree();
    }catch(error){
        setCapability('runtime',false,'Load failed');
        reportState('danger','Runtime unavailable',error?.message||String(error));
        writeOutput(errorDetails(error));
    }
}

boot();
