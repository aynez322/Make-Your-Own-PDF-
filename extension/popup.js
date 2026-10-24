import { getClips, clearAll } from './db.js';
import { buildSummaryPdf, downloadBytes } from './export.js';

const $ = (id) => document.getElementById(id);

const clips = await getClips();
const n = clips.length;
const nSrc = new Set(clips.map((c) => c.sourceId)).size;
$('count').textContent = n;
$('countLabel').textContent = n === 1 ? 'page in your summary' : 'pages in your summary';
$('sources').textContent = n ? `from ${nSrc} PDF${nSrc === 1 ? '' : 's'}` : 'Open a PDF and press the shortcut on a page you need.';
$('quick').disabled = $('clear').disabled = !n;

$('clear').onclick = async () => {
  $('clear').disabled = $('quick').disabled = true;
  await clearAll();
  $('clear').textContent = '✓ Summary cleared';
  $('count').textContent = '0';
  $('countLabel').textContent = 'pages in your summary';
  $('sources').textContent = 'Open a PDF and press the shortcut on a page you need.';
};

$('review').onclick = () => { chrome.tabs.create({ url: 'collection.html' }); window.close(); };
$('open').onclick = () => { chrome.tabs.create({ url: 'viewer.html' }); window.close(); };
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
$('extPage').onclick = () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });

$('quick').onclick = async () => {
  $('quick').disabled = true;
  $('quick').textContent = 'Building…';
  try {
    const { stamp = true, filename = 'summary.pdf' } = await chrome.storage.local.get(['stamp', 'filename']);
    const bytes = await buildSummaryPdf({ stamp, title: filename.replace(/\.pdf$/i, '') });
    downloadBytes(bytes, filename);
    $('quick').textContent = '✓ Downloaded';
  } catch (e) {
    $('quick').textContent = `Failed: ${e.message}`;
  }
};

chrome.commands.getAll((cmds) => {
  const map = { 'toggle-page': 'k-toggle', 'undo-last': 'k-undo', 'open-collection': 'k-open' };
  cmds.forEach((c) => { if (map[c.name]) $(map[c.name]).textContent = c.shortcut || 'not set'; });
});

const { autoOpen = true } = await chrome.storage.local.get('autoOpen');
$('autoOpen').checked = autoOpen;
$('autoOpen').onchange = () => chrome.storage.local.set({ autoOpen: $('autoOpen').checked });
$('fileWarn').hidden = await chrome.extension.isAllowedFileSchemeAccess();
