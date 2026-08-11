import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DEFAULT_ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));

const CONTENT_TYPES=Object.freeze({
    '.css':'text/css; charset=utf-8',
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.mjs':'text/javascript; charset=utf-8',
    '.png':'image/png',
    '.svg':'image/svg+xml; charset=utf-8',
    '.txt':'text/plain; charset=utf-8'
});

function httpError(status,message){
    const error=new Error(message);
    error.status=status;
    return error;
}

function requestFilePath(rootPath,requestUrl){
    let pathname;

    try{
        pathname=decodeURIComponent(new URL(requestUrl,'http://127.0.0.1').pathname);
    }catch{
        throw httpError(400,'Malformed request URL.');
    }

    if(pathname.includes('\0')){
        throw httpError(400,'Malformed request path.');
    }

    const relativePath=pathname
        .replaceAll('\\','/')
        .replace(/^\/+/, '');
    const filePath=resolve(rootPath,relativePath||'index.html');
    const rootBoundary=rootPath.endsWith(sep)?rootPath:`${rootPath}${sep}`;

    if(filePath!==rootPath&&!filePath.startsWith(rootBoundary)){
        throw httpError(403,'Request path is outside the static root.');
    }

    return filePath;
}

function sendText(response,status,message,headers={}){
    const body=`${message}\n`;
    response.writeHead(status,{
        'Cache-Control':'no-store',
        'Content-Length':Buffer.byteLength(body),
        'Content-Type':'text/plain; charset=utf-8',
        'X-Content-Type-Options':'nosniff',
        ...headers
    });
    response.end(body);
}

async function serveRequest(rootPath,request,response){
    if(request.method!=='GET'&&request.method!=='HEAD'){
        sendText(response,405,'Method not allowed.',{Allow:'GET, HEAD'});
        return;
    }

    try{
        let filePath=requestFilePath(rootPath,request.url||'/');
        let fileStat=await stat(filePath);

        if(fileStat.isDirectory()){
            filePath=resolve(filePath,'index.html');
            fileStat=await stat(filePath);
        }

        if(!fileStat.isFile()){
            throw httpError(404,'Not found.');
        }

        const contentType=CONTENT_TYPES[extname(filePath).toLowerCase()]
            ||'application/octet-stream';

        response.writeHead(200,{
            'Cache-Control':'no-store',
            'Content-Length':fileStat.size,
            'Content-Type':contentType,
            'X-Content-Type-Options':'nosniff'
        });

        if(request.method==='HEAD'){
            response.end();
            return;
        }

        const stream=createReadStream(filePath);
        stream.on('error',()=>response.destroy());
        stream.pipe(response);
    }catch(error){
        if(error?.code==='ENOENT'||error?.code==='ENOTDIR'){
            sendText(response,404,'Not found.');
            return;
        }

        sendText(response,error?.status||500,error?.status?error.message:'Static server error.');
    }
}

export async function startStaticServer({
    root=DEFAULT_ROOT,
    host='127.0.0.1',
    port=0
}={}){
    const rootPath=resolve(root);
    const rootStat=await stat(rootPath);

    if(!rootStat.isDirectory()){
        throw new Error(`Static root is not a directory: ${rootPath}`);
    }

    const server=createServer((request,response)=>{
        void serveRequest(rootPath,request,response);
    });

    await new Promise((resolveListen,rejectListen)=>{
        const onError=error=>{
            server.off('listening',onListening);
            rejectListen(error);
        };
        const onListening=()=>{
            server.off('error',onError);
            resolveListen();
        };

        server.once('error',onError);
        server.once('listening',onListening);
        server.listen(port,host);
    });

    const address=server.address();

    if(!address||typeof address==='string'){
        server.close();
        throw new Error('Static server did not expose a TCP address.');
    }

    return {
        close(){
            return new Promise((resolveClose,rejectClose)=>{
                server.close(error=>error?rejectClose(error):resolveClose());
            });
        },
        host,
        origin:`http://${host}:${address.port}`,
        port:address.port,
        root:rootPath,
        server
    };
}

function optionValue(name,fallback){
    const index=process.argv.indexOf(name);
    return index===-1?fallback:process.argv[index+1];
}

const invokedPath=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:'';

if(invokedPath===import.meta.url){
    const root=optionValue('--root',DEFAULT_ROOT);
    const parsedPort=Number(optionValue('--port','8000'));

    if(!Number.isInteger(parsedPort)||parsedPort<0||parsedPort>65535){
        throw new TypeError('--port must be an integer between 0 and 65535.');
    }

    const activeServer=await startStaticServer({root,port:parsedPort});
    console.log(`DBOPFS release server: ${activeServer.origin}/release/test/`);

    const close=async()=>{
        await activeServer.close();
        process.exitCode=0;
    };

    process.once('SIGINT',()=>void close());
    process.once('SIGTERM',()=>void close());
}
