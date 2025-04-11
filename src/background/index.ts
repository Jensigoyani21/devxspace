chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log('tabId :', tabId);
  if (changeInfo.status === "complete" && tab.url) {
    const stored = await chrome.storage.local.get(['connectionState', 'currentUrl']);
    const state = stored.connectionState;
    const prevUrl = stored.currentUrl;

    // Only notify about URL changes if we're connected and URL actually changed
    if (state?.isConnected && prevUrl !== tab.url) {
      // Show notification about room change
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'DexSpace Voice Room',
        message: `Moved to new room: ${tab.url}`,
        priority: 2
      });

      chrome.storage.local.set({
        currentUrl: tab.url,
        urlChanged: {
          from: prevUrl,
          to: tab.url,
          timestamp: Date.now()
        }
      });
    } else {
      chrome.storage.local.set({ currentUrl: tab.url });
    }
  }
});
