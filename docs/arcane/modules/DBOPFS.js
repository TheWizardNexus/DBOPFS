import Is from "../../node_modules/strong-type/index.js";
import {openApplicationDataDirectory} from './AppDataScope.js';
const is=new Is(false);

const DEFAULT_TABLE_DIRECTORIES=Object.freeze({
    users:'users',
    scores:'scores',
    chats:'chats',
    notes:'notes',
    documents:'documents',
    songs:'songs',
    images:'images',
    journal_entries:'journal_entries',
    streams_of_consciousness:'streams_of_consciousness',
    reports:'reports',
    errors:'errors',
    memories:'memory'
});

if(navigator.storage?.persist){
    await navigator.storage.persist().catch(()=>false);
}

/**
 * @typedef {Object<string,any>} DBOPFSTableCache
 * Represents cached values of a table in memory.
 * Key = filename
 * Value = parsed file content
 */

/**
 * @typedef {Object<string,DBOPFSTableCache>} DBOPFSTables
 * Represents the in-memory cache of all tables.
 */

/**
 * @typedef {Object<string,FileSystemDirectoryHandle>} DBOPFSTableHandles
 * Handles to directories inside OPFS.
 */

/**
 * @typedef {Object<string,Promise>} DBOPFSWriteLocks
 * Promise based write locks to serialize writes to the same file.
 */

/**
 * @typedef {Object} DBOPFSTableUpdate
 * @property {string} tableName
 * @property {string} fileName
 * @property {*} value
 */


/**
 * DBOPFS
 *
 * A lightweight database abstraction on top of the
 * **Origin Private File System (OPFS)**.
 *
 * Tables are directories and records are files.
 *
 * This module automatically attaches a singleton to:
 *
 *     window.dbopfs
 *
 * Example:
 *
 *     await dbopfs.set('users','alex',{email:'alex@example.com'})
 *     const user=await dbopfs.get('users','alex')
 */
class DBOPFS {

    /** @type {FileSystemDirectoryHandle|Object} */
    #db={}

    /** @type {DBOPFSTableHandles} */
    #tableHandles={}

    /** @type {DBOPFSTables} */
    #tables={}

    /** @type {DBOPFSWriteLocks} */
    #writeLocks={}

    /** @type {ServiceWorker|Object} */
    #serviceWorker={}

    /** @type {Worker|Object} */
    #writeWorker={}

    /** @type {string} */
    #applicationId=''

    /** @type {string} */
    #storagePath=''

    /**
     * Handles messages received from the service worker.
     * Placeholder for future synchronization logic.
     * @private
     */
    #handleServiceWorkerMessage(){};

    /**
     * Writes file data through a dedicated OPFS worker.
     * Used when FileSystemFileHandle.createWritable is unavailable.
     *
     * @private
     * @param {string} directoryName
     * @param {string} fileName
     * @param {*} fileData
     * @param {boolean} append
     * @returns {Promise<boolean>}
    */
    async #writeFileWithWorker(directoryName='',fileName='',fileData='',append=false){
        const fileDataBuffer=await new Blob([fileData]).arrayBuffer();

        await this.#requestFileWorker(
            {
                operation:'write',
                applicationId:this.#applicationId,
                directoryName,
                fileName,
                fileData:fileDataBuffer,
                append
            },
            [fileDataBuffer]
        )

        return true
    }

    /**
     * Reads file data through a dedicated OPFS worker.
     * Used when FileSystemFileHandle.getFile is unavailable.
     *
     * @private
     * @param {string} directoryName
     * @param {string} fileName
     * @returns {Promise<File>}
     */
    async #readFileWithWorker(directoryName='',fileName=''){
        const response=await this.#requestFileWorker(
            {
                operation:'read',
                applicationId:this.#applicationId,
                directoryName,
                fileName
            }
        )

        return new File(
            [response.fileData],
            fileName
        )
    }

    /**
     * Sends a file operation to the shared OPFS worker.
     *
     * @private
     * @param {Object} data
     * @param {Transferable[]} transfer
     * @returns {Promise<Object>}
     */
    async #requestFileWorker(data={},transfer=[]){

        if(typeof this.#writeWorker?.postMessage!=='function'){
            this.#writeWorker=new Worker(
                new URL('./DBOPFSWorker.js',import.meta.url)
            );
        }

        const channel=new MessageChannel();
        const worker=this.#writeWorker;
        const db=this;

        return new Promise(
            function fileWorkerPromise(resolve,reject){
                function cleanup(){
                    channel.port1.onmessage=null;
                    channel.port1.close();
                    worker.removeEventListener('error',workerErrorHandler);
                }

                function workerErrorHandler(event){
                    cleanup();
                    worker.terminate();

                    if(db.#writeWorker===worker){
                        db.#writeWorker={};
                    }

                    reject(event.error||new Error(event.message||'OPFS worker failed'));
                }

                channel.port1.onmessage=function fileWorkerMessage(event){
                    cleanup();

                    if(event.data?.error){
                        const error=new Error(event.data.error.message);
                        error.name=event.data.error.name;
                        reject(error);
                        return;
                    }

                    resolve(event.data);
                };

                channel.port1.start();
                worker.addEventListener('error',workerErrorHandler);

                try{
                    worker.postMessage(
                        data,
                        transfer.concat(channel.port2)
                    );
                }catch(error){
                    cleanup();
                    channel.port2.close();
                    reject(error);
                }
            }
        );
    }

    /**
     * Generates a unique key for a file lock.
     * @private
     * @param {string} tableName
     * @param {string} fileName
     * @returns {string}
     */
    #getLockKey(tableName,fileName){
        return `${tableName}:${fileName}`
    }

    /** @type {boolean} */
    ready=false;

    /** @type {Promise<void>} */
    readyPromise=Promise.resolve();

    constructor(options={}){
        if(window.dbopfs){
            return window.dbopfs;
        }

        this.readyPromise=this.#init(options);
    }

    /**
     * Initializes OPFS database and default tables.
     * Dispatches `dbopfs-ready` event when complete.
     *
     * @returns {Promise<void>}
     */
    async #init(options={}){
        const scope=await openApplicationDataDirectory({
            storage:options.storage||navigator.storage,
            applicationId:options.applicationId||null,
            documentObject:options.documentObject||globalThis.document,
            arcane:options.arcane||globalThis.Arcane,
            create:true
        });
        this.#applicationId=scope.applicationId;
        this.#storagePath=scope.path;
        this.#db=scope.directory;
        await this.#createDefaultTables();

        this.ready=true;

        window.dispatchEvent(
            new CustomEvent(
                'dbopfs-ready',
                {
                    detail:{
                        dbopfs:this,
                        applicationId:this.#applicationId,
                        storagePath:this.#storagePath
                    }
                }
            )
        );
    }

    async #createDefaultTables(){
        for(const [alias,directoryName]of Object.entries(DEFAULT_TABLE_DIRECTORIES)){
            this.#tableHandles[alias]=await this.#db.getDirectoryHandle(
                directoryName,
                {create:true}
            );
        }
    }

    /**
     * Canonical application identity owning this database.
     *
     * @returns {string}
     */
    get applicationId(){
        return this.#applicationId;
    }

    /**
     * Application-relative OPFS directory used by this database.
     *
     * @returns {string}
     */
    get storagePath(){
        return this.#storagePath;
    }

    /**
     * Returns in-memory table cache.
     *
     * @returns {DBOPFSTables}
     */
    get tables(){
        return this.#tables
    }

    /**
     * Convenience setter to write to tables.
     *
     * Example:
     *
     *     dbopfs.tables={
     *         tableName:'users',
     *         fileName:'alex',
     *         value:{email:'alex@example.com'}
     *     }
     *
     * @param {DBOPFSTableUpdate} update
     */
    set tables(update={tableName:'',fileName:'',value:''}){
        this.set(update.tableName,update.fileName,update.value)
    }

    /**
     * Gets the directory handle for a table.
     * Creates the table if it does not exist.
     *
     * @param {string} tableName
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    async getTableHandle(tableName=''){
        if(!this.ready){
            await this.readyPromise;
        }

        if(!this.#tableHandles[tableName]){
            const existingHandle=Object.values(this.#tableHandles).find(
                handle=>handle.name===tableName
            )

            if(existingHandle){
                return existingHandle
            }

            this.#tableHandles[tableName]=await this.#db.getDirectoryHandle(tableName,{create:true});
        }

        return this.#tableHandles[tableName];
    }

    /**
     * Writes a value to OPFS.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @param {*} value
     * @returns {Promise<*>}
     */
    async set(tableName='',fileName='',value={}, append=false){
        const lockKey=this.#getLockKey(tableName,fileName)

        const previousWrite=this.#writeLocks[lockKey]||Promise.resolve()
        const currentWrite=previousWrite.catch(()=>{}).then(
            async function setWriteLocked(){
                if(!this.#tables[tableName]){
                    this.#tables[tableName]={}
                }

                let dataToWrite=value

                if(typeof value!=='string'){
                    dataToWrite=JSON.stringify(dataToWrite)
                }

                try{
                    await this.writeFile(
                        tableName,
                        fileName,
                        dataToWrite,
                        append
                    );

                    this.#tables[tableName][fileName]=await this.get(tableName,fileName,true);
                }catch(error){
                    console.error(`Error writing file '${fileName}' to table '${tableName}':`,error)
                    throw error
                }

                return this.#tables[tableName][fileName]
            }.bind(this)
        )

        this.#writeLocks[lockKey]=currentWrite

        function clearWriteLock(){
            if(this.#writeLocks[lockKey]===currentWrite){
                delete this.#writeLocks[lockKey]
            }
        }

        currentWrite.then(
            clearWriteLock.bind(this),
            clearWriteLock.bind(this)
        )

        return currentWrite
    }

    /**
     * Writes raw file data to OPFS.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @param {*} fileData
     * @param {boolean} append
     * @returns {Promise<boolean>}
     */
    async writeFile(tableName='',fileName='',fileData='',append=false){
        const table=await this.getTableHandle(tableName)
        const handle=await table.getFileHandle(
            fileName,
            {create:true}
        );

        if(typeof handle.createWritable!=='function'){
            return this.#writeFileWithWorker(
                table.name,
                fileName,
                fileData,
                append
            );
        }

        const writable=await handle.createWritable(
            {keepExistingData:append}
        );

        if(append){
            const file=await handle.getFile();
            await writable.seek(file.size);
        }

        const blob = new Blob(
            [
                fileData
            ]
        );

        await writable.write(blob);
        await writable.close();

        return true
    }

    /**
     * Reads a raw file from OPFS.
     * Falls back to a synchronous access handle in a worker on browsers
     * without FileSystemFileHandle.getFile.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @returns {Promise<File>}
     */
    async readFile(tableName='',fileName=''){
        const table=await this.getTableHandle(tableName)
        const handle=await table.getFileHandle(fileName,{create:false})

        if(typeof handle.getFile==='function'){
            return handle.getFile()
        }

        return this.#readFileWithWorker(
            table.name,
            fileName
        )
    }

    /**
     * Returns metadata exposed by the browser File API.
     * Creation time is not available through the OPFS file handle.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @returns {Promise<Object>}
     */
    async getFileMetadata(tableName='',fileName=''){
        const table=await this.getTableHandle(tableName)
        const handle=await table.getFileHandle(fileName,{create:false})

        if(typeof handle.getFile!=='function'){
            return {
                lastModified:null,
                size:null,
                type:''
            }
        }

        const file=await handle.getFile()

        return {
            lastModified:file.lastModified||null,
            size:file.size,
            type:file.type||''
        }
    }

    /**
     * Writes multiple files into a table.
     *
     * @param {string} tableName
     * @param {Object<string,*>} items
     * @returns {Promise<PromiseSettledResult[]>}
     */
    async setMany(tableName,items){
        const entries=Object.entries(items)

        const setPromises=entries.map(
            function setManyPromises([fileName,value]){
                return this.set(tableName,fileName,value)
            }.bind(this)
        );

        const results=await Promise.allSettled(setPromises);

        results.forEach(
            function setManyResultsItterator(result,index){
                const fileName=entries[index][0]

                if(result.status!=='fulfilled'){
                    console.error(`Failed to set file '${fileName}':`,result.reason)
                }
            }
        );

        return results
    }

    /**
     * Reads a file from OPFS.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @param {boolean} force
     * @returns {Promise<*>}
     */
    async get(tableName='',fileName='',force=false){
        if(force||!this.#tables[tableName]?.[fileName]){
            try{
                const file=await this.readFile(tableName,fileName)
                const textContent=await file.text()

                if(!this.#tables[tableName]){
                    this.#tables[tableName]={}
                }

                this.#tables[tableName][fileName]=textContent;

                const extention=fileName.slice(
                    fileName.lastIndexOf('.')+1)
                    .toLowerCase();

                switch(extention){
                    case 'json':
                        try{
                            this.#tables[tableName][fileName]=JSON.parse(textContent.trim())
                        }catch(e){}
                        break;
                    case 'jsonl':
                    case 'ndjson':
                        const rows=textContent.split('\n');
                        const parsedRows=[];

                        for(let i=0;i<rows.length;i++){
                            try{
                                parsedRows.push(
                                    JSON.parse(rows[i].trim())
                                );
                            }catch(e){}
                        }

                        this.#tables[tableName][fileName]=parsedRows;
                        break;
                }
            }catch(error){
                if(error.name==='NotFoundError'){
                    return null
                }

                throw error
            }
        }

        return this.#tables[tableName][fileName];
    }

    /**
     * Reads multiple files.
     *
     * @param {string} tableName
     * @param {string[]} items
     * @returns {Promise<PromiseSettledResult[]>}
     */
    async getMany(tableName,items){
        const getPromises=items.map(
            function getManyPromises(fileName){
                return this.get(tableName,fileName)
            }.bind(this)
        )

        return Promise.allSettled(getPromises);
    }

    /**
     * Reads all files from a table or the entire DB.
     *
     * @param {string} tableName
     * @returns {Promise<Object>}
     */
    async getAll(tableName=''){
        const items={}

        if(tableName){
            const table=await this.getTableHandle(tableName)

            const readPromises=[]

            for await(const [name]of table.entries()){
                readPromises.push(
                    this.get(tableName,name).then(
                        function assignValue(value){
                            items[name]=value
                        }
                    )
                )
            }

            await Promise.all(readPromises)

            return items
        }

        await this.getTableNames(true)

        const tableNames=Object.keys(this.#tableHandles)

        const tablePromises=tableNames.map(
            async function loadTable(tableName){
                const table=await this.getTableHandle(tableName);
                const tableItems={};

                const readPromises=[];

                for await(const [name]of table.entries()){
                    readPromises.push(
                        this.get(tableName,name).then(
                            function assignValue(value){
                                tableItems[name]=value;
                            }
                        )
                    );
                }

                await Promise.all(readPromises);

                items[tableName]=tableItems;
            }.bind(this)
        )

        await Promise.all(tablePromises)

        return items
    }

    /**
     * Deletes a file.
     *
     * @param {string} tableName
     * @param {string} fileName
     * @returns {Promise<boolean>}
     */
    async delete(tableName='',fileName=''){
        if(this.#tables[tableName]){
            delete this.#tables[tableName][fileName]
        }

        const table=await this.getTableHandle(tableName)

        try{
            await table.removeEntry(fileName)
        }catch(error){
            if(error.name!=='NotFoundError'){
                console.error(error)
            }
        }

        return true
    }

    /**
     * Deletes multiple files.
     *
     * @param {string} tableName
     * @param {string[]} fileNames
     * @returns {Promise<PromiseSettledResult[]>}
     */
    async deleteMany(tableName,fileNames){
        const deletionPromises=fileNames.map(
            function deleteManyPromises(fileName){
                return this.delete(tableName,fileName)
            }.bind(this)
        );

        return Promise.allSettled(deletionPromises);
    }

    /**
     * Deletes a full table.
     *
     * @param {string} tableName
     * @returns {Promise<boolean>}
     */
    async deleteTable(tableName){
        try{
            await this.#db.removeEntry(tableName,{recursive:true})

            delete this.#tables[tableName]
            delete this.#tableHandles[tableName]
        }catch(error){
            console.error(error)
        }

        return true
    }

    /**
     * Clears only the current application's OPFS database.
     *
     * @returns {Promise<DBOPFS>}
     */
    async clearAllStorage(){
        if(!this.ready){
            await this.readyPromise;
        }

        for await(const [name]of this.#db.entries()){
            await this.#db.removeEntry(name,{recursive:true})
        }

        this.#tables={}
        this.#tableHandles={}
        this.#writeLocks={}
        await this.#createDefaultTables()

        return this
    }

    /**
     * Clears a table.
     *
     * @param {string} tableName
     * @returns {Promise<void>}
     */
    async clear(tableName){
        const table=await this.getTableHandle(tableName)

        for await(const [name]of table.entries()){
            await this.delete(tableName,name)
        }
    }

    /**
     * Returns all keys in a table.
     *
     * @param {string} tableName
     * @returns {Promise<string[]>}
     */
    async getAllKeys(tableName){
        const keys=[]
        const table=await this.getTableHandle(tableName)

        for await(const [name]of table.entries()){
            keys.push(name)
        }

        return keys
    }

    /**
     * Returns registered table names, or discovers physical OPFS directories.
     * Discovered directories are registered so later reads and exports include
     * data created outside the current page load.
     *
     * @param {boolean} discover
     * @returns {Promise<string[]>}
     */
    async getTableNames(discover=false){
        if(!discover){
            return Object.keys(this.#tableHandles)
        }

        const tableNames=[]

        for await(const [name,handle]of this.#db.entries()){
            if(handle.kind!=='directory'){
                continue
            }

            const registered=Object.values(this.#tableHandles).some(
                tableHandle=>tableHandle.name===name
            )

            if(!registered){
                this.#tableHandles[name]=handle
            }

            tableNames.push(name)
        }

        return tableNames
    }

    /**
     * Filters files by key substring.
     *
     * @param {string} tableName
     * @param {string} subString
     * @returns {Promise<Object>}
     */
    async filterKeyIncludes(tableName,subString=''){
        const items={}
        const table=await this.getTableHandle(tableName)

        for await(const [name]of table.entries()){
            if(name.includes(subString)){
                items[name]=await this.get(tableName,name)
            }
        }

        return items
    }

    /**
     * Checks if a key exists.
     *
     * @param {string} tableName
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async hasKey(tableName,key){
        try{
            const table=await this.getTableHandle(tableName)
            await table.getFileHandle(key)
            return true
        }catch(err){
            return false
        }
    }

    /**
     * Counts items in a table.
     *
     * @param {string} tableName
     * @returns {Promise<number>}
     */
    async count(tableName){
        let count=0
        const table=await this.getTableHandle(tableName)

        for await(const _ of table.entries()){
            count++
        }

        return count
    }

    /**
     * Downloads the entire database as a compressed PNG backup.
     *
     * The database is streamed as JSON, compressed using gzip via
     * CompressionStream, and encoded into RGBA pixels inside a PNG.
     *
     * Each pixel stores 4 bytes of payload data.
     * The first 4 bytes store the gzip byte length header.
     *
     * Output example:
     *
     *     DBOPFS-backup-2026-03-10-13-45-12.png
     *
     * @param {string} name
     * Base name used for the generated backup filename.
     *
     * @returns {Promise<void>}
     */
    async downloadCompressedPNG(name='DBOPFS-backup'){
        if(!('CompressionStream' in window)){
            throw new Error('CompressionStream not supported.')
        }

        const encoder=new TextEncoder()
        await this.getTableNames(true)

        const tableNames=Object.keys(this.#tableHandles)

        const jsonStream=new ReadableStream({
            start:async controller=>{
                controller.enqueue(encoder.encode('{'))

                for(let t=0;t<tableNames.length;t++){
                    const tableName=tableNames[t]
                    const table=await this.getTableHandle(tableName)

                    if(t>0){
                        controller.enqueue(encoder.encode(','))
                    }

                    controller.enqueue(
                        encoder.encode(`${JSON.stringify(tableName)}:{`)
                    )

                    let first=true

                    for await(const [fileName]of table.entries()){
                        const value=await this.get(tableName,fileName)

                        if(!first){
                            controller.enqueue(encoder.encode(','))
                        }

                        first=false

                        const json=`${JSON.stringify(fileName)}:${JSON.stringify(value)}`

                        controller.enqueue(encoder.encode(json))
                    }

                    controller.enqueue(encoder.encode('}'))
                }

                controller.enqueue(encoder.encode('}'))
                controller.close()
            }
        })

        const gzipStream=jsonStream.pipeThrough(
            new CompressionStream('deflate')
        )

        const reader=gzipStream.getReader()

        const chunks=[]
        let totalLength=0

        while(true){
            const {done,value}=await reader.read()

            if(done){
                break
            }

            chunks.push(value)
            totalLength+=value.length
        }

        const gzipBytes=new Uint8Array(totalLength)

        let offset=0
        for(const chunk of chunks){
            gzipBytes.set(chunk,offset)
            offset+=chunk.length
        }

        const payload=new Uint8Array(totalLength+4)

        const view=new DataView(payload.buffer)
        view.setUint32(0,totalLength,true)

        payload.set(gzipBytes,4)

        const size=Math.ceil(Math.sqrt(payload.length/3))

        const totalPixels=size*size

        if(totalPixels*3 < payload.length){
            throw new Error('PNG canvas too small for payload.')
        }

        const canvas=document.createElement('canvas')
        canvas.width=size
        canvas.height=size

        const ctx=canvas.getContext('2d')

        if(!ctx){
            throw new Error('Canvas 2D context unavailable.')
        }

        const imgData=ctx.createImageData(size,size)
        imgData.data.fill(0);
        
        let p=0;

        for(let i=0;i<imgData.data.length;i+=4){

            imgData.data[i]   = payload[p]   ?? 0;
            imgData.data[i+1] = payload[p+1] ?? 0;
            imgData.data[i+2] = payload[p+2] ?? 0;
            imgData.data[i+3] = 255;

            p+=3;
        }

        ctx.putImageData(imgData,0,0)

        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))

        if(!blob){
            throw new Error('PNG export failed.')
        }

        const stamp=new Date()
            .toISOString()
            .slice(0,19)
            .replace(/[:T]/g,'-')

        const url=URL.createObjectURL(blob)

        const a=document.createElement('a')
        a.href=url
        a.download=`${name}-${stamp}.png`

        document.body.appendChild(a)
        a.click()
        a.remove()

        URL.revokeObjectURL(url)
    }

    /**
     * Restores a database backup from a PNG image created by
     * `downloadCompressedPNG`.
     *
     * The PNG is decoded into RGBA pixel data,the compressed payload
     * is extracted using the stored byte length header, then
     * decompressed using DecompressionStream.
     *
     * The resulting JSON database structure is parsed and written
     * back into OPFS using `setMany`.
     *
     * Restore process:
     *
     *     PNG → RGBA bytes → deflate payload → JSON → DBOPFS tables
     *
     * Any existing records with matching keys will be overwritten.
     *
     * @param {File|Blob} file
     * PNG backup file generated by DBOPFS.
     *
     * @returns {Promise<void>}
     * Resolves once the database restore process is complete.
     */
    async restoreFromPNG(file){
        const img=await createImageBitmap(
            file,
            {premultiplyAlpha:'none'}
        )

        const canvas=document.createElement('canvas')
        canvas.width=img.width
        canvas.height=img.height

        const ctx=canvas.getContext('2d')

        if(!ctx){
            throw new Error('Canvas 2D context unavailable.')
        }

        ctx.drawImage(img,0,0)

        const data=ctx.getImageData(0,0,img.width,img.height).data

        if(data.length < 4){
            throw new Error('Invalid PNG backup.')
        }

        const payload=new Uint8Array((data.length/4)*3);

        let p=0;

        for(let i=0;i<data.length;i+=4){
            payload[p++] = data[i];
            payload[p++] = data[i+1];
            payload[p++] = data[i+2];
        }

        const view=new DataView(payload.buffer)

        const length=view.getUint32(0,true);

        if(length <= 0 || length > payload.length-4){
            throw new Error('Invalid PNG backup payload length.')
        }

        const gzipBytes=payload.slice(4,4+length)

        const stream=new Blob([gzipBytes])
            .stream()
            .pipeThrough(new DecompressionStream('deflate'))

        const json=await new Response(stream).text()

        const db=JSON.parse(json)

        const tables=Object.keys(db)

        for(const table of tables){
            await this.setMany(table,db[table])
        }
    }
}

if(typeof window.dbopfs?.get!=="function"){
    window.dbopfs=new DBOPFS();
}

export default DBOPFS;
