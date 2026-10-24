import { pdfjsLib } from './pdfsetup.js';
import { getClips, setClips, listSourcesMeta, getSource, clearAll } from './db.js';
import { buildSummaryPdf, downloadBytes } from './export.js';
import { resetBrowserZoom } from './zoom.js';

const $ = (id) => document.getElementById(id);
const grid = $('grid');
let clips = [];
let sources = new Map();
const docCache = new Map();
const PALETTE = ['#e85d04', '#2b7de9', '#1f9d55', '#9b51e0', '#d6336c', '#0c8599', '#e0a800', '#5c6ac4'];

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast show ok';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2200);
}

function getDoc(sourceId) {
  if (!docCache.has(sourceId)) {
    docCache.set(sourceId, getSource(sourceId).then((src) =>
      pdfjsLib.getDocument({ data: new Uint8Array(src.data.slice(0)) }).promise));
  }
  return docCache.get(sourceId);
}

async function renderThumb(card) {
  const { sourceId, page } = card.dataset;
  const holder = card.querySelector('.thumb');
  try {
    const pdf = await getDoc(sourceId);
    const p = await pdf.getPage(+page);
    const vp1 = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: (340 / vp1.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    holder.replaceChildren(canvas);
  } catch (e) {
    console.error(e);
    holder.textContent = 'preview unavailable';
  }
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { io.unobserve(e.target); renderThumb(e.target); }
  }
}, { rootMargin: '400px' });

const colorFor = (() => {
  const map = new Map();
  return (id) => {
    if (!map.has(id)) map.set(id, PALETTE[map.size % PALETTE.length]);
    return map.get(id);
  };
})();

function render() {
  const nSources = new Set(clips.map((c) => c.sourceId)).size;
  $('subtitle').textContent = clips.length
    ? `${clips.length} page${clips.length === 1 ? '' : 's'} from ${nSources} PDF${nSources === 1 ? '' : 's'}`
    : 'Empty';
  $('empty').hidden = clips.length > 0;
  $('downloadBtn').disabled = $('sortBtn').disabled = $('clearBtn').disabled = !clips.length;

  const old = new Map([...grid.children].map((el) => [`${el.dataset.sourceId}:${el.dataset.page}`, el]));
  const frag = document.createDocumentFragment();
  clips.forEach((c, i) => {
    const key = `${c.sourceId}:${c.page}`;
    let card = old.get(key);
    if (!card) {
      card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.sourceId = c.sourceId;
      card.dataset.page = c.page;
      const name = sources.get(c.sourceId)?.name || 'Unknown PDF';
      card.innerHTML = `
        <button class="remove" title="Remove from summary">✕</button>
        <div class="thumb"><div class="spinner"></div></div>
        <div class="meta"><span class="num"></span><span class="dot"></span>
          <span class="src"></span><span class="pg">p. ${c.page}</span></div>`;
      card.querySelector('.src').textContent = name.replace(/\.pdf$/i, '');
      card.querySelector('.src').title = name;
      card.querySelector('.dot').style.background = colorFor(c.sourceId);
      io.observe(card);
    }
    card.querySelector('.num').textContent = `${i + 1}.`;
    frag.appendChild(card);
  });
  grid.replaceChildren(frag);
}

async function load() {
  [clips, sources] = await Promise.all([
    getClips(),
    listSourcesMeta().then((list) => new Map(list.map((s) => [s.id, s]))),
  ]);
  render();
}

grid.addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const { sourceId, page } = card.dataset;
  if (e.target.closest('.remove')) {
    clips = clips.filter((c) => !(c.sourceId === sourceId && c.page === +page));
    card.remove();
    render();
    await setClips(clips);
    return;
  }
  chrome.tabs.create({ url: `viewer.html?source=${sourceId}#page=${page}` });
});

let dragged = null;
grid.addEventListener('dragstart', (e) => {
  dragged = e.target.closest('.card');
  dragged?.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
grid.addEventListener('dragover', (e) => {
  const over = e.target.closest('.card');
  if (!dragged || !over || over === dragged) return;
  e.preventDefault();
  grid.querySelectorAll('.drop-before,.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  const r = over.getBoundingClientRect();
  over.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
});
grid.addEventListener('drop', async (e) => {
  e.preventDefault();
  const over = e.target.closest('.card');
  if (!dragged || !over || over === dragged) return;
  const before = over.classList.contains('drop-before');
  before ? over.before(dragged) : over.after(dragged);
  clips = [...grid.children].map((el) =>
    clips.find((c) => c.sourceId === el.dataset.sourceId && c.page === +el.dataset.page));
  render();
  await setClips(clips);
});
grid.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = null;
  grid.querySelectorAll('.drop-before,.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
});

$('sortBtn').addEventListener('click', async () => {
  const firstSeen = new Map();
  clips.forEach((c, i) => { if (!firstSeen.has(c.sourceId)) firstSeen.set(c.sourceId, i); });
  clips = [...clips].sort((a, b) => (firstSeen.get(a.sourceId) - firstSeen.get(b.sourceId)) || (a.page - b.page));
  render();
  await setClips(clips);
  toast('Sorted by course and page');
});

$('clearBtn').addEventListener('click', async () => {
  await clearAll();
  docCache.clear();
  await load();
  toast('Summary cleared');
});

$('downloadBtn').addEventListener('click', async () => {
  const btn = $('downloadBtn');
  btn.disabled = true;
  $('progress').hidden = false;
  const filename = $('filename').value.trim() || 'summary.pdf';
  try {
    const bytes = await buildSummaryPdf({
      stamp: $('stamp').checked,
      title: filename.replace(/\.pdf$/i, ''),
      onProgress: (d, t) => {
        $('barFill').style.width = `${(d / t) * 100}%`;
        $('progressText').textContent = `Building PDF… ${d}/${t}`;
      },
    });
    downloadBytes(bytes, filename);
    toast(`Downloaded ${clips.length} pages`);
  } catch (e) {
    console.error(e);
    alert(`Export failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    $('progress').hidden = true;
  }
});

chrome.storage.local.get(['stamp', 'filename']).then(({ stamp, filename }) => {
  if (stamp !== undefined) $('stamp').checked = stamp;
  if (filename) $('filename').value = filename;
});
$('stamp').addEventListener('change', () => chrome.storage.local.set({ stamp: $('stamp').checked }));
$('filename').addEventListener('change', () => chrome.storage.local.set({ filename: $('filename').value }));

chrome.commands.getAll((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-page');
  if (c?.shortcut) $('kbd').textContent = c.shortcut;
});

chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'clips-changed') load(); });

chrome.tabs.getCurrent().then((tab) => resetBrowserZoom(tab?.id));
load();
