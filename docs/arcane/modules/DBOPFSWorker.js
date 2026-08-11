self.addEventListener(
    'message',
    async function accessFile(event){
        const port=event.ports[0];
        const operation=event.data.operation||'write';
        let response={success:true};
        let accessHandle;

        try{
            try{
                const root=await navigator.storage.getDirectory();
                const applicationId=String(event.data.applicationId||'');

                if(applicationId.length>64
                    ||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(applicationId)){
                    throw new DOMException(
                        'Arcane rejected an invalid application data scope.',
                        'SecurityError'
                    );
                }

                const applications=await root.getDirectoryHandle(
                    'apps',
                    {create:operation==='write'}
                );
                const application=await applications.getDirectoryHandle(
                    applicationId,
                    {create:operation==='write'}
                );
                const directory=await application.getDirectoryHandle(
                    event.data.directoryName,
                    {create:operation==='write'}
                );
                const file=await directory.getFileHandle(
                    event.data.fileName,
                    {create:operation==='write'}
                );

                if(typeof file.createSyncAccessHandle!=='function'){
                    throw new DOMException(
                        'OPFS file access is not supported in this browser.',
                        'NotSupportedError'
                    );
                }

                accessHandle=await file.createSyncAccessHandle();

                if(operation==='read'){
                    const fileData=new Uint8Array(accessHandle.getSize());
                    let bytesRead=0;

                    while(bytesRead<fileData.byteLength){
                        const read=accessHandle.read(
                            fileData.subarray(bytesRead),
                            {at:bytesRead}
                        );

                        if(read<1){
                            throw new Error('OPFS read did not make progress.');
                        }

                        bytesRead+=read;
                    }

                    response={
                        success:true,
                        fileData:fileData.buffer
                    };
                }else{
                    const fileData=new Uint8Array(event.data.fileData);
                    const writePosition=event.data.append ? accessHandle.getSize() : 0;

                    if(!event.data.append){
                        accessHandle.truncate(0);
                    }

                    let bytesWritten=0;

                    while(bytesWritten<fileData.byteLength){
                        const written=accessHandle.write(
                            fileData.subarray(bytesWritten),
                            {at:writePosition+bytesWritten}
                        );

                        if(written<1){
                            throw new Error('OPFS write did not make progress.');
                        }

                        bytesWritten+=written;
                    }

                    accessHandle.flush();
                }
            }finally{
                if(accessHandle){
                    accessHandle.close();
                }
            }
        }catch(error){
            response={
                error:{
                    name:error.name||'Error',
                    message:error.message||String(error)
                }
            };
        }

        if(response.fileData){
            port.postMessage(response,[response.fileData]);
        }else{
            port.postMessage(response);
        }

        port.close();
    }
);
