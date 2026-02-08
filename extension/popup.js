import { buildThreadKey, normalizeUrl } from "./lib/url-normalize.js";

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";
const NOTIFY_ICON_URL = "https://www.google.com/favicon.ico";

const DEFAULT_SETTINGS = {
  language: "tr",
  darkMode: false,
  notifyNewMessages: true,
  notifyMentions: true
};

const I18N = {
  tr: {
    brand_sub: "Sayfa odası",
    active_page: "Aktif sayfa",
    signin_title: "Giriş yapın",
    signin_desc: "Bu sayfayı görüntüleyen diğer kullanıcılarla sohbet etmek için Google hesabınızla giriş yapın.",
    signin_google: "Google ile giriş yap",
    signed_out_badge: "Çıkış yapıldı",
    settings_title: "Ayarlar",
    nickname_label: "Nickname",
    nickname_placeholder: "Nickname girin",
    save_nickname: "Nickname Kaydet",
    notifications_group: "Bildirimler",
    new_messages: "Yeni mesajlar",
    mentions: "Bahsetmeler",
    appearance_group: "Görünüm",
    dark_mode: "Karanlık mod",
    language_group: "Dil",
    language_label: "Uygulama dili",
    logout: "Çıkış yap",
    footer_note: "Aynı URL'i görüntüleyen kişilerle sohbet edin",
    connected: "● Bağlı",
    reconnecting: "◐ Yeniden bağlanıyor",
    offline: "○ Çevrimdışı",
    signed_in_ok: "Giriş başarılı",
    signed_out_ok: "Çıkış yapıldı",
    nickname_updated: "Nickname güncellendi",
    ready: "Hazır",
    send_failed: "Mesaj gönderilemedi",
    signin_required: "Giriş gerekli",
    notify_new_title: "Yeni mesaj",
    notify_mention_title: "Bahsetme",
    me_label: "Sen",
    active_people: "{count} kişi aktif"
  },
  en: {
    brand_sub: "Page room",
    active_page: "Active page",
    signin_title: "Sign in",
    signin_desc: "Sign in with Google to chat with others viewing this page.",
    signin_google: "Sign in with Google",
    signed_out_badge: "Signed out",
    settings_title: "Settings",
    nickname_label: "Nickname",
    nickname_placeholder: "Enter nickname",
    save_nickname: "Save Nickname",
    notifications_group: "Notifications",
    new_messages: "New messages",
    mentions: "Mentions",
    appearance_group: "Appearance",
    dark_mode: "Dark mode",
    language_group: "Language",
    language_label: "App language",
    logout: "Logout",
    footer_note: "Chat with people viewing the same URL",
    connected: "● Connected",
    reconnecting: "◐ Reconnecting",
    offline: "○ Offline",
    signed_in_ok: "Signed in",
    signed_out_ok: "Signed out",
    nickname_updated: "Nickname updated",
    ready: "Ready",
    send_failed: "Failed to send message",
    signin_required: "Sign in required",
    notify_new_title: "New message",
    notify_mention_title: "Mention",
    me_label: "You",
    active_people: "{count} active"
  }
};

const mainHeader = document.getElementById("mainHeader");
const connectionBadge = document.getElementById("connectionBadge");
const urlLabel = document.getElementById("urlLabel");
const statusEl = document.getElementById("status");

const signInView = document.getElementById("signInView");
const chatView = document.getElementById("chatView");
const settingsView = document.getElementById("settingsView");
const guestFooter = document.getElementById("guestFooter");

const verifyGoogleBtn = document.getElementById("verifyGoogleBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");

const userLabel = document.getElementById("userLabel");
const onlineBadge = document.getElementById("onlineBadge");
const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const avatarFallback = document.getElementById("avatarFallback");
const settingsName = document.getElementById("settingsName");
const settingsEmail = document.getElementById("settingsEmail");
const nickInput = document.getElementById("nickInput");
const saveNickBtn = document.getElementById("saveNickBtn");
const logoutBtn = document.getElementById("logoutBtn");

const notifyNewMessagesEl = document.getElementById("notifyNewMessages");
const notifyMentionsEl = document.getElementById("notifyMentions");
const darkModeToggleEl = document.getElementById("darkModeToggle");
const languageSelectEl = document.getElementById("languageSelect");

let threadKey = "";
let clientId = "";
let ws = null;
let authToken = "";
let currentUser = null;
let lastGoogleAccessToken = "";
let reconnectTimer = null;
let reconnectAttempts = 0;
let isSending = false;
let settingsOpen = false;
let appSettings = { ...DEFAULT_SETTINGS };

function t(key, vars = {}) {
  const lang = I18N[appSettings.language] || I18N.tr;
  let value = lang[key] || I18N.tr[key] || key;
  Object.entries(vars).forEach(([k, v]) => {
    value = value.replace(`{${k}}`, String(v));
  });
  return value;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function applyI18n() {
  document.documentElement.lang = appSettings.language;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  updateOnlineBadge(1);
}

function applyTheme() {
  document.body.classList.toggle("dark", Boolean(appSettings.darkMode));
}

function applySettingsToControls() {
  notifyNewMessagesEl.checked = Boolean(appSettings.notifyNewMessages);
  notifyMentionsEl.checked = Boolean(appSettings.notifyMentions);
  darkModeToggleEl.checked = Boolean(appSettings.darkMode);
  languageSelectEl.value = appSettings.language;
}

async function saveSettings() {
  await chrome.storage.local.set({ urlchatroom_settings: appSettings });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("urlchatroom_settings");
  appSettings = { ...DEFAULT_SETTINGS, ...(stored.urlchatroom_settings || {}) };
  applySettingsToControls();
  applyTheme();
  applyI18n();
}

function setConnectionState(state) {
  if (state === "connected") {
    connectionBadge.textContent = t("connected");
    connectionBadge.style.background = "#16a34a";
    connectionBadge.style.color = "#ffffff";
    return;
  }
  if (state === "reconnecting") {
    connectionBadge.textContent = t("reconnecting");
    connectionBadge.style.background = "#f59e0b";
    connectionBadge.style.color = "#ffffff";
    return;
  }
  connectionBadge.textContent = t("offline");
  connectionBadge.style.background = "var(--surface-soft-2)";
  connectionBadge.style.color = "var(--text)";
}

function getInitials(name) {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

function containsMention(text) {
  if (!currentUser?.display_name) {
    return false;
  }
  const escaped = currentUser.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionRegex = new RegExp(`\\b${escaped}\\b`, "i");
  return mentionRegex.test(text);
}

function maybeNotifyIncomingMessage(msg) {
  if (!currentUser || msg.client_id === currentUser.display_name) {
    return;
  }
  const isMention = containsMention(msg.content || "");
  if (isMention && !appSettings.notifyMentions) {
    return;
  }
  if (!isMention && !appSettings.notifyNewMessages) {
    return;
  }
  if (!chrome.notifications) {
    return;
  }
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: NOTIFY_ICON_URL,
      title: isMention ? t("notify_mention_title") : t("notify_new_title"),
      message: `${msg.client_id}: ${msg.content}`.slice(0, 180)
    }, () => {});
  } catch (_error) {
    // notification failures should not break chat rendering
  }
}

function renderMessage(msg) {
  const item = document.createElement("article");
  const isCurrentUser = currentUser && msg.client_id === currentUser.display_name;
  const isMention = !isCurrentUser && containsMention(msg.content || "");
  item.className = `message${isCurrentUser ? " me" : ""}${isMention ? " mention" : ""}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const sender = isCurrentUser ? t("me_label") : msg.client_id || "unknown";
  meta.textContent = `${sender} • ${new Date(msg.created_at).toLocaleTimeString(appSettings.language === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" })}`;

  const body = document.createElement("div");
  body.textContent = msg.content;

  item.append(meta, body);
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearMessages() {
  messagesEl.innerHTML = "";
}

function applyUser(user) {
  currentUser = user;
  if (!user) {
    userLabel.textContent = "";
    settingsName.textContent = "User";
    settingsEmail.textContent = "-";
    nickInput.value = "";
    avatarFallback.textContent = "U";
    return;
  }
  userLabel.textContent = user.display_name;
  settingsName.textContent = user.display_name;
  settingsEmail.textContent = user.email;
  nickInput.value = user.display_name;
  avatarFallback.textContent = getInitials(user.display_name);
}

function renderView() {
  const signedIn = Boolean(currentUser && authToken);
  const showingSettings = signedIn && settingsOpen;

  signInView.style.display = signedIn ? "none" : "flex";
  chatView.style.display = signedIn && !showingSettings ? "flex" : "none";
  settingsView.style.display = showingSettings ? "block" : "none";

  mainHeader.style.display = showingSettings ? "none" : "block";
  guestFooter.style.display = signedIn ? "none" : "block";
  openSettingsBtn.style.display = signedIn && !showingSettings ? "inline-block" : "none";
}

function setSendingState(sending) {
  isSending = sending;
  sendBtn.disabled = sending;
  input.disabled = sending;
  sendBtn.textContent = sending ? "..." : "➤";
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
  authToken = token;
  lastGoogleAccessToken = googleToken;
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
  await setStoredAuth(payload.access_token, accessToken);
  applyUser(payload.user);
  settingsOpen = false;
  renderView();
  setStatus(t("signed_in_ok"));
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
      maybeNotifyIncomingMessage(payload.data);
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
    throw new Error(errorBody.detail || t("send_failed"));
  }
}

async function updateNickname() {
  const displayName = nickInput.value.trim();
  if (displayName.length < 2) {
    throw new Error("Nickname must be at least 2 chars");
  }
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ display_name: displayName })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Nickname update failed");
  }
  applyUser(payload);
  setStatus(t("nickname_updated"));
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
      // Best effort.
    }
  }
}

async function logout() {
  // Clear Google cached token first, then wipe local auth storage.
  await clearCachedGoogleToken();
  await setStoredAuth("", "");
  applyUser(null);
  settingsOpen = false;
  renderView();
  setStatus(t("signed_out_ok"));
}

function updateOnlineBadge(count) {
  onlineBadge.textContent = `👥 ${t("active_people", { count })}`;
}

verifyGoogleBtn.addEventListener("click", async () => {
  try {
    await signInWithGoogle();
  } catch (error) {
    setStatus(error.message || "Google sign-in failed");
  }
});

openSettingsBtn.addEventListener("click", () => {
  settingsOpen = true;
  renderView();
});

closeSettingsBtn.addEventListener("click", () => {
  settingsOpen = false;
  renderView();
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

notifyNewMessagesEl.addEventListener("change", async () => {
  appSettings.notifyNewMessages = notifyNewMessagesEl.checked;
  await saveSettings();
});

notifyMentionsEl.addEventListener("change", async () => {
  appSettings.notifyMentions = notifyMentionsEl.checked;
  await saveSettings();
});

darkModeToggleEl.addEventListener("change", async () => {
  appSettings.darkMode = darkModeToggleEl.checked;
  applyTheme();
  await saveSettings();
});

languageSelectEl.addEventListener("change", async () => {
  appSettings.language = languageSelectEl.value === "en" ? "en" : "tr";
  applyI18n();
  setConnectionState(ws && ws.readyState === WebSocket.OPEN ? "connected" : "offline");
  await saveSettings();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSending || !currentUser) {
    return;
  }
  const content = input.value.trim();
  if (!content) {
    return;
  }
  setSendingState(true);
  try {
    await sendMessage(content);
    input.value = "";
  } catch (error) {
    setStatus(error.message || t("send_failed"));
  } finally {
    setSendingState(false);
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

(async function init() {
  try {
    setConnectionState("offline");
    setSendingState(false);
    settingsOpen = false;

    await loadSettings();

    const rawUrl = await getActiveTabUrl();
    threadKey = buildThreadKey(rawUrl);
    urlLabel.textContent = normalizeUrl(rawUrl);

    clientId = await ensureClientId();
    await getStoredAuth();
    const user = await fetchMe();
    applyUser(user);
    renderView();
    updateOnlineBadge(user ? 1 : 0);

    await loadMessages();
    connectWebSocket();

    if (user) {
      setStatus(t("ready"));
    } else {
      setStatus(t("signin_required"));
    }
  } catch (error) {
    setStatus(error.message || "Initialization failed");
  }
})();
