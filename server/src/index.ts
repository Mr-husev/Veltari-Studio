import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager } from './rooms/roomManager.js';
import { ClientToServerEvents, ServerToClientEvents } from './types/game.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // Create Room
  socket.on('create_room', ({ nickname, avatar, gameType, cardSubtype }, callback) => {
    try {
      const { room, hostPlayer } = roomManager.createRoom(socket.id, { nickname, avatar, gameType, cardSubtype });
      socket.join(room.code);
      console.log(`[Room Created] Code: ${room.code} (${room.cardSubtype || room.gameType}) by ${hostPlayer.nickname}`);

      callback({
        success: true,
        roomCode: room.code,
        playerId: hostPlayer.id
      });

      // Broadcast public view to room
      io.to(room.code).emit('room_updated', roomManager.getPublicRoomView(room));
    } catch (err: any) {
      console.error('[Error create_room]', err);
      callback({ success: false, error: err.message });
    }
  });

  // Join Room
  socket.on('join_room', ({ roomCode, nickname, avatar, playerId }, callback) => {
    try {
      const result = roomManager.joinRoom(socket.id, { roomCode, nickname, avatar, playerId });
      if (!result.success || !result.room || !result.player) {
        return callback({ success: false, error: result.error });
      }

      socket.join(result.room.code);
      console.log(`[Player Joined] Room: ${result.room.code}, Player: ${result.player.nickname}`);

      callback({
        success: true,
        room: result.room,
        playerId: result.player.id
      });

      // Broadcast updated room state to all players in the room
      io.to(result.room.code).emit('room_updated', roomManager.getPublicRoomView(result.room));

      // If player had a hand (reconnecting), send private hand back
      if (result.player.hand && result.player.hand.length > 0) {
        socket.emit('private_hand_updated', result.player.hand);
      }
    } catch (err: any) {
      console.error('[Error join_room]', err);
      callback({ success: false, error: err.message });
    }
  });

  // Host starts game
  socket.on('start_game', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.startGame(roomCode, player.id);
    if (!result.success || !result.room) {
      socket.emit('error_notification', { message: result.error || 'Erreur au démarrage' });
      return;
    }

    // Broadcast public state
    io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(result.room));

    // Send each player their secret private hand / dominoes
    for (const p of result.room.players) {
      if (result.room.gameType === 'cards' && p.hand) {
        io.to(p.socketId).emit('private_hand_updated', p.hand);
      } else if (result.room.gameType === 'dominoes' && p.dominoHand) {
        io.to(p.socketId).emit('private_dominoes_updated', p.dominoHand);
      }
    }

    const currentTurnPlayer = result.room.players.find(p => p.id === result.room?.gameState.currentTurnPlayerId);
    io.to(roomCode).emit('turn_announcement', {
      playerId: currentTurnPlayer?.id || '',
      playerNickname: currentTurnPlayer?.nickname || '',
      message: `À ton tour, ${currentTurnPlayer?.nickname} ! / Your turn, ${currentTurnPlayer?.nickname}!`
    });
  });

  // Select game type (from Dock)
  socket.on('select_game', ({ roomCode, gameType, cardSubtype }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const success = roomManager.switchGame(roomCode, gameType, player.id, cardSubtype);
    if (success) {
      const room = roomManager.getRoom(roomCode);
      if (room) {
        io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
      }
    }
  });

  // ==================== LUDO SOCKET EVENTS ====================

  socket.on('roll_dice', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.rollLudoDice(roomCode, player.id);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Impossible de lancer le dé' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (room) {
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  socket.on('move_pawn', ({ roomCode, pawnId }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.moveLudoPawn(roomCode, player.id, pawnId);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Déplacement impossible' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (room) {
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  // ==================== DOMINO SOCKET EVENTS ====================

  socket.on('play_domino', ({ roomCode, dominoId, end }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.playDomino(roomCode, player.id, dominoId, end);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Pose de domino impossible' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (room) {
      socket.emit('private_dominoes_updated', player.dominoHand || []);
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  socket.on('draw_domino', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.drawDomino(roomCode, player.id);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Talon vide' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (room) {
      socket.emit('private_dominoes_updated', player.dominoHand || []);
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  socket.on('pass_turn', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.passDominoTurn(roomCode, player.id);
    if (!result.success) return;

    const room = roomManager.getRoom(roomCode);
    if (room) {
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  // ==================== PARTY GAMES SOCKET EVENTS ====================
  socket.on('party_game_action', ({ roomCode, action, payload }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.handlePartyGameAction(roomCode, player.id, action, payload);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Action impossible' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (room) {
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
    }
  });

  // ==================== CARD SOCKET EVENTS ====================

  // Play Card (from private hand with swipe up)
  socket.on('play_card', ({ roomCode, cardId }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.playCard(roomCode, player.id, cardId);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Action impossible' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (!room) return;

    // Send updated private hand to player
    socket.emit('private_hand_updated', player.hand || []);

    // Broadcast updated public table
    io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));

    const currentTurnPlayer = room.players.find(p => p.id === room.gameState.currentTurnPlayerId);
    if (currentTurnPlayer) {
      io.to(roomCode).emit('turn_announcement', {
        playerId: currentTurnPlayer.id,
        playerNickname: currentTurnPlayer.nickname,
        message: `À ton tour, ${currentTurnPlayer.nickname} ! / Your turn, ${currentTurnPlayer.nickname}!`
      });
    }
  });

  // Draw Card
  socket.on('draw_card', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    if (!player) return;

    const result = roomManager.drawCard(roomCode, player.id);
    if (!result.success) {
      socket.emit('error_notification', { message: result.error || 'Impossible de piocher' });
      return;
    }

    const room = roomManager.getRoom(roomCode);
    if (!room) return;

    // Send updated private hand
    socket.emit('private_hand_updated', player.hand || []);

    // Broadcast room update
    io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));

    const currentTurnPlayer = room.players.find(p => p.id === room.gameState.currentTurnPlayerId);
    if (currentTurnPlayer) {
      io.to(roomCode).emit('turn_announcement', {
        playerId: currentTurnPlayer.id,
        playerNickname: currentTurnPlayer.nickname,
        message: `À ton tour, ${currentTurnPlayer.nickname} ! / Your turn, ${currentTurnPlayer.nickname}!`
      });
    }
  });

  // Leave room
  socket.on('leave_room', ({ roomCode }) => {
    const { player } = roomManager.getPlayerBySocket(socket.id);
    socket.leave(roomCode);
    const { player: disconnectedPlayer } = roomManager.handleDisconnect(socket.id);
    const room = roomManager.getRoom(roomCode);
    if (room && disconnectedPlayer) {
      io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
      io.to(roomCode).emit('player_left', {
        playerId: disconnectedPlayer.id,
        nickname: disconnectedPlayer.nickname
      });
    }
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
    const { roomCode, player } = roomManager.handleDisconnect(socket.id);
    if (roomCode && player) {
      const room = roomManager.getRoom(roomCode);
      if (room) {
        io.to(roomCode).emit('room_updated', roomManager.getPublicRoomView(room));
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Veltari Server] Running on http://localhost:${PORT}`);
});
