import { execSync } from 'child_process';
import fs from 'fs';
fs.mkdirSync('dist', { recursive: true });
fs.rmSync('dist/myopdf.zip', { force: true });
execSync('cd extension && zip -qr ../dist/myopdf.zip .', { stdio: 'inherit' });
console.log('Created dist/myopdf.zip');
