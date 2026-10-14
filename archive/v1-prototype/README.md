# NEON ARENA: BLACKOUT

A cyberpunk first-person multiplayer shooter prototype built with Three.js, Express, and Socket.IO.

## Requirements
- Node.js 18 or newer
- Internet connection for the browser-loaded Three.js module and Google Fonts

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in a modern desktop browser. Open another browser/device on the same network to test room-code multiplayer. For other devices on your LAN, use the host computer's local IP address instead of `localhost` and ensure port 3000 is reachable.

## Deploy publicly
Deploy this project to a Node.js hosting service that supports persistent WebSocket connections. Set the start command to `npm start`. The host must serve the `public` folder and allow Socket.IO WebSocket connections. Then test the deployed URL from separate devices and networks.

## Controls
- WASD / arrow keys: move
- Mouse: aim
- Left click: fire (click the canvas first to lock the pointer)
- Space: jump
- Shift: dash ability
- Q: shield
- E: scan
- R: reload

## Prototype limitations
This is an early playable prototype, not a production-grade competitive FPS. The server validates shooting cadence, ammunition, damage, and score, but player movement is still client-simulated and must be upgraded to authoritative server-side physics before serious competitive use. Weapon visuals and map collision are deliberately lightweight. Mobile touch controls are experimental. Test before public submission.
