import { PDFDocument, StandardFonts, rgb } from './lib/pdf-lib.esm.min.js';
import { pdfjsLib } from './pdfsetup.js';
import { getClips, getSource } from './db.js';

const latin1 = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

async function renderPageAsImage(bytes, pageNumber, scale = 2.5) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { jpg: new Uint8Array(await blob.arrayBuffer()), width: base.width, height: base.height };
  } finally {
    pdf.destroy();
  }
}

export async function buildSummaryPdf({ stamp = true, title = 'Summary', onProgress = () => {} } = {}) {
  const clips = await getClips();
  if (!clips.length) throw new Error('Your summary is empty.');

  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('MYOPDF');
  out.setProducer('MYOPDF – Make Your Own PDF (pdf-lib)');
  const font = await out.embedFont(StandardFonts.Helvetica);

  const loaded = new Map();
  let done = 0;

  for (const clip of clips) {
    if (!loaded.has(clip.sourceId)) {
      const src = await getSource(clip.sourceId);
      if (!src) { loaded.set(clip.sourceId, null); }
      else {
        let doc = null;
        try { doc = await PDFDocument.load(src.data, { ignoreEncryption: true, updateMetadata: false }); }
        catch (e) { console.warn('pdf-lib could not parse', src.name, e); }
        loaded.set(clip.sourceId, { src, doc });
      }
    }
    const entry = loaded.get(clip.sourceId);
    if (!entry) { onProgress(++done, clips.length); continue; }

    let page;
    try {
      if (!entry.doc) throw new Error('fallback');
      [page] = await out.copyPages(entry.doc, [clip.page - 1]);
      out.addPage(page);
    } catch {
      const img = await renderPageAsImage(entry.src.data, clip.page);
      const jpg = await out.embedJpg(img.jpg);
      page = out.addPage([img.width, img.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: img.width, height: img.height });
    }

    if (stamp) {
      const label = latin1(`${entry.src.name.replace(/\.pdf$/i, '')}  -  p. ${clip.page}`);
      const size = 7.5;
      const box = page.getCropBox();
      const width = box.width;
      const w = font.widthOfTextAtSize(label, size);
      page.drawRectangle({ x: box.x + width - w - 16, y: box.y + 4, width: w + 10, height: size + 6,
        color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(label, { x: box.x + width - w - 11, y: box.y + 7, size, font, color: rgb(0.45, 0.45, 0.5) });
    }
    onProgress(++done, clips.length);
  }

  return out.save();
}

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
