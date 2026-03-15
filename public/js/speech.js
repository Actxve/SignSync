/**
 * speech.js — Web Speech API module
 * Captures microphone speech, sends captions via WebSocket,
 * and optionally reads incoming messages aloud via TTS.
 */

let recognition = null;
let speechEnabled = false;
let ttsEnabled = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeech() {
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition not supported in this browser.');
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
    }
    if (final.trim()) {
      // Show locally
      addCaption('speech', final.trim());
      // Send to peer
      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'speech_caption', text: final.trim() }));
      }
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') console.warn('Speech recognition error:', e.error);
  };

  recognition.onend = () => {
    // Auto-restart if still enabled (browser stops on silence)
    if (speechEnabled) recognition.start();
  };
}

function startSpeech() {
  if (!recognition) initSpeech();
  if (!recognition) return;
  speechEnabled = true;
  try { recognition.start(); } catch { /* already running */ }
}

function stopSpeech() {
  speechEnabled = false;
  if (recognition) try { recognition.stop(); } catch { /* ignore */ }
}

/** Speak text aloud using TTS if enabled. */
function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis) return;
  const utt = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utt);
}

function setTTSEnabled(enabled) {
  ttsEnabled = enabled;
}
