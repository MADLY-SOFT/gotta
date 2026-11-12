'use strict';

// Builds public/css/app.css from public/css/modules/.
// Modules are concatenated in a fixed layer order (base first, then features),
// comments are stripped and whitespace is collapsed with PostCSS, so the game
// downloads one small stylesheet. URLs in modules are written relative to the
// bundle (public/css/app.css), e.g. url("../png/items-atlas.png").
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const modulesRoot = path.join(root, 'public', 'css', 'modules');
const output = path.join(root, 'public', 'css', 'app.css');

// Earlier entries load first. Anything not listed is appended alphabetically.
const LAYER_ORDER = [
  'base/tokens.css',
  'base/motion-fonts.css',
  'base/layout.css',
  'base/components.css',
  'account/', 'menu/', 'cases/cases.css', 'cases/roulette.css', 'cases/history.css',
  'profile/', 'quests/', 'economy/', 'features/'
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : (entry.isFile() && entry.name.endsWith('.css') ? [full] : []);
  });
}

function rank(relative) {
  const index = LAYER_ORDER.findIndex(prefix => prefix.endsWith('/') ? relative.startsWith(prefix) : relative === prefix);
  return index === -1 ? LAYER_ORDER.length : index;
}

function minify(rootNode) {
  rootNode.walkComments(comment => comment.remove());
  rootNode.walk(node => {
    node.raws.before = '';
    node.raws.after = '';
    if (node.type === 'decl') {
      node.raws.between = ':';
      node.raws.important = node.important ? '!important' : undefined;
      node.value = node.value.replace(/\s*\n\s*/g, ' ').replace(/\s*,\s*/g, ',').trim();
    } else if (node.type === 'rule') {
      node.raws.between = '';
      node.raws.semicolon = false;
      node.selector = node.selectors.map(s => s.replace(/\s+/g, ' ').trim()).join(',');
    } else if (node.type === 'atrule') {
      node.raws.afterName = node.params ? ' ' : '';
      node.raws.between = '';
      node.raws.semicolon = false;
      node.params = node.params.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':').trim();
    }
  });
  rootNode.raws.after = '';
  return rootNode;
}

const files = walk(modulesRoot)
  .map(file => ({ file, relative: path.relative(modulesRoot, file).split(path.sep).join('/') }))
  .sort((a, b) => rank(a.relative) - rank(b.relative) || a.relative.localeCompare(b.relative));
if (!files.length) throw new Error(`No CSS modules found in ${modulesRoot}`);

const parts = [];
let rules = 0;
for (const { file, relative } of files) {
  const parsed = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  parsed.walkRules(() => { rules++; });
  parts.push(`/* ${relative} */\n` + minify(parsed).toString());
}

const banner = `/* ZOMBIX v${packageVersion} CSS bundle — generated from ./modules/, do not edit. Run \`npm run build:css\`. */\n`;
// Safety net: a public-root path such as url("png/x.png") is rebased to the bundle location.
const bundle = (banner + parts.join('\n') + '\n').replace(/url\(\s*(["']?)(?!data:|https?:|\/|#|blob:|\.\.\/)([^"')]+)\1\s*\)/gi,
  (whole, quote, rawUrl) => `url(${quote}../${rawUrl.trim().replace(/^\.\//, '')}${quote})`);
postcss.parse(bundle, { from: output });
fs.writeFileSync(output, bundle);
console.log(`Built ${path.relative(root, output)} from ${files.length} modules (${rules} rules, ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB).`);
