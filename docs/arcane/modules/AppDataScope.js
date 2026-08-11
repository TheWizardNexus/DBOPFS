const APPLICATION_ID_PATTERN=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const APPLICATION_ID_MAX_LENGTH=64;
const APP_DATA_DIRECTORY='apps';
const APP_LOCAL_STORAGE_PREFIX='arcane.apps.';

function scopeError(code,message){
    const error=new Error(message);
    error.code=code;
    return error;
}

/**
 * Validates the canonical application identifier used by Arcane packages,
 * the native host, and application-owned data folders.
 *
 * @param {*} value
 * @param {string} label
 * @returns {string}
 */
export function canonicalApplicationId(value,label='applicationId'){
    if(typeof value!=='string'
        ||value.length<1
        ||value.length>APPLICATION_ID_MAX_LENGTH
        ||!APPLICATION_ID_PATTERN.test(value)){
        throw scopeError(
            'APP_DATA_SCOPE_INVALID',
            `${label} must be a canonical Arcane application identifier.`
        );
    }

    return value;
}

/**
 * Reads the immutable application declaration from a document. Application
 * pages declare this before storage modules run so standalone browser builds
 * do not depend on their mount path for identity.
 *
 * @param {Document|Object|null} documentObject
 * @returns {string|null}
 */
export function declaredApplicationId(documentObject=globalThis.document){
    const metaValue=documentObject
        ?.querySelector?.('meta[name="arcane-app-id"]')
        ?.getAttribute?.('content');
    const rootValue=documentObject?.documentElement?.dataset?.arcaneAppId;
    const declarations=[metaValue,rootValue]
        .filter(value=>value!==null&&value!==undefined&&value!=='')
        .map((value,index)=>canonicalApplicationId(
            value,
            index===0?'arcane-app-id metadata':'document application id'
        ));

    if(new Set(declarations).size>1){
        throw scopeError(
            'APP_DATA_SCOPE_MISMATCH',
            'The document contains conflicting Arcane application identities.'
        );
    }

    return declarations[0]||null;
}

/**
 * Resolves the synchronous browser declaration used by storage mechanisms
 * such as localStorage. Native-capable asynchronous callers must use
 * resolveApplicationId so the host-bound identity remains authoritative.
 *
 * @param {Object} options
 * @param {string|null} options.applicationId
 * @param {Document|Object|null} options.documentObject
 * @returns {string}
 */
export function resolveBrowserApplicationId({
    applicationId=null,
    documentObject=globalThis.document
}={}){
    const explicit=applicationId===null||applicationId===undefined||applicationId===''
        ?null
        :canonicalApplicationId(applicationId);
    const declared=declaredApplicationId(documentObject);

    if(explicit&&declared&&explicit!==declared){
        throw scopeError(
            'APP_DATA_SCOPE_MISMATCH',
            'The configured and declared Arcane application identities do not match.'
        );
    }

    if(explicit||declared){
        return explicit||declared;
    }

    throw scopeError(
        'APP_DATA_SCOPE_REQUIRED',
        'Arcane application data cannot open without a declared application identity.'
    );
}

/**
 * Resolves a logical local-storage key beneath the current browser app scope.
 * Callers retain their domain namespace while the shared mechanism supplies
 * the canonical `arcane.apps.<id>:` ownership prefix.
 *
 * @param {*} logicalKey
 * @param {Object} options
 * @returns {string}
 */
export function resolveApplicationLocalStorageKey(logicalKey='',options={}){
    const applicationId=resolveBrowserApplicationId(options);
    return `${APP_LOCAL_STORAGE_PREFIX}${applicationId}:${String(logicalKey)}`;
}

async function nativeApplicationId(arcane=globalThis.Arcane){
    if(typeof arcane?.app?.current!=='function'){
        return null;
    }

    const descriptor=await arcane.app.current();

    if(!descriptor||typeof descriptor!=='object'){
        throw scopeError(
            'APP_DATA_SCOPE_INVALID',
            'Arcane returned an invalid bound application descriptor.'
        );
    }

    return canonicalApplicationId(
        descriptor.id,
        'bound application id'
    );
}

/**
 * Resolves one application identity for persistent data. The native host is
 * authoritative when present. Browser-only applications must declare their
 * package id in `meta[name="arcane-app-id"]` (or the equivalent root data
 * attribute). A mismatch fails closed before a data directory is opened.
 *
 * @param {Object} options
 * @param {string|null} options.applicationId Explicit identity for adapters
 *   and synthetic tests. Application pages should use document metadata.
 * @param {Document|Object|null} options.documentObject
 * @param {Object|null} options.arcane
 * @returns {Promise<string>}
 */
export async function resolveApplicationId({
    applicationId=null,
    documentObject=globalThis.document,
    arcane=globalThis.Arcane
}={}){
    let browserIdentity=null;
    try{
        browserIdentity=resolveBrowserApplicationId({
            applicationId,
            documentObject
        });
    }catch(error){
        if(error?.code!=='APP_DATA_SCOPE_REQUIRED'){
            throw error;
        }
    }
    const nativeIdentity=await nativeApplicationId(arcane);

    if(nativeIdentity&&browserIdentity&&nativeIdentity!==browserIdentity){
        throw scopeError(
            'APP_DATA_SCOPE_MISMATCH',
            'The document identity does not match the application bound by Arcane.'
        );
    }

    if(nativeIdentity||browserIdentity){
        return nativeIdentity||browserIdentity;
    }

    throw scopeError(
        'APP_DATA_SCOPE_REQUIRED',
        'Arcane application data cannot open without a bound application identity.'
    );
}

/**
 * Opens `<OPFS root>/apps/<application-id>` and returns only that app-owned
 * directory. This is an organizational boundary for browser-only same-origin
 * code; the native host additionally supplies a separate WebView profile and
 * authoritative application identity.
 *
 * @param {Object} options
 * @param {StorageManager|Object} options.storage
 * @param {string|null} options.applicationId
 * @param {Document|Object|null} options.documentObject
 * @param {Object|null} options.arcane
 * @param {boolean} options.create
 * @returns {Promise<{applicationId:string,directory:FileSystemDirectoryHandle|Object,path:string}>}
 */
export async function openApplicationDataDirectory({
    storage=globalThis.navigator?.storage,
    applicationId=null,
    documentObject=globalThis.document,
    arcane=globalThis.Arcane,
    create=true
}={}){
    if(!storage||typeof storage.getDirectory!=='function'){
        throw scopeError(
            'APP_DATA_STORAGE_UNAVAILABLE',
            'Origin Private File System storage is unavailable in this browser.'
        );
    }

    const id=await resolveApplicationId({
        applicationId,
        documentObject,
        arcane
    });
    const root=await storage.getDirectory();

    if(!root||typeof root.getDirectoryHandle!=='function'){
        throw scopeError(
            'APP_DATA_STORAGE_UNAVAILABLE',
            'Arcane could not open the Origin Private File System root.'
        );
    }

    const applications=await root.getDirectoryHandle(
        APP_DATA_DIRECTORY,
        {create:Boolean(create)}
    );
    const directory=await applications.getDirectoryHandle(
        id,
        {create:Boolean(create)}
    );

    return {
        applicationId:id,
        directory,
        path:`${APP_DATA_DIRECTORY}/${id}`
    };
}

export {
    APPLICATION_ID_MAX_LENGTH,
    APPLICATION_ID_PATTERN,
    APP_DATA_DIRECTORY,
    APP_LOCAL_STORAGE_PREFIX
};
