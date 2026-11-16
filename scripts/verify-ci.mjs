// Vercel invokes this before a deployment build. CI itself runs `npm run build`.
// Fail closed: only successful GitHub checks for this exact source commit can deploy.
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('A verified Git source commit is required');
const endpoint = `https://api.github.com/repos/Fanclan/StreamSnipe-Portal/actions/runs?head_sha=${sha}&per_page=100`;
const deadline = Date.now() + 10 * 60 * 1000;
let verified = false;
while (Date.now() < deadline) {
  const response = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'StreamSnipe-Fanclan-deployment-check' },
  redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Unable to verify source checks: GitHub HTTP ${response.status}`);
  const { workflow_runs: runs } = await response.json();
  const relevant = runs.filter(run => run.head_sha === sha && run.path === '.github/workflows/ci.yml')
    .sort((a, b) => b.id - a.id);
  const run = relevant[0];
  if (run?.status === 'completed') {
    if (run.conclusion !== 'success') throw new Error(`Source checks ${run.conclusion}: ${run.html_url}`);
    console.log(`Verified source ${sha}: ${run.html_url}`);
    verified = true;
    break;
  }
  console.log(`Waiting for GitHub checks on ${sha.slice(0, 12)}`);
  await new Promise(resolve => setTimeout(resolve, 15000));
}
if (!verified) throw new Error('Source checks did not complete within the deployment verification window');
