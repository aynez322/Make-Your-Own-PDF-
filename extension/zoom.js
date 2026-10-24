// Chrome remembers browser zoom per origin, and every extension page shares one origin, so zooming
// one MYOPDF tab would zoom all of them. Scope the zoom to this tab and start it at 100%.
export async function resetBrowserZoom(tabId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
    await chrome.tabs.setZoom(tabId, 1);
  } catch (e) {
    console.warn('Could not reset zoom', e);
  }
}
