import fs from 'fs';
import path from 'path';
const lib = 'extension/lib';
fs.rmSync(lib, { recursive: true, force: true });
fs.mkdirSync(lib, { recursive: true });
const files = [
  'node_modules/pdfjs-dist/build/pdf.min.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/web/pdf_viewer.mjs',
  'node_modules/pdfjs-dist/web/pdf_viewer.css',
  'node_modules/pdf-lib/dist/pdf-lib.esm.min.js',
];
for (const f of files) {
  const out = path.join(lib, path.basename(f));
  const text = fs.readFileSync(f, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '');
  fs.writeFileSync(out, text);
}
fs.cpSync('node_modules/pdfjs-dist/web/images', path.join(lib, 'images'), { recursive: true });
console.log('Libraries copied to', lib);
