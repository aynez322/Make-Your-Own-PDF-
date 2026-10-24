import * as pdfjsLib from './lib/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

export { pdfjsLib };
export const loadViewerLib = () => import('./lib/pdf_viewer.mjs');

export async function fetchPdfBytes(url) {
  if (url.startsWith('file://')) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => (xhr.response && xhr.response.byteLength ? resolve(xhr.response)
        : reject(new Error('Could not read the local file. Enable "Allow access to file URLs" for MYOPDF in chrome://extensions.')));
      xhr.onerror = () => reject(new Error('Could not read the local file. Enable "Allow access to file URLs" for MYOPDF in chrome://extensions.'));
      xhr.send();
    });
  }
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
    return last || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}
