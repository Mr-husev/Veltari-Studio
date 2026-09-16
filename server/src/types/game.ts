export type AvatarId = 'fox' | 'panda' | 'tiger';

export type GameType = 'cards' | 'ludo' | 'dominoes' | 'connect4' | 'werewolf' | 'truth_or_dare' | 'yams';

export interface Card {
  id: string;
  color: 'blue' | 'yellow' | 'green' | 'red' | 'special';
  value: string; // '0'-'9', 'reverse', 'skip', '+2', '+4'
  label: string;
}

export interface DominoTile {
  id: string;
  left: number;  // 0-6
  right: number; // 0-6
}

export interface DominoChainTile {
  id: string;
  left: number;
  right: number;
  orientation?: 'h' | 'v';
}

export interface Player {
  id: string;
  socketId: string;
  nickname: string;
  avatar: AvatarId;
  isHost: boolean;
  isOnline: boolean;
  score: number;
  cardCount: number;
  dominoCount?: number;
  hand?: Card[]; // Only sent to the specific player
  dominoHand?: DominoTile[]; // Only sent to the specific player
  connectedAt: number;
  lastDisconnectedAt?: number;
}

export interface LudoPawn {
  id: string;
  playerId: string;
  color: 'blue' | 'green' | 'red' | 'yellow';
  colorIndex: number; // 0: blue, 1: green, 2: red, 3: yellow
  position: number; // -1: base, 0-51: main track, 101-106: home stretch, 107: finished
  stepCount: number; // Cases parcourues depuis la sortie (0 à 57)
  isHome: boolean;
}

export type CardSubtype =
  | 'uno'
  | 'belote'
  | 'poker'
  | 'rami'
  | 'bridge'
  | 'blackjack'
  | 'bataille';

export interface GameState {
  gameType: GameType;
  cardSubtype?: CardSubtype;
  status: 'waiting' | 'in_progress' | 'ended';
  currentTurnPlayerId?: string;
  direction: 1 | -1; // For UNO cards direction
  topCard?: Card;
  discardPileCount: number;
  drawPileCount: number;
  // Ludo state
  ludoState?: {
    lastDiceRoll?: number;
    isRolling?: boolean;
    canRollDice: boolean;
    movablePawnIds: string[];
    pawns: LudoPawn[];
    extraTurn: boolean;
  };
  // Dominoes state
  dominoState?: {
    chain: DominoChainTile[];
    openEnds: [number, number]; // [leftEnd, rightEnd]
    boneyardCount: number;
    lastPlayedBy?: string;
    isBlocked?: boolean;
    consecutivePasses?: number;
  };
  connect4State?: {
    board: (string | null)[][];
    winnerChips?: {row: number, col: number}[];
  };
  werewolfState?: {
    phase: 'setup' | 'night' | 'day' | 'seer' | 'witch';
    roles: Record<string, string>;
    alivePlayers: string[];
    votes: Record<string, string>;
    logs: string[];
    chat: { sender: string; text: string }[];
    witchHealUsed: boolean;
    witchKillUsed: boolean;
    nightVictim?: string;
  };
  truthOrDareState?: {
    currentChallenge?: {
      type: 'truth' | 'dare';
      text: string;
      targetId: string;
    };
  };
  yamsState?: {
    dice: number[];
    lockedDice: boolean[];
    rollsLeft: number;
    scores: Record<string, Record<string, number | null>>;
  };
  winnerId?: string;
}

export interface Room {
  code: string;
  hostId: string;
  gameType: GameType;
  cardSubtype?: CardSubtype;
  players: Player[];
  gameState: GameState;
  createdAt: number;
}

// Client to Server Events
export interface ClientToServerEvents {
  'create_room': (payload: { nickname: string; avatar: AvatarId; gameType?: GameType; cardSubtype?: CardSubtype }, callback: (res: { success: boolean; roomCode?: string; playerId?: string; error?: string }) => void) => void;
  'join_room': (payload: { roomCode: string; nickname: string; avatar: AvatarId; playerId?: string }, callback: (res: { success: boolean; room?: Room; playerId?: string; error?: string }) => void) => void;
  'start_game': (payload: { roomCode: string }) => void;
  'select_game': (payload: { roomCode: string; gameType: GameType; cardSubtype?: CardSubtype }) => void;
  // Card events
  'play_card': (payload: { roomCode: string; cardId: string }) => void;
  'draw_card': (payload: { roomCode: string }) => void;
  // Ludo events
  'roll_dice': (payload: { roomCode: string }) => void;
  'move_pawn': (payload: { roomCode: string; pawnId: string }) => void;
  // Domino events
  'play_domino': (payload: { roomCode: string; dominoId: string; end: 'left' | 'right' }) => void;
  'draw_domino': (payload: { roomCode: string }) => void;
  'pass_turn': (payload: { roomCode: string }) => void;
  // Party Games Events
  'party_game_action': (payload: { roomCode: string; action: string; payload?: any }) => void;
  // Generic
  'leave_room': (payload: { roomCode: string }) => void;
}

// Server to Client Events
export interface ServerToClientEvents {
  'room_updated': (room: Omit<Room, 'players'> & { players: Omit<Player, 'hand' | 'dominoHand'>[] }) => void;
  'private_hand_updated': (hand: Card[]) => void;
  'private_dominoes_updated': (dominoes: DominoTile[]) => void;
  'turn_announcement': (payload: { playerId: string; playerNickname: string; message: string }) => void;
  'game_action_effect': (payload: { type: string; details: any }) => void;
  'player_left': (payload: { playerId: string; nickname: string }) => void;
  'error_notification': (payload: { message: string }) => void;
}
