import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist/app',{recursive:true}); await cp('dist-dashboard','dist/app',{recursive:true});

const index=await readFile('dist/app/index.html','utf8'); await writeFile('dist/app/index.html',index.replace('name="streamsnipe-transport" content="local"','name="streamsnipe-transport" content="hosted"'));
