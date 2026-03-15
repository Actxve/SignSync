/**
 * signs.js — Full ASL A–Z alphabet + 6 dedicated phrase gestures
 *            via MediaPipe Hands
 *
 * ── Phrase gestures (their own unique shapes, NOT letter long-holds) ──────────
 *
 *   PHRASE_HELLO      → "Hello 👋"
 *     Flat-B salute: all 4 fingers together & extended, thumb tucked, palm
 *     facing outward (away from face), hand raised (wrist above mid-frame).
 *
 *   PHRASE_GOODBYE    → "Goodbye 👋"
 *     Open hand wave: all 5 digits extended + spread wide.
 *     Thumb also out — full open fanned hand.
 *     Distinguished from HELLO by fingers being SPREAD (not together).
 *
 *   PHRASE_HOW_ARE_YOU → "How Are You? 🤝"
 *     Bent-B / bent hand: all four fingers extended but bent forward at the
 *     MCP knuckles (tips pointing toward viewer, not upward). Thumb tucked.
 *
 *   PHRASE_THANK_YOU  → "Thank You 🙏"
 *     Flat hand at chin moving forward — static snapshot: open flat hand,
 *     fingers together + thumb out, palm facing camera, wrist mid-frame.
 *
 *   PHRASE_PLEASE     → "Please Help Me 🆘"
 *     Flat open palm on chest: fingers together + thumb out, but palm
 *     faces INWARD (toward body) — wrist z < fingertip z.
 *
 *   PHRASE_TIME       → "What Time Is It? ⏰"
 *     Index finger pointing downward at wrist: only index extended and
 *     pointing steeply downward, all other fingers curled, thumb tucked.
 *
 * ── Letters A–Z ──────────────────────────────────────────────────────────────
 *   All 26 static ASL letters. J and Z are static approximations (no motion).
 *
 * ── Hold timing ──────────────────────────────────────────────────────────────
 *   Letters : ~0.8 s  (5 frames at ~6 fps)
 *   Phrases : ~1.5 s  (10 frames) — shorter hold; distinct shapes
 */

const SIGN_FPS = 6;
const LETTER_HOLD = 5;    // frames to confirm a letter  (~0.8 s)
const PHRASE_HOLD = 10;   // frames to trigger a phrase  (~1.5 s)
const LETTER_COOL = 1500; // ms cooldown between same letter emissions
const PHRASE_COOL = 3000; // ms cooldown between same phrase emissions

// Gesture keys that are phrases (never emitted as letters)
const PHRASE_KEYS = new Set([
  'PHRASE_HELLO', 'PHRASE_GOODBYE', 'PHRASE_HOW_ARE_YOU',
  'PHRASE_THANK_YOU', 'PHRASE_PLEASE', 'PHRASE_TIME',
]);

const PHRASE_LABELS = {
  PHRASE_HELLO: 'Hello ',
  PHRASE_GOODBYE: 'Goodbye ',
  PHRASE_HOW_ARE_YOU: 'How Are You? ',
  PHRASE_THANK_YOU: 'Thank You ',
  PHRASE_PLEASE: 'Please Help Me ',
  PHRASE_TIME: 'What Time Is It? ',
};

let handsModel = null;
let signCamera = null;
let signsEnabled = false;

let currentGesture = null;
let holdCount = 0;
let gestureEmitted = false;
let lastEmitTime = { letter: 0, phrase: 0 };
let lastEmitLabel = { letter: null, phrase: null };

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** 2-D Euclidean distance (ignores z) */
function d2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** 3-D Euclidean distance */
function d3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }

/**
 * Finger extended upward:
 *   tip.y is meaningfully above pip.y (smaller y = higher on screen).
 */
function up(lm, tip, pip) { return lm[tip].y < lm[pip].y - 0.025; }

/**
 * Finger curled tightly:
 *   tip closer to wrist than MCP knuckle is.
 */
function curl(lm, tip, mcp) {
  return d3(lm[tip], lm[0]) < d3(lm[mcp], lm[0]) * 0.82;
}

/**
 * Finger bent forward (not up, not curled):
 *   tip is below its MCP in y (pointing forward/down) but not reaching wrist.
 *   Used for the bent-B "How Are You" shape.
 */
function bentFwd(lm, tip, mcp) {
  return lm[tip].y > lm[mcp].y + 0.02 && !curl(lm, tip, mcp);
}

/** Thumb extended away from palm (tip far from index MCP). */
function thumbOut(lm) { return d2(lm[4], lm[5]) > 0.075; }

/** Thumb folded over the curled fingers. */
function thumbOver(lm) {
  return lm[4].x > Math.min(lm[5].x, lm[17].x) - 0.01 &&
    lm[4].x < Math.max(lm[5].x, lm[17].x) + 0.01 &&
    lm[4].y > lm[3].y;
}

/** Thumb tucked under / between index and middle. */
function thumbUnder(lm) {
  return lm[4].y > lm[5].y && !thumbOut(lm) && !thumbOver(lm);
}

/** Finger roughly horizontal (tip and pip at similar y). */
function horiz(lm, tip, pip) { return Math.abs(lm[tip].y - lm[pip].y) < 0.045; }

/** Index tip touching or nearly touching thumb tip → O / D / F shapes. */
function oShape(lm) { return d2(lm[8], lm[4]) < 0.065; }

/** All four fingertips clustered near thumb tip → E shape. */
function allNearThumb(lm) {
  return d2(lm[8], lm[4]) < 0.075 &&
    d2(lm[12], lm[4]) < 0.095 &&
    d2(lm[16], lm[4]) < 0.115 &&
    d2(lm[20], lm[4]) < 0.135;
}

/** Total hand spread: thumb tip to pinky tip. */
function spread(lm) { return d2(lm[4], lm[20]); }

/** Spread across four fingers only (index tip to pinky tip). */
function fingerSpread(lm) { return d2(lm[8], lm[20]); }

/** Finger partially bent / hooked (neither up nor curled). */
function hooked(lm, tip, mcp, pip) {
  return !up(lm, tip, pip) && !curl(lm, tip, mcp);
}

// ── Phrase gesture classifiers ────────────────────────────────────────────────

/**
 * PHRASE_HELLO — Flat-B salute
 *   All 4 fingers up and TOGETHER (small fingerSpread), thumb tucked,
 *   wrist in upper portion of frame, fingertips closer to camera than wrist
 *   (palm facing outward).
 */
function isHello(lm) {
  return up(lm, 8, 6) && up(lm, 12, 10) && up(lm, 16, 14) && up(lm, 20, 18) &&
    !thumbOut(lm) &&
    fingerSpread(lm) < 0.14 &&
    lm[0].y < 0.72 &&
    lm[8].z < lm[0].z - 0.02;
}

/**
 * PHRASE_GOODBYE — Open-hand wave / fan
 *   All 5 digits extended AND spread wide, thumb also out.
 *   Large overall spread distinguishes it from the flat-B salute.
 */
function isGoodbye(lm) {
  return up(lm, 8, 6) && up(lm, 12, 10) && up(lm, 16, 14) && up(lm, 20, 18) &&
    thumbOut(lm) &&
    fingerSpread(lm) > 0.18 &&
    spread(lm) > 0.28;
}

/**
 * PHRASE_HOW_ARE_YOU — Bent-B hand
 *   All 4 fingers bent FORWARD at the MCP knuckles (tips point toward viewer,
 *   not upward). No finger fully curled. Thumb tucked. None of the fingers
 *   pass the "up" test.
 */
function isHowAreYou(lm) {
  const noneUp = !up(lm, 8, 6) && !up(lm, 12, 10) &&
    !up(lm, 16, 14) && !up(lm, 20, 18);
  return bentFwd(lm, 8, 5) && bentFwd(lm, 12, 9) &&
    bentFwd(lm, 16, 13) && bentFwd(lm, 20, 17) &&
    noneUp && !thumbOut(lm);
}

/**
 * PHRASE_THANK_YOU — Flat open hand, palm toward camera, fingers together,
 *   thumb out, wrist at mid-frame (not high like the salute).
 *   Palm-out: fingertips closer to camera than wrist (z check same as HELLO),
 *   but wrist y > 0.35 rules out the raised salute position.
 */
function isThankYou(lm) {
  return up(lm, 8, 6) && up(lm, 12, 10) && up(lm, 16, 14) && up(lm, 20, 18) &&
    thumbOut(lm) &&
    fingerSpread(lm) < 0.14 &&
    lm[0].y > 0.35 &&
    lm[8].z < lm[0].z - 0.02;
}

/**
 * PHRASE_PLEASE — Flat open palm facing INWARD (toward body / chest)
 *   Same hand shape as THANK_YOU (fingers up + together, thumb out) but
 *   the wrist is closer to the camera than the fingertips — palm faces body.
 */
function isPlease(lm) {
  return up(lm, 8, 6) && up(lm, 12, 10) && up(lm, 16, 14) && up(lm, 20, 18) &&
    thumbOut(lm) &&
    fingerSpread(lm) < 0.14 &&
    lm[0].z < lm[8].z - 0.02;
}

/**
 * PHRASE_TIME — Index pointing steeply downward (tapping wrist gesture)
 *   Index tip is well below its MCP knuckle. All other fingers curled.
 *   Thumb tucked. Steeper angle threshold than Q to avoid false positives.
 */
function isTime(lm) {
  return lm[8].y > lm[5].y + 0.06 &&
    curl(lm, 12, 9) && curl(lm, 16, 13) && curl(lm, 20, 17) &&
    !thumbOut(lm);
}

// ── ASL Letter Classifier ─────────────────────────────────────────────────────

/**
 * Returns a gesture key (PHRASE_* or letter A–Z), or null if unrecognised.
 * Phrase gestures are evaluated first so they always take priority.
 */
function classify(lm) {
  // ── Phrase gestures (checked before any letter) ───────────────────────────
  if (isHello(lm)) return 'PHRASE_HELLO';
  if (isGoodbye(lm)) return 'PHRASE_GOODBYE';
  if (isThankYou(lm)) return 'PHRASE_THANK_YOU';
  if (isPlease(lm)) return 'PHRASE_PLEASE';
  if (isHowAreYou(lm)) return 'PHRASE_HOW_ARE_YOU';
  if (isTime(lm)) return 'PHRASE_TIME';

  // ── Per-finger convenience flags ──────────────────────────────────────────
  const idx = up(lm, 8, 6);
  const mid = up(lm, 12, 10);
  const rng = up(lm, 16, 14);
  const pnk = up(lm, 20, 18);
  const thm = thumbOut(lm);

  const idxC = curl(lm, 8, 5);
  const midC = curl(lm, 12, 9);
  const rngC = curl(lm, 16, 13);
  const pnkC = curl(lm, 20, 17);

  const imSpread = d2(lm[8], lm[12]);

  // ── B — 4 fingers up together, thumb tucked ───────────────────────────────
  if (idx && mid && rng && pnk && !thm && lm[4].x > lm[3].x) return 'B';

  // ── K — index + middle up, thumb out between them ────────────────────────
  if (idx && mid && !rng && !pnk && thm && imSpread > 0.05) return 'K';

  // ── V — index + middle spread, thumb tucked ──────────────────────────────
  if (idx && mid && !rng && !pnk && !thm && imSpread > 0.065) return 'V';

  // ── R — index + middle crossed (very close) ──────────────────────────────
  if (idx && mid && !rng && !pnk && !thm && imSpread < 0.03) return 'R';

  // ── U — index + middle up close (not crossing) ───────────────────────────
  if (idx && mid && !rng && !pnk && !thm && imSpread >= 0.03 && imSpread <= 0.065) return 'U';

  // ── W — index + middle + ring up, pinky & thumb down ────────────────────
  if (idx && mid && rng && !pnk && !thm) return 'W';

  // ── L — index up + thumb out, rest curled ────────────────────────────────
  if (idx && thm && !mid && !rng && !pnk && !idxC) return 'L';

  // ── Y — thumb out + pinky up, other three curled ─────────────────────────
  if (thm && pnk && !idx && !mid && !rng) return 'Y';

  // ── I — pinky only up, thumb tucked ──────────────────────────────────────
  if (pnk && !idx && !mid && !rng && !thm) return 'I';

  // ── J — like I but thumb extended ────────────────────────────────────────
  if (pnk && !idx && !mid && !rng && thm) return 'J';

  // ── F — index+thumb circle, mid+ring+pinky extended ──────────────────────
  if (oShape(lm) && mid && rng && pnk && !idx) return 'F';

  // ── D — index up, others + thumb form circle ─────────────────────────────
  if (idx && oShape(lm) && !mid && !rng && !pnk) return 'D';

  // ── O — all fingers curved to meet thumb (no finger fully up) ────────────
  if (oShape(lm) && !idx && !mid && !rng && !pnk) return 'O';

  // ── C — open curved C: fingers moderately bent, thumb out, not touching ──
  if (!idx && !mid && !rng && !pnk && thm && !oShape(lm) &&
    !idxC && !midC && !rngC) return 'C';

  // ── G — index horizontal + thumb parallel, others curled ─────────────────
  if (horiz(lm, 8, 6) && thm && midC && rngC && pnkC) return 'G';

  // ── H — index + middle both horizontal together ───────────────────────────
  if (horiz(lm, 8, 6) && horiz(lm, 12, 10) && rngC && pnkC && !thm) return 'H';

  // ── P — index pointing downward + thumb out ───────────────────────────────
  if (lm[8].y > lm[5].y + 0.07 && thm && midC && rngC && pnkC) return 'P';

  // ── Q — index pointing downward (shallower than PHRASE_TIME), no thumb ────
  if (lm[8].y > lm[5].y + 0.04 && lm[8].y <= lm[5].y + 0.06 &&
    !thm && midC && rngC && pnkC) return 'Q';

  // ── Z — index pointing up/forward, others curled (static approx) ─────────
  if (idx && !mid && !rng && !pnk && !thm && !horiz(lm, 8, 6)) return 'Z';

  // ── X — index hooked (partially bent), others fully curled ───────────────
  if (hooked(lm, 8, 5, 6) && midC && rngC && pnkC && !thm) return 'X';

  // ── E — all fingertips clustered near thumb ───────────────────────────────
  if (allNearThumb(lm) && !thm) return 'E';

  // ── A — fist, thumb to the side ──────────────────────────────────────────
  if (idxC && midC && rngC && pnkC && thm && !thumbOver(lm) && !thumbUnder(lm)) return 'A';

  // ── S — fist, thumb folded over fingers ──────────────────────────────────
  if (idxC && midC && rngC && pnkC && thumbOver(lm)) return 'S';

  // ── T — fist, thumb tucked between index and middle ──────────────────────
  if (idxC && midC && rngC && pnkC && thumbUnder(lm)) return 'T';

  // ── M — index+middle+ring all folded over thumb ───────────────────────────
  if (idxC && midC && rngC && pnkC && !thm &&
    lm[8].y > lm[5].y && lm[12].y > lm[9].y && lm[16].y > lm[13].y) return 'M';

  // ── N — index+middle folded over thumb (ring not as low) ─────────────────
  if (idxC && midC && rngC && pnkC && !thm &&
    lm[8].y > lm[5].y && lm[12].y > lm[9].y && lm[16].y <= lm[13].y) return 'N';

  return null;
}

// ── Emission logic ────────────────────────────────────────────────────────────

function emit(gesture) {
  if (gestureEmitted) return;

  const now = Date.now();
  const isPhrase = PHRASE_KEYS.has(gesture);
  const reqHold = isPhrase ? PHRASE_HOLD : LETTER_HOLD;

  if (holdCount < reqHold) return;

  if (isPhrase) {
    const label = PHRASE_LABELS[gesture];
    if (label !== lastEmitLabel.phrase || now - lastEmitTime.phrase > PHRASE_COOL) {
      gestureEmitted = true;
      lastEmitTime.phrase = now;
      lastEmitLabel.phrase = label;
      addCaption('sign', label);
      if (window.ws && window.ws.readyState === WebSocket.OPEN)
        window.ws.send(JSON.stringify({ type: 'sign_caption', text: label }));
    }
  } else {
    if (gesture !== lastEmitLabel.letter || now - lastEmitTime.letter > LETTER_COOL) {
      gestureEmitted = true;
      lastEmitTime.letter = now;
      lastEmitLabel.letter = gesture;
      addCaption('sign', gesture);
      if (window.ws && window.ws.readyState === WebSocket.OPEN)
        window.ws.send(JSON.stringify({ type: 'sign_caption', text: gesture }));
    }
  }
}

// ── MediaPipe initialisation ──────────────────────────────────────────────────

function initSigns(videoElement) {
  if (!window.Hands) { console.warn('[SignSync] MediaPipe Hands not loaded.'); return; }

  handsModel = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  handsModel.setOptions({
    selfieMode: true,
    maxNumHands: 1,
    modelComplexity: 0,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.55,
  });

  handsModel.onResults((results) => {
    if (!signsEnabled) return;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      currentGesture = null;
      holdCount = 0;
      gestureEmitted = false;
      return;
    }

    const gesture = classify(results.multiHandLandmarks[0]);

    if (!gesture) {
      currentGesture = null;
      holdCount = 0;
      gestureEmitted = false;
      return;
    }

    if (gesture === currentGesture) {
      holdCount++;
    } else {
      currentGesture = gesture;
      holdCount = 1;
      gestureEmitted = false;
    }

    emit(gesture);
  });

  if (!window.Camera) { console.warn('[SignSync] MediaPipe Camera utils not loaded.'); return; }

  signCamera = new Camera(videoElement, {
    onFrame: async () => {
      if (signsEnabled && handsModel)
        await handsModel.send({ image: videoElement });
    },
    width: 320,
    height: 240,
  });
}

function startSigns(videoElement) {
  if (!handsModel) initSigns(videoElement);
  signsEnabled = true;
  if (signCamera) signCamera.start();
}

function stopSigns() {
  signsEnabled = false;
  if (signCamera) signCamera.stop();
}