// Debug APK üretir: npm run android:build
// JAVA_HOME ve ANDROID_HOME tanımlı değilse %LOCALAPPDATA%\Android altındaki
// JDK 21 ve SDK kullanılır. Sonuç: dist/AsilBlackjack-debug.apk
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(process.env.LOCALAPPDATA ?? '', 'Android');
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || path.join(android, 'jdk-21'),
  ANDROID_HOME: process.env.ANDROID_HOME || path.join(android, 'Sdk'),
};
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit', shell: true });

run('node', ['tools/prepare-www.mjs']);
run('npx', ['cap', 'sync', 'android']);
fs.writeFileSync(
  path.join(root, 'android', 'local.properties'),
  `sdk.dir=${env.ANDROID_HOME.replaceAll('\\', '/')}\n`,
);
const project = path.join(root, 'android');
run(path.join(project, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['assembleDebug', '--no-daemon'], project);

const output = path.join(root, 'dist', 'AsilBlackjack-debug.apk');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), output);
console.log(`APK: ${output}`);
