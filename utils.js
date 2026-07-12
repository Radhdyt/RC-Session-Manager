const ECOSYSTEM_MAP = {
  "group_hoyoverse": ["hoyolab.com", "hoyoverse.com", "mihoyo.com", "zenless.hoyoverse.com"],
  "group_google": ["google.com", "youtube.com"],
  "group_meta": ["facebook.com", "messenger.com"]
};

const MULTI_PART_TLDS = [
  'co.uk', 'org.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'com.au',
  'com.br', 'org.br', 'net.br',
  'com.cn', 'net.cn', 'org.cn',
  'com.tw', 'net.tw', 'org.tw',
  'co.jp', 'ne.jp', 'or.jp',
  'co.kr', 'ne.kr', 'or.kr',
  'com.mx', 'net.mx',
  'com.sg', 'net.sg',
  'com.hk', 'net.hk',
  'co.nz', 'net.nz', 'org.nz',
  'com.sa', 'com.ar', 'com.cl', 'com.co',
  'com.tr', 'net.tr', 'org.tr',
  'com.ru', 'net.ru', 'org.ru',
  'com.ua', 'com.vn', 'com.ph',
  'com.my', 'net.my', 'com.pk', 'com.bd',
  'com.eg', 'com.gh', 'co.za', 'com.ng',
  'com.pe', 'com.ec', 'com.ve',
  'com.py', 'com.bo', 'com.gt',
];

function getBaseDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_TLDS.includes(lastTwo)) {
      return parts.length >= 3 ? parts.slice(-3).join('.') : hostname;
    }
    return lastTwo;
  } catch (e) { return null; }
}

function getEcosystemId(domain) {
  for (const [groupId, domains] of Object.entries(ECOSYSTEM_MAP)) {
    if (domains.includes(domain)) return groupId;
  }
  return `domain_${domain}`;
}

function getDomainsForEcosystem(ecosystemId, originalDomain) {
  if (ECOSYSTEM_MAP[ecosystemId]) return ECOSYSTEM_MAP[ecosystemId];
  return [originalDomain];
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sortSessions(sessions, activeSessionName) {
  return [...sessions].sort((a, b) => {
    if (a.name === activeSessionName) return -1;
    if (b.name === activeSessionName) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ---- ENCRYPTION ----

async function getOrCreateCryptoKey() {
  const result = await chrome.storage.local.get('_ck');
  if (result._ck) {
    return await crypto.subtle.importKey(
      'jwk', result._ck,
      { name: 'AES-GCM', length: 256 },
      true, ['encrypt', 'decrypt']
    );
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('jwk', key);
  await chrome.storage.local.set({ _ck: exported });
  return key;
}

async function encryptString(value) {
  const key = await getOrCreateCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoded
  );
  return { iv: Array.from(iv), ct: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptString(obj) {
  const key = await getOrCreateCryptoKey();
  const iv = new Uint8Array(obj.iv);
  const ct = new Uint8Array(obj.ct);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, ct
  );
  return new TextDecoder().decode(decrypted);
}

async function encryptCookies(cookies) {
  return Promise.all(cookies.map(async c => {
    return { ...c, value: await encryptString(c.value) };
  }));
}

async function decryptCookies(cookies) {
  return Promise.all(cookies.map(async c => {
    if (c.value && typeof c.value === 'object' && c.value.iv && c.value.ct) {
      try {
        return { ...c, value: await decryptString(c.value) };
      } catch {
        return { ...c, value: '' };
      }
    }
    return c;
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ECOSYSTEM_MAP,
    MULTI_PART_TLDS,
    getBaseDomain,
    getEcosystemId,
    getDomainsForEcosystem,
    escapeHTML,
    sortSessions,
  };
}
