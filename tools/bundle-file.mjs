// file:// üzerinde tarayıcılar ES modül yüklemez. Bu araç js/ altındaki modülleri
// js/app.file.js adlı tek klasik betikte birleştirir. js/ altında değişiklik
// yapınca yeniden çalıştırın: npm run bundle
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = ['game', 'strategy', 'storage', 'audio', 'animations', 'ui'];

export function buildBundle() {
  const parts = MODULES.map((name) => {
    const source = fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8');
    const body = source
      .replace(/^import .*;\r?\n/gm, '')
      .replace(/^export /gm, '');
    return `// --- ${name}.js ---\n${body}`;
  });
  return `// Üretilmiş dosya, elle düzenlemeyin. Kaynak: js/*.js (npm run bundle)\n(function () {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(root, 'js', 'app.file.js'), buildBundle());
}
