/**
 * app.js — Main SignSync orchestrator
 * Handles auth UI, lobby UI, WebSocket connection, and call lifecycle.
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;   // { username, email }
let isHost = false;
let micOn = true;
let camOn = true;
let speechOn = false;
let ttsOn = false;

// Tracks whether local media is ready. makeOffer() and handleOffer() wait on
// this before creating the peer connection so localStream is never null when
// addTrack() runs.
let localMediaReady = null;   // Promise resolved once startLocalMedia() finishes

// ── Screens ───────────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Tab switching ──────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-error').textContent = '';
  document.getElementById('reg-error').textContent = '';
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    currentUser = { username: data.username, email: data.email };
    sessionStorage.setItem('signsync_user', JSON.stringify(currentUser));
    enterLobby();
  } catch {
    errEl.textContent = 'Connection error. Is the server running?';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    currentUser = { username: data.username, email };
    sessionStorage.setItem('signsync_user', JSON.stringify(currentUser));
    enterLobby();
  } catch {
    errEl.textContent = 'Connection error. Is the server running?';
  }
}

function handleLogout() {
  sessionStorage.removeItem('signsync_user');
  currentUser = null;
  showScreen('screen-auth');
}

// ── Lobby ─────────────────────────────────────────────────────────────────────

function enterLobby() {
  document.getElementById('lobby-username').textContent = currentUser.username;
  showScreen('screen-lobby');
}

async function createRoom() {
  await ensureWebSocket();
  window.ws.send(JSON.stringify({ type: 'create-room' }));
}

async function joinRoom() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const errEl = document.getElementById('lobby-error');
  errEl.textContent = '';
  if (code.length !== 6) { errEl.textContent = 'Please enter a 6-character code.'; return; }
  await ensureWebSocket();
  window.ws.send(JSON.stringify({ type: 'join-room', code }));
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function ensureWebSocket() {
  return new Promise((resolve) => {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) { resolve(); return; }
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    window.ws = new WebSocket(`${protocol}://${location.host}`);

    window.ws.onopen = () => {
      console.log('[WS] Connected to SignSync server');
      resolve();
    };

    window.ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      console.log('[WS] Inbound message:', msg.type);
      await handleServerMessage(msg);
    };

    window.ws.onclose = () => {
      console.log('[WS] Disconnected');
    };
  });
}

async function handleServerMessage(msg) {
  switch (msg.type) {
    case 'room-created':
      isHost = true;
      enterCall(msg.code);
      break;

    case 'room-joined':
      isHost = false;
      enterCall(msg.code);
      break;

    case 'guest-joined':
      console.log('[Sig] Peer joined. Host starting WebRTC offer negotiation.');
      document.getElementById('remote-label').textContent = 'Connecting…';
      await localMediaReady;
      await makeOffer();
      break;

    case 'offer':
      console.log('[Sig] Received WebRTC offer.');
      await localMediaReady;
      await handleOffer(msg.sdp);
      break;

    case 'answer':
      console.log('[Sig] Received WebRTC answer.');
      await handleAnswer(msg.sdp);
      break;

    case 'ice-candidate':
      await handleIceCandidate(msg.candidate);
      break;

    case 'speech_caption':
      addCaption('speech', msg.text);
      speak(msg.text);
      break;

    case 'sign_caption':
      addCaption('sign', msg.text);
      break;

    case 'peer-left':
      console.log('[Sig] Peer left.');
      addCaption('sign', '— Peer has left the call —');
      document.getElementById('remote-video').srcObject = null;
      document.getElementById('remote-label').textContent = 'Peer left';
      break;

    case 'error':
      document.getElementById('lobby-error').textContent = msg.message;
      break;
  }
}

// ── Call lifecycle ────────────────────────────────────────────────────────────

async function enterCall(code) {
  document.getElementById('call-code-display').textContent = code;
  showScreen('screen-call');
  clearCaptions();

  console.log('[Call] Entering call area, starting local media...');
  try {
    localMediaReady = startLocalMedia();
    await localMediaReady;
    console.log('[Call] Local media ready.');
  } catch (err) {
    console.error('[Call] Failed to start media:', err);
    alert('Could not access camera or microphone. Please check permissions.');
    leaveCall();
    return;
  }

  // Start sign recognition once the video element has metadata
  const localVideo = document.getElementById('local-video');
  if (localVideo.readyState >= 1) {
    startSigns(localVideo);
  } else {
    localVideo.onloadedmetadata = () => startSigns(localVideo);
  }
}

function leaveCall() {
  console.log('[Call] Leaving call.');
  stopSpeech();
  stopSigns();
  closePeerConnection();
  if (window.ws) { window.ws.close(); window.ws = null; }
  clearCaptions();
  localMediaReady = null;
  // Reset control buttons
  ['btn-mic', 'btn-cam', 'btn-speech', 'btn-tts'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  micOn = true; camOn = true; speechOn = false; ttsOn = false;
  const micBtn = document.getElementById('btn-mic');
  const camBtn = document.getElementById('btn-cam');
  if (micBtn) micBtn.classList.add('active');
  if (camBtn) camBtn.classList.add('active');
  enterLobby();
}

// ── Controls ──────────────────────────────────────────────────────────────────

function toggleMic() {
  micOn = !micOn;
  setMicEnabled(micOn);
  document.getElementById('btn-mic').classList.toggle('active', micOn);
}

function toggleCam() {
  camOn = !camOn;
  setCamEnabled(camOn);
  document.getElementById('btn-cam').classList.toggle('active', camOn);
}

function toggleSpeech() {
  speechOn = !speechOn;
  if (speechOn) startSpeech(); else stopSpeech();
  document.getElementById('btn-speech').classList.toggle('active', speechOn);
}

function toggleTTS() {
  ttsOn = !ttsOn;
  setTTSEnabled(ttsOn);
  document.getElementById('btn-tts').classList.toggle('active', ttsOn);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  const saved = sessionStorage.getItem('signsync_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    enterLobby();
  } else {
    showScreen('screen-auth');
  }
})();