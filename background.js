importScripts('utils.js');

// ---- STORAGE MUTEX ----

const storageQueues = new Map();

function withStorageLock(ecosystemId, fn) {
  const prev = storageQueues.get(ecosystemId) || Promise.resolve();
  const next = prev.then(fn, fn);
  storageQueues.set(ecosystemId, next);
  return next;
}

// ---- STORAGE HELPERS ----

const STORAGE_LIMIT = 8 * 1024 * 1024; // chrome.storage.local quota is 10MB; leave headroom

async function saveEcosystem(ecosystemId, data) {
  const payload = JSON.stringify(data);
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > STORAGE_LIMIT) {
    return { success: false, error: "Storage limit exceeded" };
  }
  try {
    await chrome.storage.local.set({ [ecosystemId]: data });
    return { success: true };
  } catch (e) {
    console.error("saveEcosystem failed");
    return { success: false, error: e.message };
  }
}

// ---- DOM STORAGE SCRIPTING ----

function extractDOMStorageScript() {
  return {
    ls: JSON.stringify(window.localStorage),
    ss: JSON.stringify(window.sessionStorage)
  };
}

function injectDOMStorageScript(storageData) {
  window.localStorage.clear();
  window.sessionStorage.clear();
  
  if (storageData.ls) {
    const ls = JSON.parse(storageData.ls);
    for (let key in ls) { window.localStorage.setItem(key, ls[key]); }
  }
  if (storageData.ss) {
    const ss = JSON.parse(storageData.ss);
    for (let key in ss) { window.sessionStorage.setItem(key, ss[key]); }
  }
}

async function injectStorageToTab(tabId, storageData) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectDOMStorageScript,
      args: [storageData]
    });
  } catch (e) {
    console.error("Scripting injection failed");
  }
}

async function extractStorageFromTab(tabId) {
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractDOMStorageScript
    });
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
      return injectionResults[0].result;
    }
  } catch (e) {
    console.error("Scripting extraction failed");
  }
  return { ls: "{}", ss: "{}" };
}

// ---- COOKIE OPERATIONS ----

function cookieKey(cookie) {
  const part = cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '';
  return `${cookie.name}|${cookie.domain}|${cookie.path}|${part}`;
}

// {domain} matches the domain AND every subdomain, over both schemes, in one
// call. Querying by {url} misses host-only cookies on subdomains entirely.
async function getAllCookiesForDomains(domains) {
  const seen = new Set();
  const allCookies = [];
  for (const domain of domains) {
    let cookies = [];
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (e) {
      console.error(`cookie query failed for ${domain}`, e);
      continue;
    }
    for (const cookie of cookies) {
      const key = cookieKey(cookie);
      if (!seen.has(key)) {
        seen.add(key);
        allCookies.push(cookie);
      }
    }
  }
  return allCookies;
}

function buildCookieUrl(cookie) {
  return (cookie.secure ? "https://" : "http://") +
    cookie.domain.replace(/^\./, '') + cookie.path;
}

async function clearCookiesForDomains(domains) {
  const cookies = await getAllCookiesForDomains(domains);
  await Promise.all(cookies.map(cookie =>
    chrome.cookies.remove({
      url: buildCookieUrl(cookie),
      name: cookie.name,
      storeId: cookie.storeId,
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {})
    }).catch(() => {})
  ));
}

// A tab can close between the popup click and the reload. chrome.tabs.reload
// then rejects with "No tab with id: N", which surfaces on chrome://extensions
// as an uncaught error. Nothing to recover from, so swallow it.
async function safeReload(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.get(tabId);
    await chrome.tabs.reload(tabId);
  } catch (e) {
    // tab gone — the session is already written, nothing left to do
  }
}

async function clearCookiesForUrl(url) {
  const cookies = await chrome.cookies.getAll({ url });
  const allRemovals = cookies.map(cookie =>
    chrome.cookies.remove({ url: buildCookieUrl(cookie), name: cookie.name })
      .catch(() => {})
  );
  await Promise.all(allRemovals);
}

async function restoreCookies(cookies) {
  const allSets = [];
  for (const cookie of cookies) {
    let newCookie = {
      url: buildCookieUrl(cookie),
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      storeId: cookie.storeId
    };
    if (!cookie.hostOnly) newCookie.domain = cookie.domain;
    // Host-only cookies can still carry an expiry; dropping it silently turns
    // a persistent login into a session cookie that dies with the browser.
    if (cookie.expirationDate) newCookie.expirationDate = cookie.expirationDate;
    if (cookie.partitionKey) newCookie.partitionKey = cookie.partitionKey;

    allSets.push(
      chrome.cookies.set(newCookie)
        .catch(() => {})
    );
  }
  await Promise.all(allSets);
}

// ---- MESSAGE ROUTER ----

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "saveSession") {
    handleSaveSession(request.sessionName, request.currentUrl, request.tabId).then(sendResponse);
    return true;
  } else if (request.action === "loadSession") {
    handleLoadSession(request.sessionName, request.currentUrl, request.tabId).then(sendResponse);
    return true;
  } else if (request.action === "deleteSession") {
    handleDeleteSession(request.sessionName, request.currentUrl).then(sendResponse);
    return true;
  } else if (request.action === "clearLocalData") {
    handleClearLocalData(request.currentUrl, request.tabId).then(sendResponse);
    return true;
  }
});

// ---- HANDLERS ----

async function handleDeleteSession(sessionName, currentUrl) {
  const domain = getBaseDomain(currentUrl);
  if (!domain) return { success: false };
  const ecosystemId = getEcosystemId(domain);
  
  return withStorageLock(ecosystemId, async () => {
    const result = await chrome.storage.local.get(ecosystemId);
    if (!result[ecosystemId]) return { success: false };
    
    result[ecosystemId].sessions = result[ecosystemId].sessions.filter(s => s.name !== sessionName);
    
    return saveEcosystem(ecosystemId, result[ecosystemId]);
  });
}

async function handleSaveSession(sessionName, currentUrl, tabId) {
  const domain = getBaseDomain(currentUrl);
  if (!domain) return { success: false, error: "Invalid URL" };

  const ecosystemId = getEcosystemId(domain);
  const domainsToSync = getDomainsForEcosystem(ecosystemId, domain);
  
  const cookies = await getAllCookiesForDomains(domainsToSync);
  const encryptedCookies = await encryptCookies(cookies);
  const domStorage = tabId ? await extractStorageFromTab(tabId) : { ls: "{}", ss: "{}" };
  
  return withStorageLock(ecosystemId, async () => {
    const result = await chrome.storage.local.get(ecosystemId);
    let ecosystemData = result[ecosystemId] || { domains: domainsToSync, sessions: [] };
    
    ecosystemData.sessions = ecosystemData.sessions.filter(s => s.name !== sessionName);
    ecosystemData.sessions.push({ name: sessionName, cookies: encryptedCookies, domStorage: domStorage });
    ecosystemData.activeSessionName = sessionName;
    
    return saveEcosystem(ecosystemId, ecosystemData);
  });
}

async function handleLoadSession(sessionName, currentUrl, tabId) {
  const domain = getBaseDomain(currentUrl);
  if (!domain) return { success: false, error: "Invalid URL" };

  const ecosystemId = getEcosystemId(domain);
  const domainsToSync = getDomainsForEcosystem(ecosystemId, domain);
  
  const result = await chrome.storage.local.get(ecosystemId);
  if (!result[ecosystemId]) return { success: false, error: "Ecosystem not found" };
  
  const session = result[ecosystemId].sessions.find(s => s.name === sessionName);
  if (!session) return { success: false, error: "Session not found" };

  if (tabId && session.domStorage) {
    await injectStorageToTab(tabId, session.domStorage);
  }

  const decryptedCookies = await decryptCookies(session.cookies);
  await clearCookiesForDomains(domainsToSync);
  await restoreCookies(decryptedCookies);

  const saveResult = await withStorageLock(ecosystemId, async () => {
    const fresh = await chrome.storage.local.get(ecosystemId);
    if (!fresh[ecosystemId]) return { success: false, error: "Ecosystem vanished" };
    fresh[ecosystemId].activeSessionName = sessionName;
    return saveEcosystem(ecosystemId, fresh[ecosystemId]);
  });

  if (!saveResult.success) return saveResult;
  setCachedActiveSession(ecosystemId, sessionName);

  await safeReload(tabId);

  return { success: true };
}

async function handleClearLocalData(currentUrl, tabId) {
  try {
    const domain = getBaseDomain(currentUrl);
    if (!domain) return { success: false };

    const ecosystemId = getEcosystemId(domain);
    const domainsToSync = getDomainsForEcosystem(ecosystemId, domain);

    if (tabId) {
      await injectStorageToTab(tabId, { ls: "{}", ss: "{}" });
    }

    // Same query path as load: {domain} covers subdomains and both schemes.
    await clearCookiesForDomains(domainsToSync);

    const saveResult = await withStorageLock(ecosystemId, async () => {
      const result = await chrome.storage.local.get(ecosystemId);
      if (result[ecosystemId]) {
        result[ecosystemId].activeSessionName = "";
        return saveEcosystem(ecosystemId, result[ecosystemId]);
      }
      return { success: true };
    });

    if (!saveResult.success) return saveResult;
    setCachedActiveSession(ecosystemId, "");

    await safeReload(tabId);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---- BADGE UPDATER LOGIC ----

const activeSessionCache = new Map();

function setCachedActiveSession(ecosystemId, name) {
  activeSessionCache.set(ecosystemId, name);
}

// chrome.action.* rejects with "No tab with id: N" the moment the tab closes,
// and updateBadge runs from tab events that fire while tabs are going away.
// A badge is cosmetic; it never earns an entry on the errors page.
async function setBadgeSafe(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ text, tabId });
    if (color) await chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch (e) {
    // tab already gone
  }
}

async function updateBadge(tabId, url) {
  try {
    if (!url || url.startsWith('chrome://')) {
      await setBadgeSafe(tabId, "");
      return;
    }
    const domain = getBaseDomain(url);
    if (!domain) return;

    const ecosystemId = getEcosystemId(domain);

    let activeName = activeSessionCache.get(ecosystemId);
    if (activeName === undefined) {
      const result = await chrome.storage.local.get(ecosystemId);
      activeName = (result[ecosystemId] && result[ecosystemId].activeSessionName) || "";
      activeSessionCache.set(ecosystemId, activeName);
    }

    if (activeName) {
      await setBadgeSafe(tabId, "\u2022", "#111111");
    } else {
      await setBadgeSafe(tabId, "");
    }
  } catch (e) {
    // storage or tab lookup failed mid-flight — badge just stays as it was
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) await updateBadge(tab.id, tab.url);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.url) {
    updateBadge(tabId, tab.url).catch(() => {});
  }
});
