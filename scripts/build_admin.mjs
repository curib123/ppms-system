import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = join(root, 'public/assets');
const jquery = join(root, 'node_modules/jquery');
const cli = join(root, 'node_modules/@tailwindcss/cli');
const cliPackage = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));

mkdirSync(join(assets, 'css'), { recursive: true });
mkdirSync(join(assets, 'vendor'), { recursive: true });
const result = spawnSync(process.execPath, [join(cli, cliPackage.bin.tailwindcss),
  '-i', 'resources/css/admin.css', '-o', 'public/assets/css/admin.css', '--minify'],
{ cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

copyFileSync(join(jquery, 'dist/jquery.min.js'), join(assets, 'vendor/jquery.min.js'));
copyFileSync(join(jquery, 'LICENSE.txt'), join(assets, 'vendor/jquery.LICENSE.txt'));
copyFileSync(join(root, 'node_modules/tailwindcss/LICENSE'), join(assets, 'vendor/tailwindcss.LICENSE.txt'));
console.log('Built admin CSS and copied pinned, locally served jQuery and license notices.');
