import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const remote = git(['remote', 'get-url', 'origin']);
const directory = await mkdtemp(join(tmpdir(), 'migration-pages-'));
try {
  git(['init', '-b', 'gh-pages'], directory);
  git(['remote', 'add', 'origin', remote], directory);
  const existing = git(['ls-remote', '--heads', 'origin', 'gh-pages'], directory);
  if (existing) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], directory);
    git(['reset', '--hard', 'FETCH_HEAD'], directory);
  }
  // Only the dedicated temporary checkout is replaced; the source checkout is untouched.
  for (const name of await readdir(directory)) if (name !== '.git') await rm(join(directory, name), { recursive: true, force: true });
  await cp(resolve('dist'), directory, { recursive: true });
  await writeFile(join(directory, '.nojekyll'), '');
  git(['config', 'user.name', 'Migration Pages deployment'], directory);
  git(['config', 'user.email', 'pages@users.noreply.github.com'], directory);
  git(['add', '.'], directory);
  if (git(['status', '--porcelain'], directory)) {
    git(['commit', '-m', `Deploy ${git(['rev-parse', '--short', 'HEAD'])}`], directory);
    git(['push', 'origin', 'HEAD:gh-pages'], directory);
    console.log('Published production files to gh-pages.');
  } else console.log('The production files are already up to date.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
