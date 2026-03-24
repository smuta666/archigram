const state = {
  me: null,
  users: [],
  chats: [],
  currentChat: null,
  currentMessages: [],
  onlineUserIds: new Set(),
  ws: null,
  typingTimer: null,
  typingVisibleTimer: null,
  swRegistration: null,
  pushPermission: 'default',
  mediaRecorder: null,
  voiceChunks: [],
  voiceBlob: null,
  isRecording: false
};

const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const mobileBackBtn = document.getElementById('mobile-back-btn');
const authError = document.getElementById('auth-error');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabs = [...document.querySelectorAll('.tab')];
const logoutBtn = document.getElementById('logout-btn');
const meName = document.getElementById('me-name');
const meAvatar = document.getElementById('me-avatar');
const usersList = document.getElementById('users-list');
const usersToggle = document.getElementById('users-toggle');
const chatsToggle = document.getElementById('chats-toggle');
const chatsList = document.getElementById('chats-list');
const emptyState = document.getElementById('empty-state');
const chatArea = document.getElementById('chat-area');
const chatTitle = document.getElementById('chat-title');
const chatAvatar = document.getElementById('chat-avatar');
const chatStatus = document.getElementById('chat-status');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const imageInput = document.getElementById('image-input');
const selectedFile = document.getElementById('selected-file');
const typingIndicator = document.getElementById('typing-indicator');
//const recordVoiceBtn = document.getElementById('record-voice-btn');
//const stopVoiceBtn = document.getElementById('stop-voice-btn');
//const voiceStatus = document.getElementById('voice-status');
//const voiceStatusText = document.getElementById('voice-status-text');
//const clearVoiceBtn = document.getElementById('clear-voice-btn');
const imageViewer = document.getElementById('image-viewer');
const imageViewerBackdrop = document.getElementById('image-viewer-backdrop');
const imageViewerClose = document.getElementById('image-viewer-close');
const imageViewerImg = document.getElementById('image-viewer-img');
const openProfileBtn = document.getElementById('open-profile-btn');
const profileModal = document.getElementById('profile-modal');
const profileBackdrop = document.getElementById('profile-backdrop');
const closeProfileBtn = document.getElementById('close-profile-btn');
const profileForm = document.getElementById('profile-form');
const profileDisplayName = document.getElementById('profile-display-name');
const profileBio = document.getElementById('profile-bio');
const profileAvatarPreview = document.getElementById('profile-avatar-preview');
const profileAvatarInput = document.getElementById('profile-avatar-input');
const profileUsernameRow = document.getElementById('profile-username-row');
const profileCreatedAt = document.getElementById('profile-created-at');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileAvatarUploadLabel = document.getElementById('profile-avatar-upload-label');

const enablePushBtn = document.getElementById('enable-push-btn');

function avatarOrFallback(url) {
  return url || 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="100%" height="100%" fill="#1f2937"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-size="24">👤</text>
    </svg>
  `);
}

function showAuthError(text) {
  authError.textContent = text;
  authError.classList.remove('hidden');
}

function hideAuthError() {
  authError.classList.add('hidden');
  authError.textContent = '';
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function isMobileLayout() {
  return window.innerWidth <= 900;
}

function openChatOnMobile() {
  if (!isMobileLayout()) return;
  document.body.classList.add('mobile-chat-open');
}

function closeChatOnMobile() {
  document.body.classList.remove('mobile-chat-open');
}

function scrollMessagesToBottom(force = false) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!messagesEl) return;

      messagesEl.scrollTop = messagesEl.scrollHeight;

      if (force && typeof messagesEl.scrollTo === 'function') {
        messagesEl.scrollTo({
          top: messagesEl.scrollHeight,
          behavior: 'auto'
        });
      }
    });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function openImageViewer(src) {
  if (!imageViewer || !imageViewerImg) return;
  imageViewerImg.src = src;
  imageViewer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeImageViewer() {
  if (!imageViewer || !imageViewerImg) return;
  imageViewer.classList.add('hidden');
  imageViewerImg.src = '';
  document.body.style.overflow = '';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    console.log('API ERROR', response.status, data);
    throw new Error(
      (data && data.error) ||
      (typeof data === 'string' ? data : '') ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    state.swRegistration = registration;
    return registration;
  } catch (error) {
    console.error('SW registration failed', error);
    return null;
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'denied';
  const permission = await Notification.requestPermission();
  state.pushPermission = permission;
  return permission;
}

async function getPushPublicKey() {
  const data = await api('/api/push/public-key');
  return data.publicKey || '';
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!state.me) return;

  const registration = state.swRegistration || await navigator.serviceWorker.ready;
  if (!registration) return;

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') return;

  const vapidPublicKey = await getPushPublicKey();
  if (!vapidPublicKey) {
    console.warn('No VAPID public key configured');
    return;
  }

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
  }

  await api('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  });
}

function getChatIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('chat')) || null;
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Запись голоса не поддерживается на этом устройстве');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    state.voiceChunks = [];
    state.voiceBlob = null;

    const mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.voiceChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      state.voiceBlob = new Blob(state.voiceChunks, {
        type: mediaRecorder.mimeType || 'audio/webm'
      });

      stream.getTracks().forEach(track => track.stop());

      voiceStatusText.textContent = 'Голосовое записано, нажми "Отправить"';
      voiceStatus.classList.remove('hidden');
      state.isRecording = false;
      recordVoiceBtn.classList.remove('hidden');
      stopVoiceBtn.classList.add('hidden');
    };

    mediaRecorder.start();
    state.isRecording = true;

    voiceStatusText.textContent = 'Идёт запись...';
    voiceStatus.classList.remove('hidden');
    recordVoiceBtn.classList.add('hidden');
    stopVoiceBtn.classList.remove('hidden');
  } catch (error) {
    console.error('Voice record error', error);
    alert('Не удалось получить доступ к микрофону');
  }
}

function stopVoiceRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
  }
}

function resetVoiceRecording() {
  if (state.mediaRecorder && state.isRecording) {
    try {
      state.mediaRecorder.stop();
    } catch {}
  }

  state.mediaRecorder = null;
  state.voiceChunks = [];
  state.voiceBlob = null;
  state.voiceMimeType = '';
  state.isRecording = false;

  voiceStatusText.textContent = '';
  voiceStatus.classList.add('hidden');

  recordVoiceBtn.classList.remove('hidden');
  stopVoiceBtn.classList.add('hidden');
}

function switchTab(name) {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  loginForm.classList.toggle('hidden', name !== 'login');
  registerForm.classList.toggle('hidden', name !== 'register');
  hideAuthError();
}

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError();
  const formData = new FormData(loginForm);

  try {
    const data = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });

    await bootstrapAfterAuth(data.user);
  } catch (error) {
    showAuthError(error.message);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError();

  try {
    const formData = new FormData(registerForm);
    const data = await api('/api/register', {
      method: 'POST',
      body: formData
    });

    await bootstrapAfterAuth(data.user);
  } catch (error) {
    showAuthError(error.message);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } finally {
    if (state.ws) state.ws.close();
    location.reload();
  }
});

openProfileBtn?.addEventListener('click', () => {
  openProfileModal();
});

closeProfileBtn?.addEventListener('click', () => {
  closeProfileModal();
});

profileBackdrop?.addEventListener('click', () => {
  closeProfileModal();
});

mobileBackBtn?.addEventListener('click', () => {
  closeChatOnMobile();
});

enablePushBtn?.addEventListener('click', async () => {
  try {
    await registerServiceWorker();
    await subscribeToPush();
    enablePushBtn.textContent = 'Уведомления включены';
    enablePushBtn.disabled = true;
    alert('Уведомления включены');
  } catch (error) {
    console.error('Push enable failed', error);
    alert(error.message || 'Не удалось включить уведомления');
  }
});

imageViewerBackdrop?.addEventListener('click', closeImageViewer);
imageViewerClose?.addEventListener('click', closeImageViewer);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && imageViewer && !imageViewer.classList.contains('hidden')) {
    closeImageViewer();
  }
});

//recordVoiceBtn?.addEventListener('click', async () => {
  //await startVoiceRecording();
//});

//stopVoiceBtn?.addEventListener('click', () => {
  //stopVoiceRecording();
//});

//clearVoiceBtn?.addEventListener('click', () => {
  //resetVoiceRecording();
//});

window.addEventListener('resize', () => {
  if (!isMobileLayout()) {
    closeChatOnMobile();
  } else if (state.currentChat) {
    openChatOnMobile();
  }
});

profileForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const data = await api('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: profileDisplayName.value.trim(),
        bio: profileBio.value.trim()
      })
    });

    state.me = data.user;

    state.users = state.users.map(user =>
      user.id === state.me.id ? { ...user, ...data.user } : user
    );

    state.chats = state.chats.map(chat => {
      if (chat.partner.id === state.me.id) {
        return {
          ...chat,
          partner: { ...chat.partner, ...data.user }
        };
      }
      return chat;
    });

    renderMe();
    renderUsers();
    renderChats();

    if (state.currentChat?.partner?.id === state.me.id) {
      setCurrentChat({
        ...state.currentChat,
        partner: { ...state.currentChat.partner, ...data.user }
      });
    }

    closeProfileModal();
  } catch (error) {
    alert(error.message);
  }
});

function setScreen(isAuthenticated) {
  authScreen.classList.toggle('hidden', isAuthenticated);
  chatScreen.classList.toggle('hidden', !isAuthenticated);

  if (isAuthenticated) {
    closeChatOnMobile();
  }
}

function displayNameOf(user) {
  return user?.display_name || user?.username || '';
}

function renderMe() {
  meName.textContent = displayNameOf(state.me);
  meAvatar.src = avatarOrFallback(state.me.avatar_url);
}

function openUserProfileModal(user) {
  if (!user) return;

  const isMe = state.me && user.id === state.me.id;

  profileDisplayName.value = user.display_name || user.username || '';
  profileBio.value = user.bio || '';
  profileAvatarPreview.src = avatarOrFallback(user.avatar_url);

  profileUsernameRow.textContent = `@${user.username}`;
  profileUsernameRow.classList.remove('hidden');

  profileCreatedAt.textContent = user.created_at
    ? `В мессенджере с ${new Date(user.created_at).toLocaleDateString('ru-RU')}`
    : '';
  profileCreatedAt.classList.remove('hidden');

  profileDisplayName.disabled = !isMe;
  profileBio.disabled = !isMe;

  if (profileSaveBtn) profileSaveBtn.classList.toggle('hidden', !isMe);
  if (profileAvatarUploadLabel) profileAvatarUploadLabel.classList.toggle('hidden', !isMe);
  if (profileAvatarInput) profileAvatarInput.disabled = !isMe;

  profileModal.classList.remove('hidden');
}

function openProfileModal() {
  if (!state.me) return;
  openUserProfileModal(state.me);
}

function closeProfileModal() {
  profileModal.classList.add('hidden');
}

async function openOtherUserProfile(userId) {
  try {
    const data = await api(`/api/users/${userId}`);
    openUserProfileModal(data.user);
  } catch (error) {
    alert(error.message);
  }
}

function createListItem(user, rightNode, isOnline = false) {
  const div = document.createElement('button');
  div.className = 'list-item';
  div.type = 'button';

  div.innerHTML = `
    <div class="me-block list-item-main">
      <div class="avatar-wrapper">
        <img class="avatar" src="${avatarOrFallback(user.avatar_url)}" alt="avatar" />
        <span class="avatar-status ${isOnline ? 'online' : ''}"></span>
      </div>
      <div class="list-item-text">
        <div class="strong">${escapeHtml(displayNameOf(user))}</div>
      </div>
    </div>
  `;

  if (rightNode) div.appendChild(rightNode);
  return div;
}

function renderUsers() {
  usersList.innerHTML = '';

  for (const user of state.users) {
    const item = createListItem(user, null, state.onlineUserIds.has(user.id));
    item.dataset.userId = String(user.id);
    usersList.appendChild(item);
  }
}

function isDesktopVoiceUI() {
  return window.innerWidth > 900;
}

function renderChats() {
  chatsList.innerHTML = '';

  for (const chat of state.chats) {
    const right = document.createElement('div');
    right.className = 'preview-text muted small';
    right.title = chat.last_message
      ? (
          chat.last_message.type === 'image'
            ? '📷 Картинка'
            : chat.last_message.type === 'voice'
              ? '🎤 Голосовое сообщение'
              : chat.last_message.content
        )
      : 'Пустой чат';

    right.textContent = chat.last_message
      ? (
          chat.last_message.type === 'image'
            ? '📷 Картинка'
            : chat.last_message.type === 'voice'
              ? '🎤 Голосовое сообщение'
              : chat.last_message.content
        )
      : 'Пустой чат';

    const item = createListItem(
      chat.partner,
      right,
      state.onlineUserIds.has(chat.partner.id)
    );

    item.dataset.chatId = String(chat.id);
    item.classList.toggle('active', state.currentChat?.id === chat.id);
    chatsList.appendChild(item);
  }
}

function renderMessages() {
  messagesEl.innerHTML = '';

  for (const message of state.currentMessages) {
    const div = document.createElement('div');
    div.className = `message ${message.sender_id === state.me.id ? 'mine' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const metaText = document.createElement('span');
    metaText.textContent = `${message.sender_username} • ${formatTime(message.created_at)}`;
    meta.appendChild(metaText);

    if (message.sender_id === state.me.id) {
      const readMark = document.createElement('span');
      readMark.className = `read-mark ${message.read_at ? 'read' : ''}`;
      readMark.textContent = message.read_at ? '✓✓' : '✓';
      meta.appendChild(readMark);
    }

    div.appendChild(meta);

    if (message.type === 'text') {
      const text = document.createElement('div');
      text.className = 'message-text';
      text.textContent = message.content;
      div.appendChild(text);
    } else if (message.type === 'image') {
      const img = document.createElement('img');
      img.src = message.content;
      img.alt = 'image';
      img.addEventListener('load', () => scrollMessagesToBottom(true));
      img.addEventListener('click', () => openImageViewer(message.content));
      div.appendChild(img);
    } else if (message.type === 'voice') {
      if (!isDesktopVoiceUI()) {
        const audio = document.createElement('audio');
        audio.src = message.content;
        audio.controls = true;
        audio.preload = 'metadata';
        audio.className = 'voice-player';
        div.appendChild(audio);
      } else {
        const voiceWrapper = document.createElement('div');
        voiceWrapper.className = 'voice-message';

        const playBtn = document.createElement('button');
        playBtn.className = 'voice-play';
        playBtn.type = 'button';
        playBtn.textContent = '▶';

        const progressContainer = document.createElement('div');
        progressContainer.className = 'voice-progress';

        const progressBar = document.createElement('div');
        progressBar.className = 'voice-progress-bar';
        progressContainer.appendChild(progressBar);

        const timeLabel = document.createElement('div');
        timeLabel.className = 'voice-time';
        timeLabel.textContent = '0:00';

        const audio = document.createElement('audio');
        audio.src = message.content;
        audio.preload = 'metadata';
        audio.className = 'voice-audio-hidden';

        function formatAudioTime(seconds) {
          if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
          const mins = Math.floor(seconds / 60);
          const secs = Math.floor(seconds % 60);
          return `${mins}:${String(secs).padStart(2, '0')}`;
        }

        function updateDuration() {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            timeLabel.textContent = formatAudioTime(audio.duration);
          }
        }

        playBtn.addEventListener('click', async () => {
          try {
            if (audio.paused) {
              await audio.play();
            } else {
              audio.pause();
            }
          } catch (error) {
            console.error('voice play error', error);
          }
        });

        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('durationchange', updateDuration);
        audio.addEventListener('canplay', updateDuration);

        audio.addEventListener('play', () => {
          playBtn.textContent = '⏸';
        });

        audio.addEventListener('pause', () => {
          if (!audio.ended) {
            playBtn.textContent = '▶';
          }
        });

        audio.addEventListener('timeupdate', () => {
          if (audio.duration && Number.isFinite(audio.duration)) {
            const percent = (audio.currentTime / audio.duration) * 100;
            progressBar.style.width = `${percent}%`;
            timeLabel.textContent = formatAudioTime(audio.currentTime);
          }
        });

        audio.addEventListener('ended', () => {
          playBtn.textContent = '▶';
          progressBar.style.width = '0%';
          updateDuration();
        });

        progressContainer.addEventListener('click', (e) => {
          const rect = progressContainer.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;

          if (audio.duration && Number.isFinite(audio.duration)) {
            audio.currentTime = Math.max(0, Math.min(audio.duration, audio.duration * ratio));
          }
        });

        voiceWrapper.appendChild(playBtn);
        voiceWrapper.appendChild(progressContainer);
        voiceWrapper.appendChild(timeLabel);
        voiceWrapper.appendChild(audio);

        div.appendChild(voiceWrapper);
      }
    }

    messagesEl.appendChild(div);
  }

  scrollMessagesToBottom(true);
}

function setCurrentChat(chat) {
  state.currentChat = chat;
  emptyState.classList.add('hidden');
  chatArea.classList.remove('hidden');
  typingIndicator.classList.add('hidden');
  chatTitle.textContent = displayNameOf(chat.partner);
  chatAvatar.src = avatarOrFallback(chat.partner.avatar_url);
  chatStatus.textContent = state.onlineUserIds.has(chat.partner.id) ? 'В сети' : 'Не в сети';

  chatAvatar.style.cursor = 'pointer';
  chatTitle.style.cursor = 'pointer';
  chatAvatar.onclick = () => openOtherUserProfile(chat.partner.id);
  chatTitle.onclick = () => openOtherUserProfile(chat.partner.id);

  renderChats();
  scrollMessagesToBottom(true);
}

async function loadMessages(chatId) {
  const data = await api(`/api/chats/${chatId}/messages?limit=100`);
  state.currentMessages = data.messages;
  renderMessages();
  scrollMessagesToBottom(true);
}

async function markCurrentChatAsRead() {
  if (!state.currentChat) return;

  try {
    const data = await api(`/api/chats/${state.currentChat.id}/read`, {
      method: 'POST'
    });

    if (Array.isArray(data.messageIds) && data.messageIds.length) {
      state.currentMessages = state.currentMessages.map(message =>
        data.messageIds.includes(message.id)
          ? { ...message, read_at: data.readAt }
          : message
      );

      renderMessages();
    }
  } catch (error) {
    console.error('markCurrentChatAsRead error:', error);
  }
}

async function openChat(chatId) {
  const chat = state.chats.find(c => c.id === chatId);
  if (!chat) return;

  setCurrentChat(chat);
  openChatOnMobile();

  try {
    await loadMessages(chat.id);
    await markCurrentChatAsRead();
  } catch (error) {
    console.error('loadMessages error:', error);
  }
}

async function openOrCreateChat(userId) {
  const existing = state.chats.find(c => c.partner.id === userId);
  if (existing) {
    await openChat(existing.id);
    return;
  }

  try {
    const data = await api('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });

    state.chats.unshift({
      id: data.chat.id,
      partner: data.chat.partner,
      last_message: null
    });

    renderChats();
    await openChat(data.chat.id);
  } catch (error) {
    console.error('openOrCreateChat error:', error);
    alert(error.message);
  }
}

async function refreshSidebarData() {
  const [usersData, chatsData] = await Promise.all([
    api('/api/users'),
    api('/api/chats')
  ]);

  state.users = usersData.users;
  state.chats = chatsData.chats;
  renderUsers();
  renderChats();
}

function upsertChatPreview(message) {
  const chat = state.chats.find(c => c.id === message.chat_id);
  if (!chat) return;

  chat.last_message = {
    id: message.id,
    type: message.type,
    content: message.content,
    created_at: message.created_at
  };

  state.chats = [chat, ...state.chats.filter(c => c.id !== chat.id)];
  renderChats();
}

function handleIncomingMessage(message) {
  upsertChatPreview(message);

  if (state.currentChat?.id === message.chat_id) {
    state.currentMessages.push(message);
    renderMessages();
    scrollMessagesToBottom(true);
  }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'connected' || data.type === 'presence') {
      state.onlineUserIds = new Set(data.onlineUserIds || []);
      renderUsers();
      renderChats();

      if (state.currentChat) {
        chatStatus.textContent = state.onlineUserIds.has(state.currentChat.partner.id)
          ? 'В сети'
          : 'Не в сети';
      }
    }

    if (data.type === 'new_message') {
      handleIncomingMessage(data.message);
    }

    if (data.type === 'messages_read') {
      state.currentMessages = state.currentMessages.map(message =>
        data.messageIds.includes(message.id)
          ? { ...message, read_at: data.readAt }
          : message
      );

      renderMessages();
    }

    if (data.type === 'typing' && state.currentChat?.id === data.chatId) {
      typingIndicator.classList.remove('hidden');
      clearTimeout(state.typingVisibleTimer);
      state.typingVisibleTimer = setTimeout(() => {
        typingIndicator.classList.add('hidden');
      }, 1500);
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(() => {
      if (state.me) connectWebSocket();
    }, 1500);
  });
}

usersList?.addEventListener('click', (e) => {
  const item = e.target.closest('.list-item');
  if (!item || !usersList.contains(item)) return;

  const userId = Number(item.dataset.userId);
  if (!userId) return;

  openOrCreateChat(userId);
});

usersList?.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.list-item');
  if (!item || !usersList.contains(item)) return;

  e.preventDefault();
  const userId = Number(item.dataset.userId);
  if (!userId) return;

  openOtherUserProfile(userId);
});

chatsList?.addEventListener('click', (e) => {
  const item = e.target.closest('.list-item');
  if (!item || !chatsList.contains(item)) return;

  const chatId = Number(item.dataset.chatId);
  if (!chatId) return;

  openChat(chatId);
});

messageInput.addEventListener('input', () => {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.currentChat) return;

  clearTimeout(state.typingTimer);
  state.ws.send(JSON.stringify({ type: 'typing', chatId: state.currentChat.id }));
  state.typingTimer = setTimeout(() => {}, 800);
});

imageInput.addEventListener('change', () => {
  selectedFile.textContent = imageInput.files[0]
    ? `Выбрано: ${imageInput.files[0].name}`
    : '';
});

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentChat) return;

  const text = messageInput.value.trim();
  const image = imageInput.files[0];
  //const voice = state.voiceBlob;

  if (!text && !image) return;

  const formData = new FormData();
  if (text) formData.append('text', text);
  if (image) formData.append('image', image);

  //if (voice) {
    //const ext = voice.type.includes('ogg')
      //? 'ogg'
      //: voice.type.includes('mp4')
        //? 'mp4'
        //: 'webm';
    //console.log('voice type:', state.voiceMimeType, state.voiceBlob?.type);
    //formData.append('voice', voice, `voice-message.${ext}`);
  //}

  try {
    await api(`/api/chats/${state.currentChat.id}/messages`, {
      method: 'POST',
      body: formData
    });

    messageInput.value = '';
    imageInput.value = '';
    selectedFile.textContent = '';
    //resetVoiceRecording();

    scrollMessagesToBottom(true);
  } catch (error) {
    alert(error.message);
  }
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messageForm.requestSubmit();
  }
});

profileAvatarInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    profileAvatarPreview.src = reader.result;
    meAvatar.src = reader.result;
  };

  reader.readAsDataURL(file);

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const data = await api('/api/profile/avatar', {
      method: 'POST',
      body: formData
    });

    state.me = data.user;

    state.users = state.users.map(user =>
      user.id === state.me.id ? { ...user, ...data.user } : user
    );

    state.chats = state.chats.map(chat => {
      if (chat.partner.id === state.me.id) {
        return {
          ...chat,
          partner: { ...chat.partner, ...data.user }
        };
      }
      return chat;
    });

    renderMe();
    renderUsers();
    renderChats();

    if (state.currentChat?.partner?.id === state.me.id) {
      setCurrentChat({
        ...state.currentChat,
        partner: { ...state.currentChat.partner, ...data.user }
      });
    }

    profileAvatarPreview.src = avatarOrFallback(state.me.avatar_url);
    profileAvatarInput.value = '';
  } catch (error) {
    alert(error.message);
  }
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function bootstrapAfterAuth(user) {
  state.me = user;
  renderMe();
  setScreen(true);

  await refreshSidebarData();

  const chatIdFromUrl = getChatIdFromUrl();
  if (chatIdFromUrl) {
    const existing = state.chats.find((c) => c.id === chatIdFromUrl);
    if (existing) {
      await openChat(existing.id);
    }
  }

  await registerServiceWorker();

  connectWebSocket();
}

async function init() {
  await registerServiceWorker();

  try {
    const data = await api('/api/me');
    await bootstrapAfterAuth(data.user);
  } catch (_error) {
    setScreen(false);
  }
}

let usersCollapsed = localStorage.getItem('usersCollapsed') === 'true';

usersList.classList.toggle('collapsed', usersCollapsed);
usersToggle?.classList.toggle('open', !usersCollapsed);

usersToggle?.addEventListener('click', () => {
  usersCollapsed = !usersCollapsed;

  usersList.classList.toggle('collapsed', usersCollapsed);
  usersToggle.classList.toggle('open', !usersCollapsed);

  localStorage.setItem('usersCollapsed', usersCollapsed);
});

let chatsCollapsed = localStorage.getItem('chatsCollapsed') === 'true';

chatsList.classList.toggle('collapsed', chatsCollapsed);
chatsToggle?.classList.toggle('open', !chatsCollapsed);

chatsToggle?.addEventListener('click', () => {
  chatsCollapsed = !chatsCollapsed;

  chatsList.classList.toggle('collapsed', chatsCollapsed);
  chatsToggle.classList.toggle('open', !chatsCollapsed);

  localStorage.setItem('chatsCollapsed', chatsCollapsed);
});

init();