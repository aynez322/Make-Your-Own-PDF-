import { pdfjsLib, loadViewerLib, fetchPdfBytes, nameFromUrl } from './pdfsetup.js';
import { hashBytes, putSource, hasSource, getClips, toggleClip, getSource } from './db.js';
import { resetBrowserZoom } from './zoom.js';

const $ = (id) => document.getElementById(id);
const els = {
  docName: $('docName'), navGroup: $('navGroup'), prev: $('prevBtn'), next: $('nextBtn'),
  pageInput: $('pageInput'), pageCount: $('pageCount'), zoomIn: $('zoomIn'), zoomOut: $('zoomOut'),
  zoomSelect: $('zoomSelect'), findInput: $('findInput'), findStatus: $('findStatus'),
  toggleBtn: $('toggleBtn'), toggleLabel: $('toggleLabel'), toggleKbd: $('toggleKbd'),
  countBadge: $('countBadge'), nativeBtn: $('nativeBtn'), container: $('viewerContainer'),
  viewer: $('viewer'), dropZone: $('dropZone'), fileInput: $('fileInput'), loadError: $('loadError'),
  loading: $('loading'), toast: $('toast'),
  sidebarBtn: $('sidebarBtn'), sidebar: $('sidebar'), tabPages: $('tabPages'), tabOutline: $('tabOutline'),
  thumbList: $('thumbList'), outlineList: $('outlineList'),
};

const state = {
  sourceId: null, name: '', url: null, bytes: null, pdf: null,
  pdfViewer: null, linkService: null, eventBus: null, clipped: new Set(), myTabId: null, busy: false,
  outlinePages: [], // [{ el, page }] sorted by page, for highlighting the current chapter
};

let toastTimer;
function toast(html, kind = '') {
  els.toast.innerHTML = html;
  els.toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.className = 'toast'), 2200);
}

function showError(msg) {
  els.loading.hidden = true;
  els.dropZone.hidden = false;
  els.loadError.hidden = false;
  els.loadError.textContent = msg;
}

async function refreshCount() {
  const clips = await getClips();
  els.countBadge.textContent = clips.length;
  state.clipped = new Set(clips.filter((c) => c.sourceId === state.sourceId).map((c) => c.page));
  paintMarks();
  updateToggleButton();
}

function paintMarks() {
  if (!state.pdfViewer) return;
  for (let i = 1; i <= state.pdf.numPages; i++) {
    const pv = state.pdfViewer.getPageView(i - 1);
    pv?.div?.classList.toggle('clipped', state.clipped.has(i));
  }
  for (const el of els.thumbList.children) el.classList.toggle('clipped', state.clipped.has(+el.dataset.page));
}

function updateToggleButton() {
  if (!state.pdfViewer) return;
  const inIt = state.clipped.has(state.pdfViewer.currentPageNumber);
  els.toggleBtn.classList.toggle('active', inIt);
  els.toggleLabel.textContent = inIt ? '✓ In summary – remove' : '＋ Add page';
}

const toggleCurrentPage = () => togglePage(state.pdfViewer?.currentPageNumber);

// want: true = only add, false = only remove, undefined = toggle.
async function togglePage(page, want) {
  if (!state.pdfViewer || !page || state.busy) return;
  if (want !== undefined && want === state.clipped.has(page)) {
    toast(`<b>Page ${page}</b> is ${want ? 'already' : 'not'} in your summary`);
    return;
  }
  state.busy = true;
  try {
    if (!(await hasSource(state.sourceId))) {
      await putSource({ id: state.sourceId, name: state.name, url: state.url, data: state.bytes });
    }
    const { added, count } = await toggleClip(state.sourceId, page);
    els.countBadge.textContent = count;
    added ? state.clipped.add(page) : state.clipped.delete(page);
    paintMarks();
    updateToggleButton();
    toast(added
      ? `<b>Page ${page}</b> added · ${count} page${count === 1 ? '' : 's'} in summary`
      : `<b>Page ${page}</b> removed · ${count} left`, added ? 'ok' : 'warn');
    els.countBadge.parentElement.classList.remove('bump');
    void els.countBadge.offsetWidth;
    els.countBadge.parentElement.classList.add('bump');
  } catch (e) {
    console.error(e);
    toast(`Could not save the page: ${e.message}`, 'warn');
  } finally {
    state.busy = false;
  }
}

// ---------- Sidebar: page thumbnails and chapters (PDF outline) ----------

const THUMB_W = 132;
const thumbQueue = [];
let thumbBusy = false;
let thumbObserver = null;

function enqueueThumb(item) {
  thumbQueue.push(item);
  pumpThumbs();
}

// Render thumbnails one at a time so they don't compete with the main pages.
async function pumpThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const item = thumbQueue.shift();
    const pdf = state.pdf;
    if (!pdf || !item.isConnected) continue;
    try {
      const page = await pdf.getPage(+item.dataset.page);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (THUMB_W * (window.devicePixelRatio || 1)) / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (state.pdf === pdf && item.isConnected) {
        const img = item.querySelector('.thumb-img');
        img.style.height = '';
        img.replaceChildren(canvas);
      }
    } catch (e) {
      console.warn('thumbnail failed', e);
    }
  }
  thumbBusy = false;
}

async function buildThumbs(pdf) {
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { thumbObserver.unobserve(e.target); enqueueThumb(e.target); }
    }
  }, { root: els.thumbList, rootMargin: '600px 0px' });

  // Size placeholders like the first page so the list doesn't jump while rendering.
  const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
  if (state.pdf !== pdf) return;
  const height = Math.round(THUMB_W * (vp.height / vp.width));
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= pdf.numPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.dataset.page = i;
    item.title = `Page ${i}\nCtrl+click: add to summary · Ctrl+right-click: remove`;
    item.innerHTML = `<div class="thumb-img" style="height:${height}px"></div><span class="thumb-num">${i}</span>`;
    frag.appendChild(item);
    thumbObserver.observe(item);
  }
  els.thumbList.replaceChildren(frag);
}

async function resolveDestPage(pdf, dest) {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const ref = explicit[0];
    if (Number.isInteger(ref)) return ref + 1;
    return (await pdf.getPageIndex(ref)) + 1;
  } catch {
    return null;
  }
}

async function buildOutline(pdf) {
  const outline = await pdf.getOutline().catch(() => null);
  if (state.pdf !== pdf) return false;
  state.outlinePages = [];
  if (!outline?.length) {
    els.outlineList.innerHTML = '<p class="outline-empty">This PDF has no chapters (bookmarks). Use the Pages tab to jump around.</p>';
    return false;
  }
  const pending = [];
  const makeList = (items, depth) => {
    const ul = document.createElement('ul');
    for (const it of items) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'outline-row';
      const twisty = document.createElement('button');
      twisty.className = 'outline-twisty';
      twisty.textContent = '▼';
      twisty.tabIndex = -1;
      const link = document.createElement('a');
      link.className = 'outline-link';
      link.textContent = it.title || '(untitled)';
      link.title = it.title || '';
      if (it.bold) link.style.fontWeight = '600';
      if (it.italic) link.style.fontStyle = 'italic';
      link.addEventListener('click', () => {
        if (it.dest) state.linkService?.goToDestination(it.dest);
        else if (it.url) window.open(it.url, '_blank', 'noopener');
      });
      row.append(twisty, link);
      li.appendChild(row);
      if (it.items?.length) {
        li.appendChild(makeList(it.items, depth + 1));
        if (depth >= 1) li.classList.add('collapsed');
        twisty.addEventListener('click', () => li.classList.toggle('collapsed'));
      } else {
        twisty.classList.add('placeholder');
      }
      ul.appendChild(li);
      if (it.dest) {
        pending.push(resolveDestPage(pdf, it.dest).then((page) => page && state.outlinePages.push({ el: link, page })));
      }
    }
    return ul;
  };
  els.outlineList.replaceChildren(makeList(outline, 0));
  Promise.all(pending).then(() => {
    if (state.pdf !== pdf) return;
    state.outlinePages.sort((a, b) => a.page - b.page);
    highlightSidebar(state.pdfViewer?.currentPageNumber || 1, false);
  });
  return true;
}

function highlightSidebar(pageNumber, scroll = true) {
  const visible = !els.sidebar.hidden;
  els.thumbList.querySelector('.thumb-item.current')?.classList.remove('current');
  const item = els.thumbList.children[pageNumber - 1];
  if (item) {
    item.classList.add('current');
    if (scroll && visible && !els.thumbList.hidden) item.scrollIntoView({ block: 'nearest' });
  }

  els.outlineList.querySelector('.outline-link.current')?.classList.remove('current');
  let cur = null;
  for (const o of state.outlinePages) { if (o.page <= pageNumber) cur = o; else break; }
  if (!cur) return;
  cur.el.classList.add('current');
  // Expand collapsed parents so the current chapter is visible.
  for (let li = cur.el.closest('li')?.parentElement.closest('li'); li; li = li.parentElement.closest('li')) {
    li.classList.remove('collapsed');
  }
  if (scroll && visible && !els.outlineList.hidden) cur.el.scrollIntoView({ block: 'nearest' });
}

function showSideTab(which) {
  const pages = which === 'pages';
  els.thumbList.hidden = !pages;
  els.outlineList.hidden = pages;
  els.tabPages.classList.toggle('active', pages);
  els.tabOutline.classList.toggle('active', !pages);
  els.tabPages.setAttribute('aria-selected', pages);
  els.tabOutline.setAttribute('aria-selected', !pages);
  highlightSidebar(state.pdfViewer?.currentPageNumber || 1);
}

function setSidebar(open) {
  els.sidebar.hidden = !open;
  document.body.classList.toggle('sidebar-open', open);
  els.sidebarBtn.setAttribute('aria-pressed', open);
  chrome.storage.local.set({ sidebarOpen: open });
  refitScale();
  if (open) highlightSidebar(state.pdfViewer?.currentPageNumber || 1);
}

// Preset zoom modes (auto, page-width…) depend on the container size, so recompute them after a resize.
function refitScale() {
  const v = state.pdfViewer;
  if (!v?.pagesCount) return;
  const preset = v.currentScaleValue;
  if (isNaN(parseFloat(preset))) v.currentScaleValue = preset;
}

async function openBytes(bytes, name, url) {
  els.dropZone.hidden = true;
  els.loadError.hidden = true;
  els.loading.hidden = false;

  state.bytes = bytes;
  state.name = name;
  state.url = url;
  state.sourceId = await hashBytes(bytes);
  document.title = `${name} – MYOPDF`;
  els.docName.textContent = name;
  els.docName.title = url || name;

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  state.pdf = pdf;

  const { EventBus, PDFLinkService, PDFFindController, PDFViewer } = await loadViewerLib();
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2 });
  const findController = new PDFFindController({ eventBus, linkService });
  const pdfViewer = new PDFViewer({
    container: els.container, viewer: els.viewer, eventBus, linkService, findController,
    removePageBorders: false,
  });
  linkService.setViewer(pdfViewer);
  state.pdfViewer = pdfViewer;
  state.linkService = linkService;
  state.eventBus = eventBus;

  eventBus.on('pagesinit', () => {
    pdfViewer.currentScaleValue = 'auto';
    const m = location.hash.match(/page=(\d+)/);
    if (m) pdfViewer.currentPageNumber = Math.min(+m[1], pdf.numPages);
    paintMarks();
  });
  eventBus.on('pagechanging', ({ pageNumber }) => {
    els.pageInput.value = pageNumber;
    updateToggleButton();
    highlightSidebar(pageNumber);
    history.replaceState(null, '', `#page=${pageNumber}`);
  });
  eventBus.on('pagerendered', ({ pageNumber, source }) => {
    source?.div?.classList.toggle('clipped', state.clipped.has(pageNumber));
  });
  eventBus.on('scalechanging', ({ presetValue, scale }) => {
    const opt = [...els.zoomSelect.options].find((o) => o.value === (presetValue || String(scale)));
    if (opt) els.zoomSelect.value = opt.value;
    else {
      const custom = els.zoomSelect.querySelector('option[value="custom"]');
      custom.textContent = `${Math.round(scale * 100)}%`;
      els.zoomSelect.value = 'custom';
    }
  });
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
    els.findStatus.textContent = matchesCount.total ? `${matchesCount.current}/${matchesCount.total}` : '';
  });
  eventBus.on('updatefindcontrolstate', ({ state: s, matchesCount }) => {
    if (s === 1) els.findStatus.textContent = 'not found';
    else if (matchesCount?.total) els.findStatus.textContent = `${matchesCount.current}/${matchesCount.total}`;
  });

  // Open the sidebar before the pages load, so 'auto' zoom is computed for the final width.
  const { sidebarOpen = true } = await chrome.storage.local.get('sidebarOpen');
  els.sidebarBtn.hidden = false;
  setSidebar(sidebarOpen);
  buildThumbs(pdf).then(() => {
    paintMarks();
    highlightSidebar(pdfViewer.currentPageNumber, false);
  });
  buildOutline(pdf).then((hasOutline) => showSideTab(hasOutline ? 'outline' : 'pages'));

  pdfViewer.setDocument(pdf);
  linkService.setDocument(pdf, null);

  els.pageInput.max = pdf.numPages;
  els.pageCount.textContent = `/ ${pdf.numPages}`;
  els.navGroup.hidden = false;
  els.toggleBtn.hidden = false;
  els.nativeBtn.hidden = !url || url.startsWith('blob:');
  els.loading.hidden = true;
  await refreshCount();
}

async function openUrl(url) {
  els.loading.hidden = false;
  els.dropZone.hidden = true;
  try {
    const bytes = await fetchPdfBytes(url);
    await openBytes(bytes, nameFromUrl(url), url);
  } catch (e) {
    console.error(e);
    showError(`Couldn't open ${nameFromUrl(url)}: ${e.message}. ` +
      'If the site needs you to be logged in, download the PDF and drop it here instead.');
  }
}

async function openFile(file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    toast('That is not a PDF file', 'warn');
    return;
  }
  try {
    history.replaceState(null, '', location.pathname);
    resetViewer();
    await openBytes(await file.arrayBuffer(), file.name, null);
  } catch (e) {
    console.error(e);
    showError(`Couldn't open ${file.name}: ${e.message}`);
  }
}

function resetViewer() {
  state.pdfViewer?.setDocument(null);
  state.pdf?.destroy();
  state.pdfViewer = null;
  state.linkService = null;
  state.pdf = null;
  state.outlinePages = [];
  thumbQueue.length = 0;
  thumbObserver?.disconnect();
  els.viewer.innerHTML = '';
  els.thumbList.replaceChildren();
  els.outlineList.replaceChildren();
}

els.toggleBtn.addEventListener('click', toggleCurrentPage);
els.sidebarBtn.addEventListener('click', () => setSidebar(els.sidebar.hidden));
els.tabPages.addEventListener('click', () => showSideTab('pages'));
els.tabOutline.addEventListener('click', () => showSideTab('outline'));
// Thumbnails: click jumps to the page, Ctrl+click adds it to the summary, Ctrl+right-click removes it.
els.thumbList.addEventListener('click', (e) => {
  const item = e.target.closest('.thumb-item');
  if (!item || !state.pdfViewer) return;
  if (e.ctrlKey || e.metaKey) togglePage(+item.dataset.page, true);
  else state.pdfViewer.currentPageNumber = +item.dataset.page;
});
els.thumbList.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.thumb-item');
  if (!item || !e.ctrlKey) return;
  e.preventDefault();
  togglePage(+item.dataset.page, false);
});
window.addEventListener('resize', refitScale);

// Ctrl+wheel zooms the PDF, not the whole tab.
els.container.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !state.pdfViewer) return;
  e.preventDefault();
  e.deltaY < 0 ? state.pdfViewer.increaseScale() : state.pdfViewer.decreaseScale();
}, { passive: false });
els.prev.addEventListener('click', () => state.pdfViewer?.previousPage());
els.next.addEventListener('click', () => state.pdfViewer?.nextPage());
els.pageInput.addEventListener('change', () => {
  const n = Math.max(1, Math.min(+els.pageInput.value || 1, state.pdf?.numPages || 1));
  if (state.pdfViewer) state.pdfViewer.currentPageNumber = n;
});
els.zoomIn.addEventListener('click', () => state.pdfViewer?.increaseScale());
els.zoomOut.addEventListener('click', () => state.pdfViewer?.decreaseScale());
els.zoomSelect.addEventListener('change', () => {
  if (state.pdfViewer && els.zoomSelect.value !== 'custom') state.pdfViewer.currentScaleValue = els.zoomSelect.value;
});

function find(type = '', findPrevious = false) {
  state.eventBus?.dispatch('find', {
    source: null, type, query: els.findInput.value, caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious, matchDiacritics: false,
  });
}
els.findInput.addEventListener('input', () => find(''));
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); find('again', e.shiftKey); }
  if (e.key === 'Escape') { els.findInput.value = ''; find(''); els.findInput.blur(); els.findStatus.textContent = ''; }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.pdfViewer) {
    e.preventDefault();
    els.findInput.focus();
    els.findInput.select();
    return;
  }
  if (e.target.matches('input, select, textarea')) return;
  if (!state.pdfViewer) return;
  if (e.key === 'ArrowRight') { state.pdfViewer.nextPage(); }
  if (e.key === 'ArrowLeft') { state.pdfViewer.previousPage(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); state.pdfViewer.increaseScale(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); state.pdfViewer.decreaseScale(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); state.pdfViewer.currentScaleValue = 'auto'; }
});

els.nativeBtn.addEventListener('click', async () => {
  if (!state.url) return;
  await chrome.runtime.sendMessage({ type: 'bypass', url: state.url });
  location.href = state.url + `#page=${state.pdfViewer?.currentPageNumber || 1}`;
});

els.fileInput.addEventListener('change', () => openFile(els.fileInput.files[0]));
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
  e.preventDefault();
  if (t === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging');
}));
document.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'command' && msg.command === 'toggle-page' && msg.tabId === state.myTabId) {
    toggleCurrentPage();
  }
  if (msg?.type === 'clips-changed') {
    refreshCount();
    if (msg.reason === 'undo' && document.visibilityState === 'visible') {
      toast(`Undid page ${msg.page} · ${msg.count} in summary`, 'warn');
    }
  }
});

chrome.commands.getAll((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-page');
  if (c?.shortcut) els.toggleKbd.textContent = c.shortcut;
  else els.toggleKbd.hidden = true;
});

(async () => {
  state.myTabId = (await chrome.tabs.getCurrent())?.id ?? null;
  resetBrowserZoom(state.myTabId);
  refreshCount();
  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const sourceId = params.get('source');
  if (sourceId) {
    const src = await getSource(sourceId);
    if (src) return openBytes(src.data, src.name, src.url || null).catch((e) => showError(e.message));
    if (!file) return showError('That PDF is no longer in your summary.');
  }
  if (file) openUrl(file);
  else els.dropZone.hidden = false;
})();
