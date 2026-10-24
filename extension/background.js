import { getClips, undoLast } from './db.js';

const VIEWER = chrome.runtime.getURL('viewer.html');
const viewerUrlFor = (url) => `${VIEWER}?file=${encodeURIComponent(url)}`;

async function getSettings() {
  const { autoOpen = true } = await chrome.storage.local.get('autoOpen');
  return { autoOpen };
}

async function refreshBadge(count) {
  if (count === undefined) count = (await getClips()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#e85d04' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-link', title: 'Open PDF in MYOPDF', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-page', title: 'Open this PDF in MYOPDF', contexts: ['page'] });
  });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => refreshBadge());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === 'open-link' ? info.linkUrl : (info.pageUrl || tab?.url);
  if (!url) return;
  if (info.menuItemId === 'open-link') chrome.tabs.create({ url: viewerUrlFor(url), index: (tab?.index ?? 0) + 1 });
  else if (tab?.id) chrome.tabs.update(tab.id, { url: viewerUrlFor(url) });
});

async function consumeBypass(url) {
  const { bypass = [] } = await chrome.storage.session.get('bypass');
  const i = bypass.indexOf(url);
  if (i < 0) return false;
  bypass.splice(i, 1);
  await chrome.storage.session.set({ bypass });
  return true;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.method !== 'GET') return;
    if (details.statusCode < 200 || details.statusCode >= 300) return;
    const headers = details.responseHeaders || [];
    const h = (name) => headers.find((x) => x.name.toLowerCase() === name)?.value || '';
    const type = h('content-type').toLowerCase();
    const isPdf = type.includes('application/pdf') ||
      (type.includes('application/octet-stream') && /\.pdf($|[?#])/i.test(details.url));
    if (!isPdf) return;
    if (/^\s*attachment/i.test(h('content-disposition'))) return;
    (async () => {
      if (!(await getSettings()).autoOpen) return;
      if (await consumeBypass(details.url)) return;
      chrome.tabs.update(details.tabId, { url: viewerUrlFor(details.url) });
    })();
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders']
);

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url || !url.startsWith('file://') || !/\.pdf$/i.test(url.split(/[?#]/)[0])) return;
  if (!(await getSettings()).autoOpen) return;
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) return;
  if (await consumeBypass(url)) return;
  chrome.tabs.update(tabId, { url: viewerUrlFor(url) });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (command === 'open-collection') {
    const url = chrome.runtime.getURL('collection.html');
    const [existing] = await chrome.tabs.query({ url });
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
    } else chrome.tabs.create({ url });
    return;
  }

  if (command === 'undo-last') {
    await undoLast();
    refreshBadge();
    return;
  }

  if (command === 'toggle-page' && tab?.url) {
    if (tab.url.startsWith(VIEWER)) {
      chrome.runtime.sendMessage({ type: 'command', command, tabId: tab.id }).catch(() => {});
    } else if (/\.pdf($|[?#])/i.test(tab.url) || tab.url.startsWith('file://')) {
      const m = tab.url.match(/#page=(\d+)/);
      const clean = tab.url.split('#')[0];
      chrome.tabs.update(tab.id, { url: viewerUrlFor(clean) + (m ? `#page=${m[1]}` : '') });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'clips-changed') refreshBadge(msg.count);
  if (msg?.type === 'bypass' && msg.url) {
    chrome.storage.session.get('bypass').then(({ bypass = [] }) => {
      bypass.push(msg.url);
      chrome.storage.session.set({ bypass }).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
});
