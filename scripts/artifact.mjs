import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8')); await mkdir('artifacts',{recursive:true}); const name=`dashboard-v${pkg.version}.tar.gz`;execFileSync('tar',['-czf',`artifacts/${name}`,'-C','dist-dashboard','.']);const hash=createHash('sha256').update(await readFile(`artifacts/${name}`)).digest('hex');await writeFile(`artifacts/${name}.sha256`,`${hash}  ${name}\n`);await writeFile('artifacts/dashboard-manifest.json',JSON.stringify({version:pkg.version,protocolVersion:1,sha256:hash,artifact:name},null,2)+'\n');
