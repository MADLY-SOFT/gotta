'use strict';

// Rebuild the production stylesheet from feature modules while preserving the
// source-order markers. The generated app.css is the only stylesheet loaded by
// the game, so splitting the source does not add dozens of browser requests.
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const modulesRoot = path.join(root, 'public', 'css', 'modules');
const output = path.join(root, 'public', 'css', 'app.css');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : (entry.isFile() && entry.name.endsWith('.css') ? [full] : []);
  });
}

const files = walk(modulesRoot).sort();
if (!files.length) throw new Error(`No CSS modules found in ${modulesRoot}`);

const records = [];
let maxOrder = 0;
let appendOrder = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = postcss.parse(source, { from: file });
  let pendingOrder = null;
  for (const node of parsed.nodes) {
    if (node.type === 'comment') {
      const marker = node.text.match(/^\s*@z-order:\s*(\d+)\s*$/);
      if (marker) {
        pendingOrder = Number(marker[1]);
        maxOrder = Math.max(maxOrder, pendingOrder);
      }
      continue;
    }
    const order = pendingOrder === null ? null : pendingOrder;
    pendingOrder = null;
    records.push({
      order,
      fallback: order === null,
      module: path.relative(modulesRoot, file).split(path.sep).join('/'),
      css: node.toString()
    });
  }
  if (pendingOrder !== null) throw new Error(`Dangling @z-order marker in ${file}`);
}

// New unmarked rules are treated as intentional final overrides.
for (const record of records) {
  if (record.fallback) record.order = maxOrder + (++appendOrder);
}
records.sort((a, b) => a.order - b.order || a.module.localeCompare(b.module));

// Recombine adjacent rules that came from the same media/supports wrapper.
// This keeps the bundle compact without changing selector or declaration order.
const wrapperNames = new Set(['media', 'supports', 'container', 'document', 'layer']);
const groups = [];
for (const record of records) {
  const parsed = postcss.parse(record.css);
  let leaf = parsed.nodes[0];
  const wrappers = [];
  while (leaf && leaf.type === 'atrule' && wrapperNames.has(leaf.name.toLowerCase()) && leaf.nodes && leaf.nodes.length === 1) {
    wrappers.push({ name: leaf.name, params: leaf.params });
    leaf = leaf.nodes[0];
  }
  const key = JSON.stringify(wrappers);
  const previous = groups[groups.length - 1];
  if (wrappers.length && previous && previous.key === key) previous.leaves.push(leaf);
  else groups.push({ key, wrappers, leaves: [leaf] });
}
function renderGroup(group) {
  let content = group.leaves.map(node => node.toString()).join('\n');
  for (let i = group.wrappers.length - 1; i >= 0; i--) {
    const wrapper = group.wrappers[i];
    content = `@${wrapper.name}${wrapper.params ? ' ' + wrapper.params : ''} {\n${content}\n}`;
  }
  return content;
}

const banner = `/* ZOMBIX v${packageVersion} CSS bundle. Source of truth: ./modules/.\n` +
  ' * Edit the feature modules and run `npm run build:css`.\n' +
  ' * @z-order markers preserve the original cross-module cascade. */\n';
let bundle = banner + groups.map(renderGroup).join('\n\n') + '\n';
// The source CSS used to live at /public/game.css. The generated bundle now
// lives one directory deeper, so preserve the original public-root URL targets.
bundle = bundle.replace(/url\(\s*([\"']?)(?!data:|https?:|\/|#|blob:)([^\"')]+)\1\s*\)/gi, (whole, quote, rawUrl) => {
  const clean = rawUrl.trim().replace(/^\.\//, '');
  if (clean.startsWith('../')) return whole;
  return `url(${quote}../${clean}${quote})`;
});
postcss.parse(bundle, { from: output });
fs.writeFileSync(output, bundle);
console.log(`Built ${path.relative(root, output)} from ${files.length} modules (${records.length} ordered rules in ${groups.length} compact blocks).`);
