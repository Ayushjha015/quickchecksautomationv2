// Listener for messages from the page context
window.addEventListener('message', (event) => {
  // Only accept messages from our own window
  if (event.source !== window) return;

  // Handle extension detection ping
  if (event.data && event.data.type === 'PING_QUIKCHEX_EXTENSION') {
    window.postMessage({ type: 'PONG_QUIKCHEX_EXTENSION' }, '*');
  }

  // Handle cookie synchronization request
  if (event.data && event.data.type === 'SYNC_COOKIES') {
    const cookies = event.data.cookies;
    
    chrome.runtime.sendMessage({ action: 'syncCookies', cookies }, (response) => {
      window.postMessage({
        type: 'SYNC_COOKIES_RESPONSE',
        success: response?.success ?? false,
        error: response?.error || null
      }, '*');
    });
  }
});

// Let the page know the extension content script is loaded immediately if it is already running
window.postMessage({ type: 'PONG_QUIKCHEX_EXTENSION' }, '*');
