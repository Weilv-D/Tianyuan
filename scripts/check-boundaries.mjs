import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(root, 'src');

const layers = [
  {
    name: 'core',
    allowedLayers: new Set(['core', 'data']),
    forbiddenApis: [
      ['Math.random', /\bMath\.random\s*\(/g],
      ['Date.now', /\bDate\.now\s*\(/g],
      ['Date constructor', /\bnew\s+Date\s*\(/g],
      ['browser global', /\b(?:window|document|localStorage|sessionStorage)\b/g],
      ['browser clock', /\bperformance\.now\s*\(/g],
      ['browser I/O', /\b(?:fetch|requestAnimationFrame|setTimeout|setInterval)\s*\(/g],
    ],
  },
  {
    name: 'data',
    allowedLayers: new Set(['core', 'data']),
    forbiddenApis: [
      ['Math.random', /\bMath\.random\s*\(/g],
      ['Date.now', /\bDate\.now\s*\(/g],
      ['Date constructor', /\bnew\s+Date\s*\(/g],
      ['browser global', /\b(?:window|document|localStorage|sessionStorage)\b/g],
      ['browser clock', /\bperformance\.now\s*\(/g],
      ['browser I/O', /\b(?:fetch|requestAnimationFrame|setTimeout|setInterval)\s*\(/g],
    ],
  },
  {
    name: 'game',
    allowedLayers: new Set(['core', 'data', 'game']),
    forbiddenApis: [
      ['Math.random', /\bMath\.random\s*\(/g],
      ['system time outside save adapter', /\b(?:Date\.now\s*\(|new\s+Date\s*\()/g, new Set(['src/game/save.ts'])],
    ],
  },
];

function sourceFiles(directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.isFile() && extname(entry.name) === '.ts') out.push(path);
  }
  return out;
}

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (comment) => ' '.repeat(comment.length));
}

function withoutStrings(source) {
  return source.replace(
    /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g,
    (literal) => literal.replace(/[^\n]/g, ' '),
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function importedSpecifiers(source) {
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push({ specifier: match[1], index: match.index ?? 0 });
    }
  }
  return found;
}

const violations = [];
let checkedFiles = 0;

for (const layer of layers) {
  for (const file of sourceFiles(resolve(srcRoot, layer.name))) {
    checkedFiles += 1;
    const source = readFileSync(file, 'utf8');
    const code = withoutComments(source);
    const apiCode = withoutStrings(code);
    const displayPath = relative(root, file).split(sep).join('/');

    for (const imported of importedSpecifiers(code)) {
      const { specifier, index } = imported;
      if (!specifier.startsWith('.')) {
        violations.push(`${displayPath}:${lineNumber(code, index)} ${layer.name} 不得直接依赖包 ${specifier}`);
        continue;
      }
      const target = relative(srcRoot, resolve(dirname(file), specifier)).split(sep)[0];
      if (!layer.allowedLayers.has(target)) {
        violations.push(`${displayPath}:${lineNumber(code, index)} ${layer.name} 不得依赖 src/${target}`);
      }
    }

    for (const match of code.matchAll(/\bimport\s*\(\s*(?!['"])/g)) {
      violations.push(`${displayPath}:${lineNumber(code, match.index ?? 0)} 动态 import 必须使用字面量路径`);
    }

    for (const [label, pattern, allowedFiles] of layer.forbiddenApis) {
      if (allowedFiles?.has(displayPath)) continue;
      for (const match of apiCode.matchAll(pattern)) {
        violations.push(`${displayPath}:${lineNumber(code, match.index ?? 0)} 禁止 ${label}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('架构边界检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`架构边界通过：${checkedFiles} 个 core/data/game 文件。`);
