chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'syncCookies') {
    const { cookies } = message;
    
    if (!cookies || !Array.isArray(cookies)) {
      sendResponse({ success: false, error: 'No cookies provided' });
      return;
    }

    const promises = cookies.map(cookie => {
      // Format domain: ensure domain-level cookies have a leading dot, host-only do not
      let domain = cookie.domain;
      if (domain && !domain.startsWith('.') && domain !== 'localhost') {
        domain = `.${domain}`;
      }
      
      const details = {
        url: 'https://secure.quikchex.in',
        name: cookie.name,
        value: cookie.value,
        domain: domain,
        path: cookie.path || '/',
        secure: cookie.secure ?? true,
        httpOnly: cookie.httpOnly ?? true,
        sameSite: 'lax'
      };

      return new Promise((resolve, reject) => {
        chrome.cookies.set(details, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!result) {
            reject(new Error(`Failed to set cookie ${cookie.name}`));
          } else {
            resolve(result);
          }
        });
      });
    });

    Promise.all(promises)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error syncing cookies:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  }
});
