import manifest from '../data/releases.json';
type Artifact={label:string;url:string;sha256:string};
type Release={version:string;date:string;notes:string[];verified:boolean;artifacts:Artifact[]};
/** Only explicitly verified, checksum-bearing HTTPS artifacts are advertised. */
export const releases=(manifest.releases as Release[]).filter(r=>r.verified===true && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(r.version) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Array.isArray(r.notes) && Array.isArray(r.artifacts) && r.artifacts.length>0 && r.artifacts.every(a=>{try{return !!a.label && /^[a-f0-9]{64}$/i.test(a.sha256) && new URL(a.url).protocol==='https:'}catch{return false}}));
