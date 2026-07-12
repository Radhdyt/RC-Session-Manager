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

const STORAGE_LIMIT = 5 * 1024 * 1024;

async function saveEcosystem(ecosystemId, data) {
  const payload = JSON.stringify(data);
  if (payload.length > STORAGE_LIMIT) {
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

async function getAllCookiesForDomains(domains) {
  const seen = new Set();
  const allCookies = [];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain: domain });
    for (const cookie of cookies) {
      const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
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
  const allRemovals = [];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain: domain });
    for (const cookie of cookies) {
      allRemovals.push(
        chrome.cookies.remove({ url: buildCookieUrl(cookie), name: cookie.name })
          .catch(() => {})
      );
    }
  }
  await Promise.all(allRemovals);
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
    if (!cookie.hostOnly && cookie.expirationDate) newCookie.expirationDate = cookie.expirationDate;
    
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
    fresh[ecosystemId].activeSessionName = sessionName;
    return saveEcosystem(ecosystemId, fresh[ecosystemId]);
  });

  if (!saveResult.success) return saveResult;
  setCachedActiveSession(ecosystemId, sessionName);

  if (tabId) chrome.tabs.reload(tabId);

  return { success: true };
}

async function handleClearLocalData(currentUrl, tabId) {
  try {
    console.log("[SCM] clearLocalData called. URL:", currentUrl, "tabId:", tabId);
    const domain = getBaseDomain(currentUrl);
    if (!domain) { console.log("[SCM] No domain found!"); return { success: false }; }

    const ecosystemId = getEcosystemId(domain);
    const domainsToSync = getDomainsForEcosystem(ecosystemId, domain);
    console.log("[SCM] Ecosystem:", ecosystemId, "Domains:", domainsToSync);
    
    if (tabId) {
      await injectStorageToTab(tabId, { ls: "{}", ss: "{}" });
    }

    await clearCookiesForDomains(domainsToSync);
    await clearCookiesForUrl(currentUrl);

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

    if (tabId) chrome.tabs.reload(tabId);

    return { success: true };
  } catch (e) {
    console.log("[SCM] clearLocalData error:", e);
    return { success: false, error: e.message };
  }
}

// ---- BADGE UPDATER LOGIC ----

const activeSessionCache = new Map();

function setCachedActiveSession(ecosystemId, name) {
  activeSessionCache.set(ecosystemId, name);
}

async function updateBadge(tabId, url) {
  if (!url || url.startsWith('chrome://')) {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
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
    chrome.action.setBadgeText({ text: "\u2022", tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#111111", tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) updateBadge(tab.id, tab.url);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.url) {
    updateBadge(tabId, tab.url);
  }
});
