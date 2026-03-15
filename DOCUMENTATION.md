# SignSync — Comprehensive Technical Documentation

SignSync is a high-performance, two-way accessible video chat application designed to bridge the gap between deaf/hard-of-hearing and hearing individuals. It leverages real-time AI computer vision for sign language recognition and browser-native APIs for speech-to-text and peer-to-peer communication.

---

## 1. Technical Stack & Frameworks

### Backend (Node.js)
- **Runtime**: Node.js
- **Framework**: Express.js (v4.18.2) — Handles static file serving and RESTful API endpoints for authentication.
- **Real-time Communication**: `ws` (v8.16.0) — WebSocket library used for signaling (WebRTC handshake) and real-time message relay (captions).
- **Security**: `bcryptjs` (v2.4.3) — Used for secure password hashing and verification.

### Frontend (Vanilla JavaScript)
- **Architecture**: Single Page Application (SPA) with modular JS files.
- **Styling**: Vanilla CSS3 (Custom Design System with Poppins fonts).
- **Computer Vision**: MediaPipe Hands (via Google CDN) — Extracts 21 3D hand landmarks at 30+ FPS.

---

## 2. Core APIs & Services

### Browser APIs
- **WebRTC (RTCPeerConnection)**: Establishes a direct peer-to-peer encrypted connection for low-latency video and audio streaming.
- **Web Speech API (Recognition)**: Converts hearing user speech into text transcripts in real-time.
- **Web Speech API (Synthesis)**: Converts incoming sign-language captions into audible speech (Text-to-Speech).
- **MediaDevices (getUserMedia)**: Captures user camera and microphone streams.

### Signaling & Networking
- **Signaling Server**: Orchestrated via WebSocket on the Node.js backend.
- **STUN Servers**: Uses Google's Public STUN servers (`stun.l.google.com:19302`) for NAT traversal and ICE candidate discovery.

---

## 3. Sign Recognition Pipeline (`signs.js`)

SignSync uses a **Geometric Classifier** engine that analyzes the relative spatial relationships between hand landmarks.

### Landmark Normalization
To ensure the system works at any distance from the camera, the engine calculates **Relative Proximity**:
- Distances are calculated relative to the distance between the wrist and the middle finger base (CMC).
- Helper functions like `tipNearThumb()` and `isSideways()` analyze the hand orientation in 3D space.

### Gesture Classification Logic
- **Alphabet (A-Z)**: Each letter is defined by a set of geometric constraints (e.g., "Middle finger is retracted," "Index is extended").
- **Phrases**: High-level semantic gestures (e.g., "Hello," "Goodbye") are mapped to complex multi-finger orientations.
- **Confirmation Timing**: 
    - Letters require **0.8 seconds** of stable recognition to trigger.
    - Phrases require **1.5 seconds** to prevent accidental triggers.

---

## 4. Sequential Caption System (`captions.js`)

To prevent users from being overwhelmed by overlapping text, SignSync implements a **Managed Queue**:
- **Non-Overriding**: New captions are appended to a list rather than replacing the current text.
- **Independent TTL**: Each caption entry has an independent **8-second timer**.
- **Visual Feedback**: Captions fade out smoothly using CSS transitions before being removed from the DOM.

---

## 5. Development History & AI Prompts

The project was developed iteratively using an AI-assisted pair-programming approach. Below are the core prompts and strategies used to architect the system:

### Phase 1: Infrastructure
> **Prompt**: "Scaffold a Node.js project using Express and WebSocket. Create an authentication system using a JSON flat file and bcrypt. Build a basic Single Page Application (SPA) frontend with a dark-mode CSS theme."
- **Result**: Established `server.js`, `users.json`, and the basic screen switching logic (`auth`, `lobby`, `call`).

### Phase 2: WebRTC Integration
> **Prompt**: "Implement a WebRTC signaling flow. The host creates a 6-letter room code via WebSocket, and the guest joins it. Establish a peer-to-peer video/audio connection using Google STUN servers."
- **Result**: Created `webrtc.js` and the signaling handlers in `server.js`.

### Phase 3: Sign Recognition Engine
> **Prompt**: "Integrate MediaPipe Hands. Create a modular JS file `signs.js` that periodically samples hand landmarks. Write a rule-based classifier for ASL letters. Use the distance between specific landmark tips to determine if a finger is open or closed."
- **Result**: Developed the core of `signs.js`, starting with simple letters like 'L' and 'V'.

### Phase 4: Refinement & Robustness
> **Prompt**: "Refine the sign recognition for difficult letters like M, N, S, and T by checking the thumb position relative to other fingers. Add phrases like 'Hello' and 'Thank You'. Implement a confirmation delay of 800ms to ensure stability."
- **Result**: Expanded `signs.js` to support the full A-Z alphabet and 6 dedicated phrases.

### Phase 5: User Experience
> **Prompt**: "Create a sequential captioning system. Captions should not override each other. Instead, they should appear as a list, and each should disappear after exactly 8 seconds. Remove all emojis from the captions to maintain a professional look."
- **Result**: Developed `captions.js` and updated `speech.js` and `signs.js` to use the new `addCaption` queue.

---

## 6. How to Run

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Start the Server**:
    ```bash
    npm run dev
    ```
3.  **Access the App**:
    Open `http://localhost:3001` in two separate browser tabs (or two different devices) to test the call functionality.

---

## 7. Open Source Attribution

| Component | Repository / Provider | License |
|---|---|---|
| Express | [expressjs/express](https://github.com/expressjs/express) | MIT |
| WebSocket | [websockets/ws](https://github.com/websockets/ws) | MIT |
| Bcrypt | [dcodeIO/bcrypt.js](https://github.com/dcodeIO/bcrypt.js) | MIT |
| MediaPipe | [google/mediapipe](https://github.com/google/mediapipe) | Apache 2.0 |
| Poppins Font | [Google Fonts](https://fonts.google.com/specimen/Poppins) | OFL |
