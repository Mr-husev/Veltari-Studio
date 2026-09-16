import { Room, Player, Card, GameType, AvatarId, GameState, DominoTile, DominoChainTile, LudoPawn } from '../types/game.js';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private socketMap: Map<string, { roomCode: string; playerId: string }> = new Map();
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  // Helper to generate a 4-digit PIN code
  private generatePinCode(): string {
    let code: string;
    let attempts = 0;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
      attempts++;
    } while (this.rooms.has(code) && attempts < 1000);
    return code;
  }

  // Build deck of cards (UNO style)
  private createCardDeck(): Card[] {
    const colors: ('blue' | 'yellow' | 'green' | 'red')[] = ['blue', 'yellow', 'green', 'red'];
    const cards: Card[] = [];
    let idCounter = 1;

    for (const color of colors) {
      for (let i = 0; i <= 9; i++) {
        cards.push({
          id: `card_${idCounter++}`,
          color,
          value: i.toString(),
          label: i.toString()
        });
        if (i !== 0) {
          cards.push({
            id: `card_${idCounter++}`,
            color,
            value: i.toString(),
            label: i.toString()
          });
        }
      }
      ['reverse', 'skip', '+2'].forEach((action) => {
        cards.push({
          id: `card_${idCounter++}`,
          color,
          value: action,
          label: action === 'reverse' ? '🔄' : action === 'skip' ? '🚫' : '+2'
        });
        cards.push({
          id: `card_${idCounter++}`,
          color,
          value: action,
          label: action === 'reverse' ? '🔄' : action === 'skip' ? '🚫' : '+2'
        });
      });
    }

    // Shuffle deck
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    return cards;
  }

  // Build full set of 28 Dominoes (Double-Six: [0|0] to [6|6])
  private createDominoSet(): DominoTile[] {
    const tiles: DominoTile[] = [];
    let id = 1;
    for (let left = 0; left <= 6; left++) {
      for (let right = left; right <= 6; right++) {
        tiles.push({
          id: `dom_${id++}`,
          left,
          right
        });
      }
    }
    // Shuffle tiles
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return tiles;
  }

  public createRoom(
    socketId: string,
    hostData: { nickname: string; avatar: AvatarId; gameType?: GameType; cardSubtype?: any }
  ): { room: Room; hostPlayer: Player } {
    const code = this.generatePinCode();
    const hostId = `player_${Math.random().toString(36).substring(2, 9)}`;

    const hostPlayer: Player = {
      id: hostId,
      socketId,
      nickname: hostData.nickname || 'Host',
      avatar: hostData.avatar || 'panda',
      isHost: true,
      isOnline: true,
      score: 0,
      cardCount: 0,
      dominoCount: 0,
      hand: [],
      dominoHand: [],
      connectedAt: Date.now()
    };

    const initialGameState: GameState = {
      gameType: hostData.gameType || 'cards',
      cardSubtype: hostData.cardSubtype || 'uno',
      status: 'waiting',
      direction: 1,
      discardPileCount: 0,
      drawPileCount: 0
    };

    const room: Room = {
      code,
      hostId,
      gameType: hostData.gameType || 'cards',
      cardSubtype: hostData.cardSubtype || 'uno',
      players: [hostPlayer],
      gameState: initialGameState,
      createdAt: Date.now()
    };

    this.rooms.set(code, room);
    this.socketMap.set(socketId, { roomCode: code, playerId: hostId });

    return { room, hostPlayer };
  }

  public joinRoom(
    socketId: string,
    payload: { roomCode: string; nickname: string; avatar: AvatarId; playerId?: string }
  ): { success: boolean; room?: Room; player?: Player; error?: string } {
    const room = this.rooms.get(payload.roomCode.trim().toUpperCase());
    if (!room) {
      return { success: false, error: 'Salon introuvable / Room not found' };
    }

    // Check if player is reconnecting
    if (payload.playerId) {
      const existingPlayer = room.players.find(p => p.id === payload.playerId);
      if (existingPlayer) {
        existingPlayer.socketId = socketId;
        existingPlayer.isOnline = true;
        existingPlayer.lastDisconnectedAt = undefined;

        if (this.disconnectTimers.has(existingPlayer.id)) {
          clearTimeout(this.disconnectTimers.get(existingPlayer.id)!);
          this.disconnectTimers.delete(existingPlayer.id);
        }

        this.socketMap.set(socketId, { roomCode: room.code, playerId: existingPlayer.id });
        return { success: true, room, player: existingPlayer };
      }
    }

    if (room.players.length >= 4 && (room.gameType === 'ludo' || room.gameType === 'dominoes')) {
      return { success: false, error: 'Salon complet (max 4 joueurs pour ce jeu) / Room is full' };
    }

    if (room.players.length >= 6) {
      return { success: false, error: 'Salon complet (max 6 joueurs) / Room is full' };
    }

    const newPlayerId = `player_${Math.random().toString(36).substring(2, 9)}`;
    const newPlayer: Player = {
      id: newPlayerId,
      socketId,
      nickname: payload.nickname.trim() || `Joueur ${room.players.length + 1}`,
      avatar: payload.avatar,
      isHost: false,
      isOnline: true,
      score: 0,
      cardCount: 0,
      dominoCount: 0,
      hand: [],
      dominoHand: [],
      connectedAt: Date.now()
    };

    room.players.push(newPlayer);
    this.socketMap.set(socketId, { roomCode: room.code, playerId: newPlayerId });

    return { success: true, room, player: newPlayer };
  }

  public startGame(roomCode: string, playerId: string): { success: boolean; room?: Room; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Salon inexistant' };
    if (room.hostId !== playerId) return { success: false, error: 'Seul l’hôte peut démarrer la partie' };
    if (room.players.length < 1) return { success: false, error: 'Pas assez de joueurs' };

    // --- GAME TYPE 1: CARDS ---
    if (room.gameType === 'cards') {
      const deck = this.createCardDeck();
      const HAND_SIZE = 5;

      for (const player of room.players) {
        player.hand = deck.splice(0, HAND_SIZE);
        player.cardCount = player.hand.length;
      }

      let topCard = deck.pop();
      while (topCard && topCard.value === '+4') {
        deck.unshift(topCard);
        topCard = deck.pop();
      }

      room.gameState = {
        gameType: 'cards',
        cardSubtype: room.cardSubtype || 'uno',
        status: 'in_progress',
        currentTurnPlayerId: room.players[0].id,
        direction: 1,
        topCard: topCard || { id: 'c_start', color: 'blue', value: '7', label: '7' },
        discardPileCount: 1,
        drawPileCount: deck.length
      };

      (room as any)._drawDeck = deck;
      return { success: true, room };
    }

    // --- GAME TYPE 2: PARCHISI / LUDO ---
    if (room.gameType === 'ludo') {
      const colors: ('blue' | 'green' | 'red' | 'yellow')[] = ['blue', 'green', 'red', 'yellow'];
      const allPawns: LudoPawn[] = [];

      room.players.forEach((player, pIdx) => {
        const color = colors[pIdx % 4];
        for (let i = 0; i < 4; i++) {
          allPawns.push({
            id: `pawn_${player.id}_${i}`,
            playerId: player.id,
            color,
            colorIndex: pIdx % 4,
            position: -1, // in base
            stepCount: 0,
            isHome: false
          });
        }
      });

      room.gameState = {
        gameType: 'ludo',
        status: 'in_progress',
        currentTurnPlayerId: room.players[0].id,
        direction: 1,
        discardPileCount: 0,
        drawPileCount: 0,
        ludoState: {
          lastDiceRoll: undefined,
          canRollDice: true,
          movablePawnIds: [],
          pawns: allPawns,
          extraTurn: false
        }
      };

      return { success: true, room };
    }

    // --- GAME TYPE 3: DOMINOES ---
    if (room.gameType === 'dominoes') {
      const allTiles = this.createDominoSet();
      const TILES_PER_PLAYER = room.players.length === 2 ? 7 : 5;

      for (const player of room.players) {
        player.dominoHand = allTiles.splice(0, TILES_PER_PLAYER);
        player.dominoCount = player.dominoHand.length;
      }

      room.gameState = {
        gameType: 'dominoes',
        status: 'in_progress',
        currentTurnPlayerId: room.players[0].id,
        direction: 1,
        discardPileCount: 0,
        drawPileCount: allTiles.length,
        dominoState: {
          chain: [],
          openEnds: [-1, -1],
          boneyardCount: allTiles.length
        }
      };

      (room as any)._boneyard = allTiles;
      return { success: true, room };
    }

    // --- GAME TYPE 4: CONNECT 4 ---
    if (room.gameType === 'connect4') {
      const board = Array(6).fill(null).map(() => Array(7).fill(null));
      room.gameState = {
        gameType: 'connect4',
        status: 'in_progress',
        currentTurnPlayerId: room.players[0].id,
        direction: 1,
        discardPileCount: 0,
        drawPileCount: 0,
        connect4State: { board }
      };
      return { success: true, room };
    }

    // --- GAME TYPE 5: WEREWOLF ---
    if (room.gameType === 'werewolf') {
      // Need at least 3 players ideally, but allow 1 for testing
      const { assignWerewolfRoles } = require('./gameHelpers.js');
      const roles = assignWerewolfRoles(room.players.map(p => p.id));
      room.gameState = {
        gameType: 'werewolf',
        status: 'in_progress',
        direction: 1,
        discardPileCount: 0,
        drawPileCount: 0,
        werewolfState: {
          phase: 'setup',
          roles,
          alivePlayers: room.players.map(p => p.id),
          votes: {},
          logs: ['Le village se réveille.'],
          chat: [],
          witchHealUsed: false,
          witchKillUsed: false
        }
      };
      return { success: true, room };
    }

    // --- GAME TYPE 6: TRUTH OR DARE ---
    if (room.gameType === 'truth_or_dare') {
      room.gameState = {
        gameType: 'truth_or_dare',
        status: 'in_progress',
        direction: 1,
        discardPileCount: 0,
        drawPileCount: 0,
        truthOrDareState: {}
      };
      return { success: true, room };
    }

    // --- GAME TYPE 7: YAMS ---
    if (room.gameType === 'yams') {
      const scores: Record<string, any> = {};
      room.players.forEach(p => {
        scores[p.id] = {}; // empty scores means not filled yet
      });
      room.gameState = {
        gameType: 'yams',
        status: 'in_progress',
        currentTurnPlayerId: room.players[0].id,
        direction: 1,
        discardPileCount: 0,
        drawPileCount: 0,
        yamsState: {
          dice: [1, 1, 1, 1, 1],
          lockedDice: [false, false, false, false, false],
          rollsLeft: 3,
          scores
        }
      };
      return { success: true, room };
    }

    return { success: false, error: 'Type de jeu inconnu' };
  }

  // ==================== LUDO METHODS ====================

  public rollLudoDice(roomCode: string, playerId: string): { success: boolean; diceRoll?: number; movablePawnIds?: string[]; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState.ludoState) return { success: false, error: 'Partie Ludo introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };
    if (!room.gameState.ludoState.canRollDice) return { success: false, error: 'Dé déjà lancé pour ce tour' };

    const diceRoll = Math.floor(1 + Math.random() * 6);
    room.gameState.ludoState.lastDiceRoll = diceRoll;

    // Find movable pawns for current player
    const playerPawns = room.gameState.ludoState.pawns.filter(p => p.playerId === playerId);
    const movablePawnIds: string[] = [];

    for (const pawn of playerPawns) {
      if (pawn.isHome) continue;

      if (pawn.position === -1) {
        // Must roll a 6 to exit base
        if (diceRoll === 6) {
          movablePawnIds.push(pawn.id);
        }
      } else {
        // Pawn on track or in home stretch: cannot overshoot total steps 57 (home)
        if (pawn.stepCount + diceRoll <= 57) {
          movablePawnIds.push(pawn.id);
        }
      }
    }

    room.gameState.ludoState.movablePawnIds = movablePawnIds;
    room.gameState.ludoState.canRollDice = false;

    // If no moves are possible, automatically pass to next player (unless rolled 6)
    if (movablePawnIds.length === 0) {
      if (diceRoll !== 6) {
        const nextPlayerIdx = this.getNextPlayerIndex(room, 1);
        room.gameState.currentTurnPlayerId = room.players[nextPlayerIdx].id;
        room.gameState.ludoState.canRollDice = true;
      } else {
        // Rolled 6 but no moves -> gets another roll
        room.gameState.ludoState.canRollDice = true;
      }
    }

    return { success: true, diceRoll, movablePawnIds };
  }

  public moveLudoPawn(roomCode: string, playerId: string, pawnId: string): { success: boolean; captured?: boolean; won?: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState.ludoState) return { success: false, error: 'Partie introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const { ludoState } = room.gameState;
    const diceRoll = ludoState.lastDiceRoll;
    if (!diceRoll) return { success: false, error: 'Veuillez lancer le dé d’abord' };

    const pawn = ludoState.pawns.find(p => p.id === pawnId && p.playerId === playerId);
    if (!pawn) return { success: false, error: 'Pion introuvable' };

    let captured = false;
    const startSquares = [0, 13, 26, 39];

    if (pawn.position === -1) {
      // Exit base to start position
      if (diceRoll !== 6) return { success: false, error: 'Un 6 est requis pour sortir de la base' };
      pawn.position = startSquares[pawn.colorIndex];
      pawn.stepCount = 0;
    } else {
      // Advance stepCount
      const newStepCount = pawn.stepCount + diceRoll;
      if (newStepCount > 57) {
        return { success: false, error: 'Le dé dépasse la case d’arrivée' };
      }
      pawn.stepCount = newStepCount;

      if (newStepCount < 51) {
        // Still on main circular track (52 cases)
        const newPos = (startSquares[pawn.colorIndex] + newStepCount) % 52;
        pawn.position = newPos;

        // Check capture opponent pawns on same square (safe squares are 0, 13, 26, 39)
        const safeSquares = [0, 13, 26, 39];
        if (!safeSquares.includes(newPos)) {
          const opponentPawn = ludoState.pawns.find(
            p => p.position === newPos && p.playerId !== playerId && !p.isHome
          );
          if (opponentPawn) {
            opponentPawn.position = -1; // back to base!
            opponentPawn.stepCount = 0;
            captured = true;
          }
        }
      } else if (newStepCount < 57) {
        // Entered home stretch: 101 to 106
        pawn.position = 100 + (newStepCount - 50);
      } else {
        // Reached home victory center (stepCount === 57)
        pawn.position = 107;
        pawn.isHome = true;
      }
    }

    // Check victory: all 4 pawns home
    const playerPawns = ludoState.pawns.filter(p => p.playerId === playerId);
    const allHome = playerPawns.every(p => p.isHome || p.position === 107);
    if (allHome) {
      room.gameState.status = 'ended';
      room.gameState.winnerId = playerId;
      return { success: true, won: true, captured };
    }

    // Extra turn if rolled 6
    if (diceRoll === 6) {
      ludoState.canRollDice = true;
      ludoState.movablePawnIds = [];
      ludoState.lastDiceRoll = undefined;
    } else {
      const nextIdx = this.getNextPlayerIndex(room, 1);
      room.gameState.currentTurnPlayerId = room.players[nextIdx].id;
      ludoState.canRollDice = true;
      ludoState.movablePawnIds = [];
      ludoState.lastDiceRoll = undefined;
    }

    return { success: true, captured };
  }

  // ==================== DOMINOES METHODS ====================

  public playDomino(
    roomCode: string,
    playerId: string,
    dominoId: string,
    end: 'left' | 'right'
  ): { success: boolean; error?: string; isWinner?: boolean } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState.dominoState) return { success: false, error: 'Partie de Dominos introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.dominoHand) return { success: false, error: 'Joueur introuvable' };

    const tileIdx = player.dominoHand.findIndex(d => d.id === dominoId);
    if (tileIdx === -1) return { success: false, error: 'Domino introuvable dans votre main' };

    const tile = player.dominoHand[tileIdx];
    const { dominoState } = room.gameState;

    if (dominoState.chain.length === 0) {
      // First domino on table
      dominoState.chain.push({
        id: tile.id,
        left: tile.left,
        right: tile.right,
        orientation: tile.left === tile.right ? 'v' : 'h'
      });
      dominoState.openEnds = [tile.left, tile.right];
    } else {
      const [leftOpen, rightOpen] = dominoState.openEnds;

      if (end === 'left') {
        let placedTile: DominoChainTile;
        if (tile.right === leftOpen) {
          placedTile = { id: tile.id, left: tile.left, right: tile.right, orientation: tile.left === tile.right ? 'v' : 'h' };
          dominoState.openEnds[0] = tile.left;
        } else if (tile.left === leftOpen) {
          // Flip tile
          placedTile = { id: tile.id, left: tile.right, right: tile.left, orientation: tile.left === tile.right ? 'v' : 'h' };
          dominoState.openEnds[0] = tile.right;
        } else {
          return { success: false, error: 'Ce domino ne correspond pas à l’extrémité gauche' };
        }
        dominoState.chain.unshift(placedTile);
      } else {
        // end === 'right'
        let placedTile: DominoChainTile;
        if (tile.left === rightOpen) {
          placedTile = { id: tile.id, left: tile.left, right: tile.right, orientation: tile.left === tile.right ? 'v' : 'h' };
          dominoState.openEnds[1] = tile.right;
        } else if (tile.right === rightOpen) {
          // Flip tile
          placedTile = { id: tile.id, left: tile.right, right: tile.left, orientation: tile.left === tile.right ? 'v' : 'h' };
          dominoState.openEnds[1] = tile.left;
        } else {
          return { success: false, error: 'Ce domino ne correspond pas à l’extrémité droite' };
        }
        dominoState.chain.push(placedTile);
      }
    }

    // Remove from hand
    player.dominoHand.splice(tileIdx, 1);
    player.dominoCount = player.dominoHand.length;

    // Check win condition
    if (player.dominoHand.length === 0) {
      room.gameState.status = 'ended';
      room.gameState.winnerId = player.id;
      player.score += 25;
      return { success: true, isWinner: true };
    }

    // Reset consecutive passes count
    dominoState.consecutivePasses = 0;

    // Next player turn
    const nextIdx = this.getNextPlayerIndex(room, 1);
    room.gameState.currentTurnPlayerId = room.players[nextIdx].id;

    return { success: true };
  }

  public drawDomino(roomCode: string, playerId: string): { success: boolean; drawnTile?: DominoTile; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState.dominoState) return { success: false, error: 'Partie introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.dominoHand) return { success: false, error: 'Joueur introuvable' };

    const boneyard: DominoTile[] = (room as any)._boneyard || [];
    if (boneyard.length === 0) {
      return { success: false, error: 'Le talon est vide' };
    }

    const drawnTile = boneyard.pop()!;
    player.dominoHand.push(drawnTile);
    player.dominoCount = player.dominoHand.length;
    room.gameState.dominoState.boneyardCount = boneyard.length;

    return { success: true, drawnTile };
  }

  public passDominoTurn(roomCode: string, playerId: string): { success: boolean; isBlocked?: boolean; winnerId?: string; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState.dominoState) return { success: false, error: 'Partie introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const { dominoState } = room.gameState;
    dominoState.consecutivePasses = (dominoState.consecutivePasses || 0) + 1;

    // Check if game is blocked: all active players passed consecutively and boneyard is empty
    if (dominoState.consecutivePasses >= room.players.length && dominoState.boneyardCount === 0) {
      dominoState.isBlocked = true;
      room.gameState.status = 'ended';

      // Find player with lowest pip total in hand
      let lowestScore = Infinity;
      let winnerId = room.players[0].id;

      for (const p of room.players) {
        const handPips = (p.dominoHand || []).reduce((sum, tile) => sum + tile.left + tile.right, 0);
        if (handPips < lowestScore) {
          lowestScore = handPips;
          winnerId = p.id;
        }
      }

      room.gameState.winnerId = winnerId;
      const winnerPlayer = room.players.find(p => p.id === winnerId);
      if (winnerPlayer) winnerPlayer.score += 15;

      return { success: true, isBlocked: true, winnerId };
    }

    const nextIdx = this.getNextPlayerIndex(room, 1);
    room.gameState.currentTurnPlayerId = room.players[nextIdx].id;
    return { success: true };
  }

  // ==================== PARTY GAMES METHODS ====================
  public handlePartyGameAction(roomCode: string, playerId: string, action: string, payload: any): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Partie introuvable' };

    // Some actions might be allowed out-of-turn or by specific roles, but for now we loosely check turn for most
    const isTurn = room.gameState.currentTurnPlayerId === playerId;

    if (room.gameType === 'connect4') {
      if (action === 'connect4_drop') {
        if (!isTurn) return { success: false, error: 'Ce n’est pas votre tour' };
        const state = room.gameState.connect4State!;
        const col = payload.col;
        
        // Find lowest empty row in col
        let placedRow = -1;
        for (let r = 5; r >= 0; r--) {
          if (!state.board[r][col]) {
            state.board[r][col] = playerId;
            placedRow = r;
            break;
          }
        }
        
        if (placedRow === -1) return { success: false, error: 'Colonne pleine' };

        // Save move for undo
        (state as any).lastMove = { playerId, row: placedRow, col };

        const { checkConnect4Win } = require('./gameHelpers.js');
        const win = checkConnect4Win(state.board);
        if (win) {
          state.winnerChips = win;
          room.gameState.status = 'ended';
          room.gameState.winnerId = playerId;
          const p = room.players.find(x => x.id === playerId);
          if (p) p.score += 50;
        } else {
          // Check draw
          const isDraw = state.board[0].every(c => c !== null);
          if (isDraw) {
            room.gameState.status = 'ended';
          } else {
            const nextIdx = this.getNextPlayerIndex(room, 1);
            room.gameState.currentTurnPlayerId = room.players[nextIdx].id;
          }
        }
        return { success: true };
      }

      if (action === 'connect4_undo') {
        const state = room.gameState.connect4State as any;
        if (!state.lastMove) return { success: false, error: 'Rien à annuler' };
        
        // Revert the board
        state.board[state.lastMove.row][state.lastMove.col] = null;
        room.gameState.currentTurnPlayerId = state.lastMove.playerId;
        state.lastMove = null;
        return { success: true };
      }
    }

    if (room.gameType === 'truth_or_dare') {
      if (action === 'truth_or_dare_spin') {
        const state = room.gameState.truthOrDareState!;
        const { TRUTHS, DARES } = require('./gameHelpers.js');
        
        const targets = room.players.filter(p => p.id !== playerId);
        const target = targets.length > 0 ? targets[Math.floor(Math.random() * targets.length)] : room.players[0];
        
        const isTruth = Math.random() > 0.5;
        const level = payload?.level || 'fun'; // soft, fun, hard
        const list = isTruth ? TRUTHS[level] : DARES[level];
        const text = list[Math.floor(Math.random() * list.length)];
        
        state.currentChallenge = {
          type: isTruth ? 'truth' : 'dare',
          text,
          targetId: target.id
        };
        return { success: true };
      }
      
      if (action === 'truth_or_dare_done') {
        const state = room.gameState.truthOrDareState!;
        if (state.currentChallenge?.targetId === playerId) {
          state.currentChallenge = undefined;
          const nextIdx = this.getNextPlayerIndex(room, 1);
          room.gameState.currentTurnPlayerId = room.players[nextIdx].id;
          return { success: true };
        }
      }
    }

    if (room.gameType === 'werewolf') {
      const state = room.gameState.werewolfState!;
      
      if (action === 'werewolf_start') {
        state.phase = 'night';
        state.votes = {};
        state.nightVictim = undefined;
        state.logs.push('La nuit tombe sur le village... Les loups se réveillent.');
        return { success: true };
      }

      if (action === 'werewolf_chat') {
        if (!state.alivePlayers.includes(playerId)) return { success: false, error: 'Vous êtes mort' };
        if (state.phase !== 'day') return { success: false, error: 'Vous ne pouvez débattre que le jour.' };
        
        const nickname = room.players.find(p => p.id === playerId)?.nickname || 'Inconnu';
        state.chat.push({ sender: nickname, text: payload.text });
        return { success: true };
      }

      if (action === 'werewolf_seer_look') {
        if (state.phase !== 'seer') return { success: false };
        if (state.roles[playerId] !== 'voyante') return { success: false };
        if (!state.alivePlayers.includes(playerId)) return { success: false };
        
        // Seer looks at target role (sent only to them ideally, but we'll add it to logs privately or state)
        // Since state is public, we'll just push a fake log for everyone and a real one that they can read.
        // But for simplicity in this shared state, we'll just advance the phase.
        state.logs.push(`La voyante a espionné quelqu'un...`);
        state.phase = 'night';
        state.logs.push('Les loups se réveillent...');
        return { success: true };
      }

      if (action === 'werewolf_witch_action') {
        if (state.phase !== 'witch') return { success: false };
        if (state.roles[playerId] !== 'sorciere') return { success: false };
        if (!state.alivePlayers.includes(playerId)) return { success: false };

        const { useHeal, killTargetId } = payload;
        
        if (useHeal && !state.witchHealUsed && state.nightVictim) {
          state.nightVictim = undefined;
          state.witchHealUsed = true;
          state.logs.push('La sorcière a utilisé une potion.');
        }

        if (killTargetId && !state.witchKillUsed && state.alivePlayers.includes(killTargetId)) {
          state.alivePlayers = state.alivePlayers.filter(p => p !== killTargetId);
          state.witchKillUsed = true;
          const victimName = room.players.find(p => p.id === killTargetId)?.nickname || 'Quelqu\'un';
          state.logs.push(`La sorcière a utilisé sa potion de poison... ${victimName} s'écroule.`);
        }

        state.phase = 'day';
        state.votes = {};
        
        // Announce morning
        if (state.nightVictim) {
          state.alivePlayers = state.alivePlayers.filter(p => p !== state.nightVictim);
          const victimName = room.players.find(p => p.id === state.nightVictim)?.nickname || 'Un villageois';
          state.logs.push(`Le soleil se lève... ${victimName} a été retrouvé(e) mort(e).`);
          state.nightVictim = undefined;
        } else {
          state.logs.push('Le soleil se lève... Personne n\'est mort cette nuit.');
        }

        return { success: true };
      }

      if (action === 'werewolf_vote') {
        // Only alive players can vote
        if (!state.alivePlayers.includes(playerId)) return { success: false, error: 'Vous êtes mort' };
        
        state.votes[playerId] = payload.targetId;

        if (state.phase === 'night') {
          // Check if all alive wolves have voted
          const aliveWolves = state.alivePlayers.filter(p => state.roles[p] === 'loup');
          const wolvesVoted = aliveWolves.every(w => state.votes[w]);
          
          if (wolvesVoted && aliveWolves.length > 0) {
            // Tally votes
            const counts: Record<string, number> = {};
            aliveWolves.forEach(w => {
              const target = state.votes[w];
              counts[target] = (counts[target] || 0) + 1;
            });
            let maxVotes = 0;
            let victimId = '';
            Object.keys(counts).forEach(t => {
              if (counts[t] > maxVotes) {
                maxVotes = counts[t];
                victimId = t;
              }
            });

            state.nightVictim = victimId || undefined;
            state.votes = {};

            // Check if witch is alive
            const witchAlive = state.alivePlayers.some(p => state.roles[p] === 'sorciere');
            if (witchAlive && (!state.witchHealUsed || !state.witchKillUsed)) {
              state.phase = 'witch';
              state.logs.push('Les loups se rendorment. La sorcière se réveille...');
            } else {
              // Direct to day
              state.phase = 'day';
              if (state.nightVictim) {
                state.alivePlayers = state.alivePlayers.filter(p => p !== state.nightVictim);
                const victimName = room.players.find(p => p.id === state.nightVictim)?.nickname || 'Un villageois';
                state.logs.push(`Le soleil se lève... ${victimName} a été dévoré(e) par les loups.`);
                state.nightVictim = undefined;
              } else {
                state.logs.push('Le soleil se lève... Personne n\'est mort cette nuit.');
              }
            }

            // Check win condition
            const remainingWolves = state.alivePlayers.filter(p => state.roles[p] === 'loup').length;
            const remainingVillagers = state.alivePlayers.length - remainingWolves;

            if (remainingWolves === 0) {
              state.logs.push('🏆 Les Villageois ont gagné ! Tous les loups sont morts.');
              room.gameState.status = 'ended';
            } else if (remainingWolves >= remainingVillagers) {
              state.logs.push('🏆 Les Loups ont gagné ! Ils contrôlent le village.');
              room.gameState.status = 'ended';
            }
          }
        } else if (state.phase === 'day') {
          // Check if ALL alive players voted
          const allVoted = state.alivePlayers.every(p => state.votes[p]);
          if (allVoted) {
            const counts: Record<string, number> = {};
            state.alivePlayers.forEach(p => {
              const target = state.votes[p];
              counts[target] = (counts[target] || 0) + 1;
            });
            
            let maxVotes = 0;
            let lynchedId = '';
            Object.keys(counts).forEach(t => {
              if (counts[t] > maxVotes) {
                maxVotes = counts[t];
                lynchedId = t;
              }
            });

            if (lynchedId) {
              state.alivePlayers = state.alivePlayers.filter(p => p !== lynchedId);
              const lynchedName = room.players.find(p => p.id === lynchedId)?.nickname || 'Un joueur';
              const roleName = state.roles[lynchedId] === 'loup' ? 'Loup-Garou' : 'Villageois';
              state.logs.push(`Le village a voté. ${lynchedName} a été éliminé(e). Son rôle était : ${roleName}.`);
            }

            state.votes = {};
            
            // Check win condition before next night
            const remainingWolves = state.alivePlayers.filter(p => state.roles[p] === 'loup').length;
            const remainingVillagers = state.alivePlayers.length - remainingWolves;

            if (remainingWolves === 0) {
              state.logs.push('🏆 Les Villageois ont gagné ! Tous les loups sont morts.');
              room.gameState.status = 'ended';
            } else if (remainingWolves >= remainingVillagers) {
              state.logs.push('🏆 Les Loups ont gagné ! Ils contrôlent le village.');
              room.gameState.status = 'ended';
            } else {
              // Start next night cycle
              const seerAlive = state.alivePlayers.some(p => state.roles[p] === 'voyante');
              if (seerAlive) {
                state.phase = 'seer';
                state.logs.push('La nuit tombe... La voyante se réveille.');
              } else {
                state.phase = 'night';
                state.logs.push('La nuit tombe... Les loups se réveillent.');
              }
            }
          }
        }

        return { success: true };
      }
    }

    if (room.gameType === 'yams') {
      const state = room.gameState.yamsState!;
      if (action === 'yams_roll') {
        if (!isTurn) return { success: false, error: 'Pas votre tour' };
        if (state.rollsLeft <= 0) return { success: false, error: 'Plus de lancers' };
        
        state.dice = state.dice.map((d, i) => state.lockedDice[i] ? d : Math.floor(1 + Math.random() * 6));
        state.rollsLeft--;
        return { success: true };
      }
      if (action === 'yams_lock') {
        if (!isTurn) return { success: false };
        state.lockedDice[payload.index] = !state.lockedDice[payload.index];
        return { success: true };
      }
      if (action === 'yams_score') {
        if (!isTurn) return { success: false, error: 'Pas votre tour' };
        const category = payload.category;
        const myScores = state.scores[playerId];
        if (myScores[category] !== undefined && myScores[category] !== null) {
          return { success: false, error: 'Catégorie déjà remplie' };
        }

        const { calculateYamsScore, YAMS_CATEGORIES } = require('./gameHelpers.js');
        if (!YAMS_CATEGORIES.includes(category)) return { success: false, error: 'Catégorie invalide' };

        const score = calculateYamsScore(state.dice, category);
        myScores[category] = score;

        // Check if game is over (all categories filled for everyone)
        let isGameOver = true;
        for (const p of room.players) {
          const pScores = state.scores[p.id];
          for (const cat of YAMS_CATEGORIES) {
            if (pScores[cat] === undefined || pScores[cat] === null) {
              isGameOver = false;
              break;
            }
          }
          if (!isGameOver) break;
        }

        if (isGameOver) {
          room.gameState.status = 'ended';
          // Find winner based on total score
          let bestScore = -1;
          let winner = room.players[0].id;
          for (const p of room.players) {
            const total = Object.values(state.scores[p.id]).reduce((acc: number, val: any) => acc + (val || 0), 0) as number;
            
            // Check bonus (>= 63 in 1-6)
            let topSum = 0;
            ['1', '2', '3', '4', '5', '6'].forEach(cat => topSum += (state.scores[p.id][cat] || 0));
            const finalScore = total + (topSum >= 63 ? 35 : 0);

            if (finalScore > bestScore) {
              bestScore = finalScore;
              winner = p.id;
            }
          }
          room.gameState.winnerId = winner;
          const wP = room.players.find(x => x.id === winner);
          if (wP) wP.score += 100;
        } else {
          // Reset dice and next turn
          state.dice = [1, 1, 1, 1, 1];
          state.lockedDice = [false, false, false, false, false];
          state.rollsLeft = 3;
          const nextIdx = this.getNextPlayerIndex(room, 1);
          room.gameState.currentTurnPlayerId = room.players[nextIdx].id;
        }
        return { success: true };
      }
    }

    return { success: false, error: 'Action non reconnue' };
  }

  // ==================== CARD METHODS ====================

  public playCard(
    roomCode: string,
    playerId: string,
    cardId: string
  ): { success: boolean; error?: string; topCard?: Card; nextTurnPlayerId?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Salon introuvable' };
    if (room.gameState.status !== 'in_progress') return { success: false, error: 'Partie non démarrée' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.hand) return { success: false, error: 'Joueur introuvable' };

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, error: 'Carte introuvable dans votre main' };

    const cardToPlay = player.hand[cardIndex];
    const currentTop = room.gameState.topCard;

    const isValid = !currentTop ||
      cardToPlay.color === 'special' ||
      cardToPlay.color === currentTop.color ||
      cardToPlay.value === currentTop.value;

    if (!isValid) {
      return { success: false, error: 'Action invalide : couleur ou valeur non correspondante' };
    }

    player.hand.splice(cardIndex, 1);
    player.cardCount = player.hand.length;
    room.gameState.topCard = cardToPlay;
    room.gameState.discardPileCount++;

    if (player.hand.length === 0) {
      room.gameState.status = 'ended';
      room.gameState.winnerId = player.id;
      player.score += 50;
      return { success: true, topCard: cardToPlay };
    }

    let skipNext = false;
    if (cardToPlay.value === 'reverse') {
      room.gameState.direction = (room.gameState.direction * -1) as (1 | -1);
    } else if (cardToPlay.value === 'skip') {
      skipNext = true;
    } else if (cardToPlay.value === '+2') {
      const nextIdx = this.getNextPlayerIndex(room, room.gameState.direction);
      const nextPlayer = room.players[nextIdx];
      const deck: Card[] = (room as any)._drawDeck || [];
      if (deck.length < 2) {
        deck.push(...this.createCardDeck());
      }
      const drawn = deck.splice(0, 2);
      if (nextPlayer.hand) {
        nextPlayer.hand.push(...drawn);
        nextPlayer.cardCount = nextPlayer.hand.length;
      }
      skipNext = true;
    }

    const step = (skipNext ? 2 : 1) * room.gameState.direction;
    const nextPlayerIndex = this.getNextPlayerIndex(room, step);
    room.gameState.currentTurnPlayerId = room.players[nextPlayerIndex].id;

    return {
      success: true,
      topCard: cardToPlay,
      nextTurnPlayerId: room.gameState.currentTurnPlayerId
    };
  }

  public drawCard(roomCode: string, playerId: string): { success: boolean; drawnCard?: Card; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Salon introuvable' };
    if (room.gameState.currentTurnPlayerId !== playerId) return { success: false, error: 'Ce n’est pas votre tour' };

    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.hand) return { success: false, error: 'Joueur introuvable' };

    let deck: Card[] = (room as any)._drawDeck || [];
    if (deck.length === 0) {
      deck = this.createCardDeck();
      (room as any)._drawDeck = deck;
    }

    const drawnCard = deck.pop();
    if (!drawnCard) return { success: false, error: 'Pioche vide' };

    player.hand.push(drawnCard);
    player.cardCount = player.hand.length;
    room.gameState.drawPileCount = deck.length;

    const nextPlayerIndex = this.getNextPlayerIndex(room, room.gameState.direction);
    room.gameState.currentTurnPlayerId = room.players[nextPlayerIndex].id;

    return { success: true, drawnCard };
  }

  public switchGame(roomCode: string, gameType: GameType, playerId: string, cardSubtype?: any): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.hostId !== playerId) return false;
    room.gameType = gameType;
    room.gameState.gameType = gameType;
    if (cardSubtype) {
      room.cardSubtype = cardSubtype;
      room.gameState.cardSubtype = cardSubtype;
    }
    room.gameState.status = 'waiting';
    return true;
  }

  public handleDisconnect(socketId: string): { roomCode?: string; player?: Player } {
    const mapping = this.socketMap.get(socketId);
    if (!mapping) return {};

    const { roomCode, playerId } = mapping;
    this.socketMap.delete(socketId);
    const room = this.rooms.get(roomCode);
    if (!room) return {};

    const player = room.players.find(p => p.id === playerId);
    if (!player) return {};

    player.isOnline = false;
    player.lastDisconnectedAt = Date.now();

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      const targetRoom = this.rooms.get(roomCode);
      if (targetRoom) {
        targetRoom.players = targetRoom.players.filter(p => p.id !== playerId);
        if (targetRoom.players.length === 0) {
          this.rooms.delete(roomCode);
        } else if (targetRoom.hostId === playerId) {
          targetRoom.hostId = targetRoom.players[0].id;
          targetRoom.players[0].isHost = true;
        }
      }
    }, 45000);

    this.disconnectTimers.set(playerId, timer);

    return { roomCode, player };
  }

  public getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  public getPlayerBySocket(socketId: string): { room?: Room; player?: Player } {
    const mapping = this.socketMap.get(socketId);
    if (!mapping) return {};
    const room = this.rooms.get(mapping.roomCode);
    const player = room?.players.find(p => p.id === mapping.playerId);
    return { room, player };
  }

  public getPublicRoomView(room: Room): Omit<Room, 'players'> & { players: Omit<Player, 'hand' | 'dominoHand'>[] } {
    return {
      code: room.code,
      hostId: room.hostId,
      gameType: room.gameType,
      cardSubtype: room.cardSubtype,
      gameState: room.gameState,
      createdAt: room.createdAt,
      players: room.players.map(p => ({
        id: p.id,
        socketId: p.socketId,
        nickname: p.nickname,
        avatar: p.avatar,
        isHost: p.isHost,
        isOnline: p.isOnline,
        score: p.score,
        cardCount: p.cardCount,
        dominoCount: p.dominoCount || 0,
        connectedAt: p.connectedAt,
        lastDisconnectedAt: p.lastDisconnectedAt
      }))
    };
  }

  private getNextPlayerIndex(room: Room, step: number): number {
    const count = room.players.length;
    if (count <= 1) return 0;
    const currentIdx = room.players.findIndex(p => p.id === room.gameState.currentTurnPlayerId);
    let nextIdx = (currentIdx + step) % count;
    if (nextIdx < 0) nextIdx += count;
    return nextIdx;
  }
}
