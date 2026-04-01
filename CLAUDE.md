# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

**Start development:**
```bash
npm install
npm run dev      # runs with nodemon (auto-reload on file changes)
```

**Run production:**
```bash
npm start        # runs server.js directly
```

**Test:**
```bash
npm test         # run all tests in tests/*.test.js
```

**Docker (recommended for deployment):**
```bash
npm install --omit=dev  # required before building image
docker compose up -d --build    # build and run
docker compose logs -f          # watch logs
docker compose down             # stop
```

The app serves on http://localhost:3000

## Architecture Overview

### Data Flow
1. **Big screen** opens the setup page (`/index.html`) → creates a game via `POST /api/games` → displays the scoreboard (`/display/:gameId`)
2. **Mobile phones** scan the QR code (generated at `/api/games/:gameId/join-qr`) → lands on `/join/:gameId` → player picks their name → enters throw screen (`/play/:gameId/:playerId`)
3. All clients connect via Socket.IO to receive real-time `gameUpdate` events as the game state changes

### Key Files

**Server-side:**
- `server.js` — Express app, REST API endpoints, Socket.IO, in-memory `games` store
- `gameLogic.js` — Pure game logic: player creation, throw processing, win condition checking

**Client-side:**
- `public/index.html` — Setup page (enter player names, create game)
- `public/display.html` — Big screen scoreboard
- `public/join.html` — Mobile player join selection page
- `public/mobile.html` — Throw screen (the main play interface for a player)

**Tests:**
- `tests/gameLogic.test.js` — Unit tests for game logic functions
- `tests/server.test.js` — Integration tests for API endpoints and Socket.IO

### Game State Structure

Games are stored in-memory in `games[gameId]` on the server:
```javascript
{
  id: string (UUID),
  players: Player[],           // each with id, name, marks{}, score
  currentPlayerIndex: number,  // whose turn it is
  dartsThrown: number,         // 0–3 per turn
  turnHistory: [],             // record of all past turns
  currentTurnThrows: [],       // throws in the current turn
  gameOver: boolean,
  winnerId: string (or null),
  createdAt: timestamp
}
```

## Cut Throat Rules & Game Logic

**Targets:** 15, 16, 17, 18, 19, 20, Bull (25)
**To close:** 3 marks (1 = single, 2 = double, 3 = triple)
**Scoring:** After closing, overflow marks add points to opponents who haven't closed it. Points = number of marks × target value (e.g., double 20 = 40 points to each opponent without it closed).
**Win condition:** First player to close all targets **AND** have the lowest score.

Key functions in `gameLogic.js`:
- `createPlayer(id, name)` — Initialize a player with marks/score
- `processThrow(players, currentPlayerIndex, target, multiplier)` — Handle a dart hit, update marks and scores
- `checkWinCondition(players)` — Determine if game is over and who won
- `isClosed(player, target)` — Check if a player closed a specific target
- `isTargetClosedByAll(players, target)` — Check if all players closed a target

## Important Implementation Details

### REST API
- `POST /api/games` — Create game from array of player names (2–8 players)
- `GET /api/games/:gameId` — Fetch current game state
- `POST /api/games/:gameId/throw` — Record a dart throw; auto-validates turn ownership and game state
- `POST /api/games/:gameId/end-turn` — End current player's turn and advance to next player
- `GET /api/games/:gameId/join-qr` — Generate SVG QR code pointing to `/join/:gameId` (respects X-Forwarded-Proto/Host headers for proxied environments)

### Socket.IO
- Client joins a room with `joinGame({ gameId })` on connection
- Server broadcasts `gameUpdate` to all clients in that game's room whenever state changes
- Real-time scoreboard sync across all devices

### Input Validation
- Player names are sanitized: trimmed to 30 chars, HTML special chars removed
- Targets validated against `TARGETS` constant; 0 = miss (no effect)
- Multipliers must be 1, 2, or 3
- Turn ownership checked: only the current player can throw

### Rate Limiting
- Page loads limited to 120 per minute per IP (protects `/`, `/display/:gameId`, `/join/:gameId`, `/play/:gameId/:playerId`)

### Deployment Notes
- Dockerfile uses Node 20 Alpine, runs as non-root user `darts`
- Entrypoint: `npm install --omit=dev` must be run on the host **before** `docker build` (node_modules are copied into image, not installed inside)
- PORT defaults to 3000 (can override with env var)
- Games stored in-memory: restarting the server clears all active games

## Testing

Jest is configured with:
- `testEnvironment: node`
- `testMatch: **/tests/**/*.test.js`

Tests use supertest for HTTP assertions and import game logic directly for unit testing. Run with `npm test`.

## Frontend Architecture

Each HTML page uses vanilla JS with Socket.IO for real-time updates:
- **index.html** — Form submission → `POST /api/games` → redirects to display
- **display.html** — Joins via Socket.IO, listens for `gameUpdate`, renders scoreboard with QR code
- **join.html** — Joins via Socket.IO, displays player names as clickable buttons → redirects to mobile play screen
- **mobile.html** — Joins via Socket.IO, shows throw interface (target buttons, multiplier selector, throw/end-turn buttons)

Each page fetches its own game state on load via `GET /api/games/:gameId` and then stays in sync with Socket.IO.
