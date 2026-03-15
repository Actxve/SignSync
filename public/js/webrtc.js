/**
 * webrtc.js — WebRTC peer connection module
 * Handles offer/answer/ICE exchange via the app's WebSocket (window.ws).
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let pc = null;          // RTCPeerConnection
let localStream = null; // MediaStream from getUserMedia
let iceCandidateQueue = []; // Queue for candidates arriving before PC is ready

/**
 * Start local camera + mic and attach to #local-video.
 * Returns a Promise that resolves once the stream is live.
 */
async function startLocalMedia() {
  console.log('[Media] Requesting camera/mic access...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log('[Media] Access granted. Streams active.');
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;
    await localVideo.play().catch(e => console.warn('[Media] Local auto-play blocked:', e));
    return localStream;
  } catch (err) {
    console.error('[Media] Failed to get local media:', err);
    throw err;
  }
}

/**
 * Create the RTCPeerConnection, wire up ICE and track handlers.
 * Must only be called after startLocalMedia() has resolved.
 */
function createPeerConnection() {
  console.log('[WebRTC] Creating RTCPeerConnection...');
  pc = new RTCPeerConnection(RTC_CONFIG);

  // Add local tracks
  if (localStream) {
    console.log('[WebRTC] Adding local tracks to connection...');
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Send ICE candidates to peer via WebSocket
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && window.ws && window.ws.readyState === WebSocket.OPEN) {
      console.log('[WebRTC] Sending local ICE candidate to peer');
      window.ws.send(JSON.stringify({ type: 'ice-candidate', candidate }));
    }
  };

  // Process tracks arriving from peer
  pc.ontrack = ({ streams }) => {
    console.log('[WebRTC] Remote track received!');
    if (!streams || !streams[0]) return;
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo.srcObject !== streams[0]) {
      console.log('[WebRTC] Attaching remote stream to video element');
      remoteVideo.srcObject = streams[0];
      remoteVideo.play()
        .then(() => console.log('[WebRTC] Remote video playback started'))
        .catch(err => console.warn('[WebRTC] Remote video play() blocked/failed:', err));
    }
    document.getElementById('remote-label').textContent = 'Live';
  };

  // Log connection state changes
  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state changed:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      console.error('[WebRTC] Connection FAILED. Likely a NAT/Firewall issue. STUN alone may not be enough.');
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
  };

  return pc;
}

/** Host: create and send offer after guest joins. */
async function makeOffer() {
  console.log('[WebRTC] [Host] Making offer...');
  createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  // Flush any queued candidates (though unlikely for host)
  processQueuedCandidates();

  window.ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
}

/** Guest: receive offer, create answer. */
async function handleOffer(sdp) {
  console.log('[WebRTC] [Guest] Received offer, creating answer...');
  createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  
  // Now that remote description is set and PC exists, flush queued candidates
  processQueuedCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  window.ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
}

/** Host: receive answer from guest. */
async function handleAnswer(sdp) {
  console.log('[WebRTC] [Host] Received answer.');
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }
}

/** Both: receive ICE candidates from peer. */
async function handleIceCandidate(candidate) {
  if (pc && pc.remoteDescription) {
    console.log('[WebRTC] Adding ICE candidate from peer');
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] Error adding ICE candidate:', e);
    }
  } else {
    console.log('[WebRTC] PC or RemoteDescription not ready. Queuing ICE candidate.');
    iceCandidateQueue.push(candidate);
  }
}

async function processQueuedCandidates() {
  if (!pc || !pc.remoteDescription) return;
  console.log(`[WebRTC] Processing ${iceCandidateQueue.length} queued candidates...`);
  while (iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] Error adding queued ICE candidate:', e);
    }
  }
}

/** Clean up peer connection and local media. */
function closePeerConnection() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
}

/** Toggle microphone track on/off. */
function setMicEnabled(enabled) {
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = enabled);
}

/** Toggle camera track on/off. */
function setCamEnabled(enabled) {
  if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = enabled);
}