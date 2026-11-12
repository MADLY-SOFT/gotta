'use strict';
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const rootDir = path.resolve(__dirname, '..');
const modulesDir = path.join(rootDir, 'public', 'css', 'modules');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith('.css')) files.push(file);
  }
}
walk(modulesDir);
const selectorCounts = new Map();
let ruleCount = 0;
let importantCount = 0;
let bytes = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  bytes += Buffer.byteLength(source);
  const parsed = postcss.parse(source, { from: file });
  parsed.walkRules(rule => {
    ruleCount += 1;
    for (const selector of rule.selectors) selectorCounts.set(selector, (selectorCounts.get(selector) || 0) + 1);
    rule.walkDecls(decl => { if (decl.important) importantCount += 1; });
  });
}
const repeated = [...selectorCounts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({
  moduleFiles: files.length,
  sourceBytes: bytes,
  rules: ruleCount,
  uniqueSelectors: selectorCounts.size,
  repeatedSelectors: repeated.length,
  importantDeclarations: importantCount,
  mostRepeated: repeated.slice(0, 25).map(([selector, count]) => ({ selector, count })),
  note: 'Read-only audit. Repeated selectors and !important declarations are not auto-removed because cascade order may be intentional.'
}, null, 2));
