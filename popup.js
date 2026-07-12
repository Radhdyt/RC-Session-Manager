let activeUrl = "";
let activeTabId = null;
let currentEcosystemId = null;

chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  if (!tabs || tabs.length === 0) return;
  activeUrl = tabs[0].url;
  activeTabId = tabs[0].id;
  const domain = getBaseDomain(activeUrl);
  if(!domain) {
    document.getElementById('currentDomain').innerText = "UNSUPPORTED URL";
    return;
  }
  
  currentEcosystemId = getEcosystemId(domain);
  let title = domain.toUpperCase();
  if(currentEcosystemId === "group_hoyoverse") title = "HOYOVERSE ECOSYSTEM";
  if(currentEcosystemId === "group_google") title = "GOOGLE ECOSYSTEM";
  if(currentEcosystemId === "group_meta") title = "META ECOSYSTEM";
  
  document.getElementById('currentDomain').innerText = title;
  
  renderSessions(currentEcosystemId);
});

function renderSessions(ecosystemId) {
  chrome.storage.local.get(ecosystemId, function(result) {
    const listDiv = document.getElementById('sessionList');
    listDiv.innerHTML = "";
    
    if(result[ecosystemId] && result[ecosystemId].sessions.length > 0) {
      const activeSessionName = result[ecosystemId].activeSessionName || "";
      const sortedSessions = sortSessions(result[ecosystemId].sessions, activeSessionName);

      sortedSessions.forEach(session => {
        const isActive = session.name === activeSessionName;
        
        let optionsHTML = `<option value="ALL">ALL COOKIES (name=value)</option>`;
        session.cookies.forEach(c => {
           optionsHTML += `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`;
        });

        let div = document.createElement('div');
        div.className = 'session-item glass-panel' + (isActive ? ' active' : '');
        div.innerHTML = `
          <div class="session-info">
            <span class="session-name" title="${escapeHTML(session.name)}">${escapeHTML(session.name)}</span>
            ${isActive ? '<span class="active-badge">ACTIVE</span>' : ''}
          </div>
          <div class="action-btns">
            ${!isActive ? `<button class="icon-btn load-btn" data-name="${escapeHTML(session.name)}" title="Switch to this account">
              <svg viewBox="0 0 24 24"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </button>` : ''}
            <button class="icon-btn export-btn" data-name="${escapeHTML(session.name)}" title="Copy cookies to clipboard">
              <svg viewBox="0 0 24 24" class="copy-icon"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            </button>
            <button class="icon-btn del-btn" data-name="${escapeHTML(session.name)}" title="Delete this session">
              <svg viewBox="0 0 24 24"><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4zM6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"/></svg>
            </button>
          </div>
          <div class="confirm-del-btns" style="display:none; gap:6px; align-items:center;">
            <span style="font-size:10px; color:#f87171; font-weight:700; letter-spacing:0.5px; margin-right:4px;">DELETE?</span>
            <button class="icon-btn confirm-yes yes-btn" data-name="${escapeHTML(session.name)}" title="Yes, delete!">
              <svg viewBox="0 0 24 24" fill="#f87171"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </button>
            <button class="icon-btn confirm-no no-btn" title="Cancel">
              <svg viewBox="0 0 24 24" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="copy-options-btns" style="display:none; gap:6px; align-items:center;">
            <select class="glass-select cookie-selector">
              ${optionsHTML}
            </select>
            <button class="badge-btn do-copy-btn" data-name="${escapeHTML(session.name)}">COPY</button>
            <button class="icon-btn confirm-no no-copy-btn" title="Cancel">
              <svg viewBox="0 0 24 24" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
        listDiv.appendChild(div);
      });
    } else {
      listDiv.innerHTML = "<div class='empty-state'>No sessions saved yet. Login and click CREATE.</div>";
    }
  });
}

// ---- EVENT DELEGATION ----

document.getElementById('sessionList').addEventListener('click', function(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const parentItem = btn.closest('.session-item');

  if (btn.classList.contains('load-btn')) {
    const name = btn.getAttribute('data-name');
    chrome.runtime.sendMessage({action: "loadSession", sessionName: name, currentUrl: activeUrl, tabId: activeTabId}, function() {
      window.close();
    });
  }

  if (btn.classList.contains('export-btn')) {
    parentItem.querySelector('.action-btns').style.display = 'none';
    parentItem.querySelector('.copy-options-btns').style.display = 'flex';
  }

  if (btn.classList.contains('no-copy-btn')) {
    parentItem.querySelector('.copy-options-btns').style.display = 'none';
    parentItem.querySelector('.action-btns').style.display = 'flex';
  }

  if (btn.classList.contains('do-copy-btn')) {
    const name = btn.getAttribute('data-name');
    const selectEl = parentItem.querySelector('.cookie-selector');
    const selectedKey = selectEl.value;

    chrome.storage.local.get(currentEcosystemId, async function(result) {
      const session = result[currentEcosystemId].sessions.find(s => s.name === name);
      if (!session) return;

      const decrypted = await decryptCookies(session.cookies);
      let cookieString = "";
      if (selectedKey === 'ALL') {
        let cookiesToCopy = decrypted;
        if (currentEcosystemId === "group_hoyoverse") {
          const hoyoAuthKeys = ['ltoken', 'ltuid', 'cookie_token', 'account_id', 'ltoken_v2', 'ltuid_v2', 'cookie_token_v2', 'account_id_v2', 'account_mid_v2', 'mihoyo_token'];
          cookiesToCopy = decrypted.filter(c => hoyoAuthKeys.includes(c.name));
        }
        if (cookiesToCopy.length === 0) cookiesToCopy = decrypted;
        cookieString = cookiesToCopy.map(c => `${c.name}=${c.value}`).join('; ');
      } else {
        const target = decrypted.find(c => c.name === selectedKey);
        if (target) cookieString = target.value;
      }

      if (!cookieString) {
        alert("Cookie value not found!");
        return;
      }

      navigator.clipboard.writeText(cookieString).then(() => {
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        btn.style.background = "rgba(16, 185, 129, 0.4)";
        btn.style.color = "#fff";
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.background = "";
          btn.style.color = "";
          parentItem.querySelector('.copy-options-btns').style.display = 'none';
          parentItem.querySelector('.action-btns').style.display = 'flex';
        }, 1000);
      }).catch(() => {
        alert("Failed to copy to clipboard!");
      });
    });
  }

  if (btn.classList.contains('del-btn')) {
    parentItem.querySelector('.action-btns').style.display = 'none';
    parentItem.querySelector('.confirm-del-btns').style.display = 'flex';
  }

  if (btn.classList.contains('no-btn')) {
    parentItem.querySelector('.confirm-del-btns').style.display = 'none';
    parentItem.querySelector('.action-btns').style.display = 'flex';
  }

  if (btn.classList.contains('yes-btn')) {
    const name = btn.getAttribute('data-name');
    chrome.runtime.sendMessage({action: "deleteSession", sessionName: name, currentUrl: activeUrl}, function() {
      renderSessions(currentEcosystemId);
    });
  }
});

// ---- SAVE ----

document.getElementById('saveBtn').addEventListener('click', () => {
  const name = document.getElementById('sessionName').value.trim();
  if(!name) { alert("Enter a session name first!"); return; }
  if(name.length > 50) { alert("Session name must be 50 characters or less."); return; }
  if(!/^[a-zA-Z0-9 _\-\.]+$/.test(name)) { alert("Session name may only contain letters, numbers, spaces, - _ ."); return; }

  chrome.storage.local.get(currentEcosystemId, function(result) {
    const sessions = (result[currentEcosystemId] && result[currentEcosystemId].sessions) || [];
    if(sessions.some(s => s.name === name)) {
      alert("Session name already exists.");
      return;
    }

    chrome.runtime.sendMessage({action: "saveSession", sessionName: name, currentUrl: activeUrl, tabId: activeTabId}, function(response) {
      if(response && response.success) {
        document.getElementById('sessionName').value = "";
        renderSessions(currentEcosystemId);
      }
    });
  });
});

// ---- SEARCH ----

document.getElementById('searchSession').addEventListener('input', function(e) {
  const searchTerm = e.target.value.toLowerCase();
  const items = document.querySelectorAll('.session-item');
  items.forEach(item => {
    const sessionName = item.querySelector('.session-name').innerText.toLowerCase();
    item.style.display = sessionName.includes(searchTerm) ? 'flex' : 'none';
  });
});

// ---- CLEAR DATA ----

document.getElementById('clearDataBtn').addEventListener('click', () => {
  document.getElementById('clearDataBtn').style.display = 'none';
  document.getElementById('confirmClearData').style.display = 'flex';
});

document.getElementById('noClearBtn').addEventListener('click', () => {
  document.getElementById('confirmClearData').style.display = 'none';
  document.getElementById('clearDataBtn').style.display = 'flex';
});

document.getElementById('yesClearBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({action: "clearLocalData", currentUrl: activeUrl, tabId: activeTabId}, function() {
    window.close();
  });
});
