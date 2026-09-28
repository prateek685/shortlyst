// Makes clicking the toolbar icon open the side panel directly, instead of
// requiring a default_popup. Chrome only allows this to be set from an
// extension-gesture-triggered context, so it's set once on install/update.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
