# SignSync — Project Documentation

> **Two-way accessible video chat for deaf and hard of hearing users.**  
> Combines AI-powered sign language recognition, real-time video calling, and speech-to-text captions into one unified communication platform.

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Communication Flow](#3-communication-flow)
4. [Feature Breakdown](#4-feature-breakdown)
5. [Open-Source Credits & Licenses](#5-open-source-credits--licenses)
6. [Setup & Running](#6-setup--running)
7. [API Reference](#7-api-reference)
8. [WebSocket Message Protocol](#8-websocket-message-protocol)
9. [Sign Recognition Pipeline](#9-sign-recognition-pipeline)
10. [Hackathon Phase Plan](#10-hackathon-phase-plan)
11. [Known Limitations & Future Work](#11-known-limitations--future-work)

---

## 1. Project Overview

SignSync eliminates the communication barrier between deaf/hard-of-hearing individuals and hearing individuals by providing:

| Feature | Technology |
|---|---|
| Two-way video call | WebRTC + MediaDevices API |
| Sign → Caption | MediaPipe Hands + rule-based gesture classifier |
| Speech → Caption | Web Speech API (SpeechRecognition) |
| Caption → Audio | Web Speech API (SpeechSynthesis) |
| Real-time relay | WebSocket (ws library) |
| User accounts | REST API + bcryptjs + local JSON file |
| Meeting rooms | Server-generated 6-character codes |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Browser Client A                    │
│  Camera → MediaPipe Hands → signs.js → WS            │
│  Mic   → SpeechRecognition → speech.js → WS          │
│  <video> (local + remote)                            │
│  Caption Area                                        │
└────────────────────┬─────────────────────────────────┘
                     │ WebSocket
┌────────────────────▼─────────────────────────────────┐
│              Node.js Server (server.js)               │
│  Express HTTP  → serves /public                      │
│  POST /api/register  → users.json                    │
│  POST /api/login     → users.json                    │
│  WebSocket (ws)      → room signaling + event relay  │
└────────────────────┬─────────────────────────────────┘
                     │ WebSocket
┌────────────────────▼─────────────────────────────────┐
│                  Browser Client B                    │
│  (same structure as Client A)                        │
└──────────────────────────────────────────────────────┘
```

---

## 3. Communication Flow

### Deaf User (Signer)
```
Camera → MediaPipe Hands → 21 Landmarks → Gesture Classifier → Caption Text
Caption Text → WebSocket → Other User's Caption Area
```

### Hearing User (Speaker)
```
Microphone → SpeechRecognition → Transcript → WebSocket → Other User's Caption Area
Incoming Text → SpeechSynthesis → Audio Playback (if TTS enabled)
```

---

## 4. Feature Breakdown

### User Accounts
- Register with **username**, **email**, and **password**.
- Emails are enforced unique.
- Passwords are hashed with **bcrypt** (10 salt rounds).
- User records stored in `users.json`.

### Meetings
- Any logged-in user can **Create** a meeting → server generates a random 6-character code.
- Any other logged-in user can **Join** a meeting by entering the code.

### Video Call
- Browser-to-browser WebRTC using STUN servers.
- Both users see each other's camera in an enlarged layout.

### Captions
- **Speech captions**: speech-to-text transcripts generated via Web Speech API.
- **Sign captions**: sign language recognition output.
- Captions appear **sequentially** and disappear after **8 seconds**.
- No emojis are used in the caption text to maintain a professional interface.

---

## 5. Open-Source Credits & Licenses

| Library / API | License | Purpose |
|---|---|---|
| [Express](https://expressjs.com/) | MIT | HTTP server & static file serving |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket server for signaling & message relay |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | MIT | Password hashing |
| [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) | Apache 2.0 | Real-time hand landmark detection |
| [WebRTC](https://webrtc.org/) | W3C | Peer-to-peer video/audio streaming |

---

## 6. Sign Recognition Pipeline

### Classification Method
SignSync uses a rule-based geometric classifier in `signs.js` that analyzes the relative positions of 21 hand landmarks provided by MediaPipe.

### Current Gesture Set (Full ASL Alphabet + Phrases)

#### ASL Alphabet (A–Z)
Recognizes all 26 static letters. Letters are confirmed after being held for approximately 0.8 seconds.

#### Dedicated Phrases
These phrases are mapped to specific, geometrically distinct hand gestures and are confirmed after being held for approximately 1.5 seconds.

| Gesture Key | Output Caption | Description |
|---|---|---|
| `PHRASE_HELLO` | "Hello" | Flat-B salute, palm outward, hand raised. |
| `PHRASE_GOODBYE` | "Goodbye" | Open hand wave, all 5 digits extended and spread wide. |
| `PHRASE_HOW_ARE_YOU`| "How Are You?" | Bent-B hand, fingers bent forward at MCP knuckles. |
| `PHRASE_THANK_YOU` | "Thank You" | Flat open hand at mid-frame, palm toward camera. |
| `PHRASE_PLEASE` | "Please Help Me" | Flat open palm facing inward toward the body. |
| `PHRASE_TIME` | "What Time Is It?" | Index finger pointing downward (tapping wrist gesture). |

---

## 7. Setup & Running

```bash
npm install
node server.js
```
The server starts on **http://localhost:3001**.
