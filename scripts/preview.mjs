import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};
createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=resolve(root,'.'+path);if(!file.startsWith(root+'/')&&file!==root)throw Error('invalid path');try{if((await stat(file)).isDirectory())file=resolve(file,'index.html')}catch{if(path.startsWith('/app/'))file=resolve(root,'app/index.html');else throw Error('not found')}const content=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(content)}catch{res.writeHead(404);res.end('Not found')}}).listen(4321,'127.0.0.1');
