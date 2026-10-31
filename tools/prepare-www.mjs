// Capacitor için oyunun yalnızca çalışma dosyalarını www/ altına kopyalar.
// sw.js ve manifest alınmaz: APK dosyaları zaten içinde taşır, service worker
// gerekmez. app.file.js de yalnızca file:// açılışı içindir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
for (const entry of ['index.html', 'css', 'fonts', 'icons', 'js']) {
  fs.cpSync(path.join(root, entry), path.join(www, entry), {
    recursive: true,
    filter: (source) => !source.endsWith('app.file.js') && !source.endsWith('.txt'),
  });
}
