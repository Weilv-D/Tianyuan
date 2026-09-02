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
  {
    // 表现层（DEVELOPMENT §3.3）：消费下层模块与 UI 组件，不反向输出规则。
    // render ↔ ui 双向可达是既定事实（卡片/提示卡/面板互相复用），一并放行。
    name: 'render',
    allowedLayers: new Set(['render', 'ui', 'game', 'core', 'data', 'audio', 'music', 'assets', 'root']),
    allowPackages: true,
  },
  {
    // 可复用界面组件：表现层与只读领域数据。对 game 层只开放偏好存取（save.ts）
    // 与状态类型/查表助手（state.ts）两个白名单文件 —— 阻断 UI 直接改写
    // 对局可变状态（match/pool/ai 等一旦被 UI 引用即报错）。
    name: 'ui',
    allowedLayers: new Set(['ui', 'render', 'core', 'data', 'audio', 'music', 'root']),
    allowedGameModules: new Set(['game/save', 'game/state']),
    allowPackages: true,
  },
  {
    // 音频执行与曲目清单：不读对局状态、不影响战斗结果。
    name: 'audio',
    allowedLayers: new Set(['audio', 'music']),
    allowPackages: true,
  },
  {
    name: 'music',
    allowedLayers: new Set(['music']),
    allowPackages: true,
  },
  {
    // src 根部散文件（main.ts 启动组合根 / version.ts 常量）：作为组合根放行
    // 全部层与 npm 包，但引用目标仍必须落在已知桶内 —— 拼错目录、依赖不存在的
    // 模块照常报错。此层不设 forbiddenApis（入口本来就要碰 window/document）。
    name: 'root',
    allowedLayers: new Set(['core', 'data', 'game', 'render', 'ui', 'audio', 'music', 'assets', 'root']),
    allowPackages: true,
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

function checkLayerFile(file, layer) {
  checkedFiles += 1;
  const source = readFileSync(file, 'utf8');
  const code = withoutComments(source);
  const apiCode = withoutStrings(code);
  const displayPath = relative(root, file).split(sep).join('/');

  for (const imported of importedSpecifiers(code)) {
    const { specifier, index } = imported;
    if (!specifier.startsWith('.')) {
      // 表现层/组件层正常引用 npm 包（phaser 等）；内核三层保持"零包依赖"纪律
      if (!layer.allowPackages) {
        violations.push(`${displayPath}:${lineNumber(code, index)} ${layer.name} 不得直接依赖包 ${specifier}`);
      }
      continue;
    }
    const relPath = relative(srcRoot, resolve(dirname(file), specifier)).split(sep).join('/');
    // TS 导入惯例省略 .ts 扩展名；白名单与 target 归属都按去扩展名口径比较
    const modPath = relPath.replace(/\.ts$/, '');
    // src 根目录下的散文件（version）归入 root 桶
    const target = modPath.includes('/') ? modPath.split('/')[0] : 'root';
    if (layer.allowedGameModules && target === 'game') {
      // 带白名单的层：game 目录只放行名单内的模块，名单外一律报错
      if (!layer.allowedGameModules.has(modPath)) {
        violations.push(`${displayPath}:${lineNumber(code, index)} ${layer.name} 不得依赖 src/${modPath}（game 白名单外）`);
      }
      continue;
    }
    if (!layer.allowedLayers.has(target)) {
      violations.push(`${displayPath}:${lineNumber(code, index)} ${layer.name} 不得依赖 src/${target}`);
    }
  }

  for (const match of code.matchAll(/\bimport\s*\(\s*(?!['"])/g)) {
    violations.push(`${displayPath}:${lineNumber(code, match.index ?? 0)} 动态 import 必须使用字面量路径`);
  }

  for (const [label, pattern, allowedFiles] of layer.forbiddenApis ?? []) {
    if (allowedFiles?.has(displayPath)) continue;
    for (const match of apiCode.matchAll(pattern)) {
      violations.push(`${displayPath}:${lineNumber(code, match.index ?? 0)} 禁止 ${label}`);
    }
  }
}

// 七个子目录逐层检查；root 层文件（src 根部散文件）单独归堆检查 ——
// 否则 main.ts / version.ts 永远在门禁视野之外，规则加严也拦不住它们。
const allSrcFiles = sourceFiles(srcRoot);
const layerDirNames = new Set(layers.filter((l) => l.name !== 'root').map((l) => l.name));
const layerByName = new Map(layers.map((l) => [l.name, l]));
for (const layer of layers) {
  if (layer.name === 'root') continue;
  for (const file of sourceFiles(resolve(srcRoot, layer.name))) {
    checkLayerFile(file, layer);
  }
}
for (const file of allSrcFiles) {
  const first = relative(srcRoot, file).split(sep)[0];
  if (!layerDirNames.has(first)) checkLayerFile(file, layerByName.get('root'));
}
// 覆盖完整性：每个 src 文件必须恰好被检一次（层目录与 root 归堆互斥且并集为全量）。
// 断言挡住未来"新增目录忘了挂进 layers"的漂移。
if (checkedFiles !== allSrcFiles.length) {
  console.error(`架构边界检查失败：覆盖计数漂移（检查 ${checkedFiles} 个，src 实有 ${allSrcFiles.length} 个）`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error('架构边界检查失败：');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`架构边界通过：${checkedFiles} 个 src 文件（core/data/game/render/ui/audio/music + 根组合层）。`);
