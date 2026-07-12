const {
  getBaseDomain,
  getEcosystemId,
  getDomainsForEcosystem,
  escapeHTML,
  sortSessions,
  ECOSYSTEM_MAP,
} = require('../utils.js');

describe('getBaseDomain', () => {
  test('extracts base domain from simple URL', () => {
    expect(getBaseDomain('https://www.google.com/search')).toBe('google.com');
  });

  test('extracts base domain from subdomain', () => {
    expect(getBaseDomain('https://accounts.google.com/auth')).toBe('google.com');
  });

  test('handles two-part domain', () => {
    expect(getBaseDomain('https://google.com')).toBe('google.com');
  });

  test('handles ccTLD .co.uk', () => {
    expect(getBaseDomain('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  });

  test('handles ccTLD .com.au', () => {
    expect(getBaseDomain('https://www.example.com.au/path')).toBe('example.com.au');
  });

  test('handles IP address', () => {
    expect(getBaseDomain('http://192.168.1.1/page')).toBe('192.168.1.1');
  });

  test('returns null for invalid URL', () => {
    expect(getBaseDomain('not-a-url')).toBeNull();
  });

  test('handles hoyoverse ecosystem domains', () => {
    expect(getBaseDomain('https://www.hoyolab.com/account')).toBe('hoyolab.com');
    expect(getBaseDomain('https://zenless.hoyoverse.com')).toBe('hoyoverse.com');
  });
});

describe('getEcosystemId', () => {
  test('returns group_hoyoverse for hoyolab.com', () => {
    expect(getEcosystemId('hoyolab.com')).toBe('group_hoyoverse');
  });

  test('returns group_google for google.com', () => {
    expect(getEcosystemId('google.com')).toBe('group_google');
  });

  test('returns group_google for youtube.com', () => {
    expect(getEcosystemId('youtube.com')).toBe('group_google');
  });

  test('returns group_meta for facebook.com', () => {
    expect(getEcosystemId('facebook.com')).toBe('group_meta');
  });

  test('returns domain_ prefix for unknown domain', () => {
    expect(getEcosystemId('example.com')).toBe('domain_example.com');
  });
});

describe('getDomainsForEcosystem', () => {
  test('returns ecosystem domains for known group', () => {
    const domains = getDomainsForEcosystem('group_hoyoverse', 'hoyolab.com');
    expect(domains).toEqual(ECOSYSTEM_MAP['group_hoyoverse']);
  });

  test('returns original domain for unknown ecosystem', () => {
    const domains = getDomainsForEcosystem('domain_example.com', 'example.com');
    expect(domains).toEqual(['example.com']);
  });
});

describe('escapeHTML', () => {
  test('escapes ampersand', () => {
    expect(escapeHTML('a&b')).toBe('a&amp;b');
  });

  test('escapes angle brackets', () => {
    expect(escapeHTML('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes double quotes', () => {
    expect(escapeHTML('a"b')).toBe('a&quot;b');
  });

  test('escapes single quotes', () => {
    expect(escapeHTML("a'b")).toBe('a&#39;b');
  });

  test('escapes multiple characters', () => {
    expect(escapeHTML('<img src="x" onerror="alert(1)">')).toBe(
      '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'
    );
  });

  test('returns empty string for empty input', () => {
    expect(escapeHTML('')).toBe('');
  });

  test('converts non-string to string', () => {
    expect(escapeHTML(123)).toBe('123');
  });
});

describe('sortSessions', () => {
  const sessions = [
    { name: 'Charlie' },
    { name: 'Alice' },
    { name: 'Bob' },
  ];

  test('sorts alphabetically when no active session', () => {
    const sorted = sortSessions(sessions, '');
    expect(sorted.map(s => s.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  test('puts active session first', () => {
    const sorted = sortSessions(sessions, 'Bob');
    expect(sorted.map(s => s.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  test('does not mutate original array', () => {
    const original = [...sessions];
    sortSessions(sessions, 'Alice');
    expect(sessions).toEqual(original);
  });

  test('handles empty array', () => {
    expect(sortSessions([], '')).toEqual([]);
  });
});
