import { buildThreadKey, normalizeUrl } from "./lib/url-normalize.js";

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

const urlLabel = document.getElementById("urlLabel");
const userLabel = document.getElementById("userLabel");
const statusEl = document.getElementById("status");
const connectionBadge = document.getElementById("connectionBadge");
const authPanel = document.getElementById("authPanel");
const chatPanel = document.getElementById("chatPanel");
const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const verifyGoogleBtn = document.getElementById("verifyGoogleBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const settingsDrawer = document.getElementById("settingsDrawer");
const settingsEmail = document.getElementById("settingsEmail");
const nickInput = document.getElementById("nickInput");
const saveNickBtn = document.getElementById("saveNickBtn");
const logoutBtn = document.getElementById("logoutBtn");

let threadKey = "";
let clientId = "";
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let authToken = "";
let currentUser = null;
let lastGoogleAccessToken = "";
let sending = false;

function setStatus(message) {
  statusEl.textContent = message;
}

function setConnectionState(state) {
  if (state === "connected") {
    connectionBadge.textContent = "Connected";
    connectionBadge.style.background = "#1f7a3a";
    return;
  }
  if (state === "reconnecting") {
    connectionBadge.textContent = "Reconnecting";
    connectionBadge.style.background = "#946200";
    return;
  }
  connectionBadge.textContent = "Offline";
  connectionBadge.style.background = "#9f2d2d";
}

function setSendingState(isSending) {
  sending = isSending;
  sendBtn.disabled = isSending;
  input.disabled = isSending;
  sendBtn.textContent = isSending ? "Sending..." : "Send";
}

function setAuthUi(isAuthed) {
  authPanel.style.display = isAuthed ? "none" : "block";
  chatPanel.style.display = isAuthed ? "block" : "none";
  openSettingsBtn.style.display = isAuthed ? "inline-block" : "none";
  if (!isAuthed) {
    settingsDrawer.style.display = "none";
    userLabel.textContent = "Not signed in";
    setStatus("Sign in required");
  }
}

function renderMessage(msg) {
  const item = document.createElement("article");
  item.className = "message";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${msg.client_id || "unknown"} • ${new Date(msg.created_at).toLocaleString()}`;

  const body = document.createElement("div");
  body.textContent = msg.content;

  item.append(meta, body);
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearMessages() {
  messagesEl.innerHTML = "";
}

async function getStoredAuth() {
  const stored = await chrome.storage.local.get([
    "urlchatroom_auth_token",
    "urlchatroom_google_access_token"
  ]);
  authToken = stored.urlchatroom_auth_token || "";
  lastGoogleAccessToken = stored.urlchatroom_google_access_token || "";
}

async function setStoredAuth(token, googleToken = "") {
  await chrome.storage.local.set({
    urlchatroom_auth_token: token,
    urlchatroom_google_access_token: googleToken
  });
}

function authHeaders() {
  if (!authToken) {
    return {};
  }
  return { Authorization: `Bearer ${authToken}` };
}

async function ensureClientId() {
  const stored = await chrome.storage.local.get("urlchatroom_client_id");
  if (stored.urlchatroom_client_id) {
    return stored.urlchatroom_client_id;
  }
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ urlchatroom_client_id: id });
  return id;
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (!active || !active.url) {
    throw new Error("No active tab URL");
  }
  return active.url;
}

async function fetchMe() {
  if (!authToken) {
    return null;
  }
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function applyUser(user) {
  currentUser = user;
  if (!user) {
    settingsEmail.textContent = "";
    nickInput.value = "";
    setAuthUi(false);
    return;
  }
  userLabel.textContent = `Signed in as ${user.display_name}`;
  settingsEmail.textContent = user.email;
  nickInput.value = user.display_name;
  setAuthUi(true);
}

function getGoogleAccessTokenInteractive() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Google auth failed"));
        return;
      }
      if (!token) {
        reject(new Error("Google auth returned no token"));
        return;
      }
      resolve(token);
    });
  });
}

async function signInWithGoogle() {
  if (chrome.identity?.clearAllCachedAuthTokens) {
    await chrome.identity.clearAllCachedAuthTokens();
  }

  const accessToken = await getGoogleAccessTokenInteractive();
  const response = await fetch(`${API_BASE}/api/auth/google/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Google verification failed");
  }
  authToken = payload.access_token;
  lastGoogleAccessToken = accessToken;
  await setStoredAuth(authToken, accessToken);
  applyUser(payload.user);
  setStatus("Signed in");
}

async function clearCachedGoogleToken() {
  if (lastGoogleAccessToken && chrome.identity?.removeCachedAuthToken) {
    await new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token: lastGoogleAccessToken }, () => resolve());
    });
  }
  if (chrome.identity?.clearAllCachedAuthTokens) {
    await chrome.identity.clearAllCachedAuthTokens();
  }
  if (lastGoogleAccessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(lastGoogleAccessToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
    } catch (_error) {
      // best effort
    }
  }
  lastGoogleAccessToken = "";
}

async function logout() {
  authToken = "";
  currentUser = null;
  await setStoredAuth("", "");
  await clearCachedGoogleToken();
  applyUser(null);
  setStatus("Signed out");
}

async function updateNickname() {
  const displayName = nickInput.value.trim();
  if (displayName.length < 2) {
    throw new Error("Nickname must be at least 2 characters");
  }
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ display_name: displayName })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Failed to update nickname");
  }
  applyUser(payload);
  setStatus("Nickname updated");
}

async function loadMessages() {
  const encoded = encodeURIComponent(threadKey);
  const response = await fetch(`${API_BASE}/api/messages?thread_key=${encoded}&limit=100`);
  if (!response.ok) {
    throw new Error("Failed to load messages");
  }
  const data = await response.json();
  clearMessages();
  data.forEach(renderMessage);
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectAttempts += 1;
  setConnectionState("reconnecting");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, Math.min(3000 + reconnectAttempts * 1000, 10000));
}

function connectWebSocket() {
  if (!threadKey) {
    return;
  }
  if (ws) {
    ws.close();
    ws = null;
  }

  const wsThread = encodeURIComponent(threadKey);
  ws = new WebSocket(`${WS_BASE}/ws/${wsThread}?client_id=${encodeURIComponent(clientId)}`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    setConnectionState("connected");
  };

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "message") {
      renderMessage(payload.data);
    }
  };

  ws.onclose = () => {
    setConnectionState("offline");
    scheduleReconnect();
  };

  ws.onerror = () => {
    setConnectionState("offline");
  };
}

async function sendMessage(content) {
  const response = await fetch(`${API_BASE}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      thread_key: threadKey,
      client_id: currentUser.display_name,
      content
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.detail || "Failed to send message");
  }
}

verifyGoogleBtn.addEventListener("click", async () => {
  try {
    await signInWithGoogle();
  } catch (error) {
    setStatus(error.message || "Google sign-in failed");
  }
});

openSettingsBtn.addEventListener("click", () => {
  settingsDrawer.style.display = "flex";
});

closeSettingsBtn.addEventListener("click", () => {
  settingsDrawer.style.display = "none";
});

saveNickBtn.addEventListener("click", async () => {
  try {
    await updateNickname();
  } catch (error) {
    setStatus(error.message || "Nickname update failed");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await logout();
  } catch (error) {
    setStatus(error.message || "Logout failed");
  }
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !currentUser) {
    return;
  }
  const value = input.value.trim();
  if (!value) {
    return;
  }

  setSendingState(true);
  try {
    await sendMessage(value);
    input.value = "";
  } catch (error) {
    setStatus(error.message || "Send failed");
  } finally {
    setSendingState(false);
  }
});

(async function init() {
  try {
    setConnectionState("offline");
    setSendingState(false);
    const rawUrl = await getActiveTabUrl();
    const normalized = normalizeUrl(rawUrl);
    threadKey = buildThreadKey(rawUrl);
    clientId = await ensureClientId();
    await getStoredAuth();

    urlLabel.textContent = normalized;
    await loadMessages();
    connectWebSocket();

    const user = await fetchMe();
    if (user) {
      applyUser(user);
      setStatus("Ready");
    } else {
      await setStoredAuth("", "");
      applyUser(null);
    }
  } catch (error) {
    setStatus(error.message || "Initialization failed");
  }
})();
