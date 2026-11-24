const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const engine = require('./gameEngine');
const botEngine = require('./botEngine');

const PORT = Number(process.env.PORT) || 3040;
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS) || 15 * 60 * 1000;
const ROOM_STALE_MS = Number(process.env.ROOM_STALE_MS) || 60 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = Math.min(30000, Math.max(1000, Math.floor(IDLE_TIMEOUT_MS / 3)));
const BOT_NAMES = ['秋葉原大王 Bot', '同人壁攤大手 Bot', '課金石油王 Bot', '傳說痛車主 Bot', '全婆俠收藏家 Bot'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
// Long browser cache for static images (cards/avatars) to minimize Cloud Run egress traffic
app.use(
  '/assets',
  express.static(path.join(__dirname, 'public', 'assets'), {
    maxAge: '365d',
    immutable: true,
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    list.push({
      code: room.code,
      hostName: room.seats.find((s) => s.id === room.hostSessionId)?.name || '未知房主',
      playerCount: room.seats.length,
      maxPlayers: 5,
      started: Boolean(room.game),
      phase: room.game ? room.game.phase : 'WAITING',
      season: room.game ? room.game.season : 0,
    });
  }
  return list;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    connectedSockets: io.sockets.sockets.size,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    uptime: process.uptime(),
  });
});

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: getRoomList() });
});

app.get('/api/avatar/:seed', (req, res) => {
  const seed = String(req.params.seed || 'guest').slice(0, 64);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const avatarIndex = hash % 10;
  const avatarPath = path.join(__dirname, 'public', 'assets', 'avatars', `avatar_${avatarIndex}.png`);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(avatarPath);
});

function getSanitizedRoomPayload(room, viewerSessionId) {
  const mySeatIndex = room.seats.findIndex((s) => s.id === viewerSessionId);
  return {
    code: room.code,
    hostSessionId: room.hostSessionId,
    isHost: room.hostSessionId === viewerSessionId,
    mySessionId: viewerSessionId,
    mySeatIndex,
    seats: room.seats.map((s, idx) => ({
      id: s.id,
      name: s.name,
      isAI: s.isAI,
      connected: s.isAI ? true : s.connected,
      seatIndex: idx,
    })),
    chat: room.chat,
    game: room.game ? engine.getSanitizedState(room.game, viewerSessionId) : null,
  };
}

async function broadcastRoomState(room) {
  const now = Date.now();
  room.lastActivityAt = now;
  const sockets = await io.in(room.code).fetchSockets();
  for (const sock of sockets) {
    sock.data.lastActivityAt = now;
    const sessionId = sock.data.sessionId || sock.id;
    sock.emit('room_state', getSanitizedRoomPayload(room, sessionId));
  }
  io.emit('rooms_updated', { rooms: getRoomList() });
}

function scheduleBotStep(room, delayMs = 700) {
  if (!room.game) return;
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  if (
    room.game.phase === 'GAME_OVER' ||
    room.game.phase === 'SEASON_SETTLEMENT'
  ) {
    return;
  }

  room.botTimer = setTimeout(async () => {
    room.botTimer = null;
    if (!rooms.has(room.code) || !room.game) return;
    try {
      const acted = botEngine.performBotStep(room.game);
      if (acted) {
        await broadcastRoomState(room);
        scheduleBotStep(room, 650);
      }
    } catch (err) {
      console.error(`[Bot error in room ${room.code}]`, err);
    }
  }, delayMs);
}

function getPlayerIndexInRoom(room, sessionId) {
  if (!room.game) return -1;
  return room.game.players.findIndex((p) => p.id === sessionId);
}

function sanitizeName(name, fallback = '畫廊收藏家') {
  const clean = String(name || '').trim().slice(0, 18);
  return clean || fallback;
}

io.on('connection', (socket) => {
  socket.data.lastActivityAt = Date.now();
  socket.onAny(() => {
    socket.data.lastActivityAt = Date.now();
  });
  socket.emit('rooms_updated', { rooms: getRoomList() });

  socket.on('create_room', async (payload = {}, ack) => {
    try {
      const sessionId = String(payload.sessionId || socket.id).slice(0, 64);
      const playerName = sanitizeName(payload.playerName, '畫廊主人');
      const code = generateRoomCode();

      const room = {
        code,
        hostSessionId: sessionId,
        seats: [
          {
            id: sessionId,
            name: playerName,
            isAI: false,
            connected: true,
          },
        ],
        game: null,
        chat: [
          {
            id: Date.now(),
            sender: '系統',
            text: `${playerName} 建立了拍賣廳 (${code})，等待玩家加入中（需 3～5 人）。`,
            system: true,
          },
        ],
        botTimer: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      rooms.set(code, room);
      socket.data.sessionId = sessionId;
      socket.data.roomCode = code;
      await socket.join(code);
      await broadcastRoomState(room);
      if (typeof ack === 'function') ack({ ok: true, roomCode: code });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('join_room', async (payload = {}, ack) => {
    try {
      const code = String(payload.roomCode || '').trim().toUpperCase();
      const sessionId = String(payload.sessionId || socket.id).slice(0, 64);
      const playerName = sanitizeName(payload.playerName, '鑑賞家');

      const room = rooms.get(code);
      if (!room) {
        throw new Error(`找不到房號 ${code}`);
      }

      const existingSeat = room.seats.find((s) => s.id === sessionId);
      if (existingSeat) {
        existingSeat.connected = true;
        if (!room.game && payload.playerName) {
          existingSeat.name = playerName;
        }
      } else {
        if (room.game) {
          throw new Error('該房間的遊戲已經開始，無法新加入');
        }
        if (room.seats.length >= 5) {
          throw new Error('房間已滿（最多 5 位玩家）');
        }
        room.seats.push({
          id: sessionId,
          name: playerName,
          isAI: false,
          connected: true,
        });
        room.chat.push({
          id: Date.now() + Math.random(),
          sender: '系統',
          text: `${playerName} 進入了拍賣廳。`,
          system: true,
        });
      }

      socket.data.sessionId = sessionId;
      socket.data.roomCode = code;
      await socket.join(code);
      await broadcastRoomState(room);
      if (typeof ack === 'function') ack({ ok: true, roomCode: code });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('leave_room', async (_payload, ack) => {
    const code = socket.data.roomCode;
    const sessionId = socket.data.sessionId;
    if (!code || !rooms.has(code)) {
      if (typeof ack === 'function') ack({ ok: true });
      return;
    }

    const room = rooms.get(code);
    await socket.leave(code);
    socket.data.roomCode = null;

    if (!room.game) {
      room.seats = room.seats.filter((s) => s.id !== sessionId);
      const remainingHumans = room.seats.filter((s) => !s.isAI);
      if (remainingHumans.length === 0) {
        if (room.botTimer) clearTimeout(room.botTimer);
        rooms.delete(code);
        io.emit('rooms_updated', { rooms: getRoomList() });
      } else {
        if (room.hostSessionId === sessionId) {
          room.hostSessionId = remainingHumans[0].id;
        }
        await broadcastRoomState(room);
      }
    } else {
      const seat = room.seats.find((s) => s.id === sessionId);
      if (seat) seat.connected = false;
      await broadcastRoomState(room);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('add_bot', async (_payload, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('尚未加入房間');
      if (room.hostSessionId !== socket.data.sessionId) throw new Error('只有房主可以新增電腦 AI');
      if (room.game) throw new Error('遊戲已經開始');
      if (room.seats.length >= 5) throw new Error('房間已達上限 5 人');

      const usedNames = new Set(room.seats.map((s) => s.name));
      const botName = BOT_NAMES.find((n) => !usedNames.has(n)) || `AI 畫商 #${room.seats.length}`;
      const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      room.seats.push({ id: botId, name: botName, isAI: true, connected: true });
      room.chat.push({ id: Date.now(), sender: '系統', text: `已加入電腦對手 ${botName}。`, system: true });

      await broadcastRoomState(room);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('remove_bot', async (payload = {}, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('尚未加入房間');
      if (room.hostSessionId !== socket.data.sessionId) throw new Error('只有房主可以移除電腦 AI');
      if (room.game) throw new Error('遊戲已經開始');

      const botId = payload.botId;
      let idx = -1;
      if (botId) {
        idx = room.seats.findIndex((s) => s.id === botId && s.isAI);
      } else {
        for (let i = room.seats.length - 1; i >= 0; i--) {
          if (room.seats[i].isAI) {
            idx = i;
            break;
          }
        }
      }
      if (idx === -1) throw new Error('目前沒有可移除的電腦 AI');

      const [removed] = room.seats.splice(idx, 1);
      room.chat.push({ id: Date.now(), sender: '系統', text: `已移除 ${removed.name}。`, system: true });
      await broadcastRoomState(room);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('start_game', async (_payload, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('尚未加入房間');
      if (room.hostSessionId !== socket.data.sessionId) throw new Error('只有房主可以開始遊戲');
      if (room.seats.length < 3 || room.seats.length > 5) {
        throw new Error('需要 3 到 5 位玩家才能開始遊戲');
      }

      room.game = engine.createGame(room.seats);
      await broadcastRoomState(room);
      scheduleBotStep(room, 750);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('restart_game', async (_payload, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('尚未加入房間');
      if (room.hostSessionId !== socket.data.sessionId) throw new Error('只有房主可以重新開局');
      if (room.botTimer) {
        clearTimeout(room.botTimer);
        room.botTimer = null;
      }
      room.game = engine.createGame(room.seats);
      await broadcastRoomState(room);
      scheduleBotStep(room, 750);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  function withGameAction(handler) {
    return async (payload = {}, ack) => {
      try {
        const room = rooms.get(socket.data.roomCode);
        if (!room || !room.game) throw new Error('遊戲尚未開始');
        const playerIndex = getPlayerIndexInRoom(room, socket.data.sessionId);
        if (playerIndex === -1) throw new Error('你不是此對戰的參賽玩家');

        handler(room, playerIndex, payload);
        await broadcastRoomState(room);
        scheduleBotStep(room, 650);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    };
  }

  socket.on('play_card', withGameAction((room, playerIndex, payload) => {
    engine.playCard(room.game, playerIndex, payload.cardId);
  }));

  socket.on('double_response', withGameAction((room, playerIndex, payload) => {
    engine.respondDouble(room.game, playerIndex, {
      cardId: payload.cardId || null,
      pass: Boolean(payload.pass),
    });
  }));

  socket.on('place_bid', withGameAction((room, playerIndex, payload) => {
    engine.placeBid(room.game, playerIndex, {
      amount: payload.amount,
      pass: Boolean(payload.pass),
    });
  }));

  socket.on('submit_hidden_bid', withGameAction((room, playerIndex, payload) => {
    engine.submitHiddenBid(room.game, playerIndex, payload.amount);
  }));

  socket.on('set_fixed_price', withGameAction((room, playerIndex, payload) => {
    engine.setFixedPrice(room.game, playerIndex, payload.price);
  }));

  socket.on('buy_fixed_price', withGameAction((room, playerIndex, payload) => {
    engine.buyFixedPrice(room.game, playerIndex, Boolean(payload.buy));
  }));

  socket.on('confirm_hidden_reveal', withGameAction((room, playerIndex) => {
    engine.confirmHiddenReveal(room.game, playerIndex);
  }));

  socket.on('next_season', withGameAction((room) => {
    engine.startNextSeason(room.game);
  }));

  socket.on('send_chat', async (payload = {}, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('尚未加入房間');
      const seat = room.seats.find((s) => s.id === socket.data.sessionId);
      if (!seat) throw new Error('非房間成員');
      const text = String(payload.text || '').trim().slice(0, 200);
      if (!text) return;

      room.chat.push({
        id: Date.now() + Math.random(),
        sender: seat.name,
        text,
        system: false,
      });
      if (room.chat.length > 80) room.chat.shift();
      await broadcastRoomState(room);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    const code = socket.data.roomCode;
    const sessionId = socket.data.sessionId;
    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    const seat = room.seats.find((s) => s.id === sessionId);
    if (seat) {
      // Check if another socket with the same sessionId is still connected
      const sockets = await io.in(code).fetchSockets();
      const stillOnline = sockets.some((s) => s.data.sessionId === sessionId);
      if (!stillOnline) {
        seat.connected = false;
        await broadcastRoomState(room);
      }
    }
  });
});

// Check open auction and hidden reveal countdown expiry every 500ms
setInterval(async () => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (
      room.game &&
      (engine.checkOpenAuctionTimeout(room.game, now) ||
        engine.checkHiddenRevealTimeout(room.game, now))
    ) {
      await broadcastRoomState(room);
      scheduleBotStep(room, 650);
    }
  }
}, 500);

// Disconnect idle sockets and prune abandoned rooms so Cloud Run can scale to zero
setInterval(() => {
  const now = Date.now();
  for (const sock of io.sockets.sockets.values()) {
    if (sock.data.idleDisconnecting) continue;
    const lastActive = sock.data.lastActivityAt || now;
    if (now - lastActive >= IDLE_TIMEOUT_MS) {
      sock.data.idleDisconnecting = true;
      sock.emit('idle_disconnect', {
        idleMinutes: Math.max(1, Math.round(IDLE_TIMEOUT_MS / 60000)),
      });
      setTimeout(() => {
        if (sock.connected) sock.disconnect(true);
      }, 150);
    }
  }

  let roomsPruned = false;
  for (const [code, room] of rooms.entries()) {
    const hasOnlineHuman = room.seats.some((s) => !s.isAI && s.connected);
    const lastActive = room.lastActivityAt || room.createdAt || now;
    if (!hasOnlineHuman && now - lastActive >= ROOM_STALE_MS) {
      if (room.botTimer) clearTimeout(room.botTimer);
      rooms.delete(code);
      roomsPruned = true;
    }
  }
  if (roomsPruned) {
    io.emit('rooms_updated', { rooms: getRoomList() });
  }
}, IDLE_CHECK_INTERVAL_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Modern Art Online server listening on http://localhost:${PORT}`);
});

function gracefulShutdown() {
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
