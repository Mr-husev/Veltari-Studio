export const TRUTHS = {
  soft: [
    "Quel est ton film préféré honteux ?",
    "Quelle est la chose la plus drôle que tu aies faite étant enfant ?",
    "As-tu un talent caché inutile ?",
    "Quel est ton pire surnom ?",
    "Si tu devais manger un seul plat toute ta vie, ce serait quoi ?"
  ],
  fun: [
    "Quelle est ta plus grande phobie irrationnelle ?",
    "Quel est le dernier mensonge que tu aies raconté ?",
    "As-tu déjà volé quelque chose dans un magasin ?",
    "Quelle est la pire excuse que tu aies donnée pour annuler une sortie ?",
    "Quelle est ton habitude la plus bizarre quand tu es seul(e) ?"
  ],
  hard: [
    "Quel est le pire cadeau que l'on t'ait jamais offert (et par qui) ?",
    "As-tu déjà lu les messages de quelqu'un d'autre en secret ?",
    "Qui est la personne la moins bien habillée dans cette pièce ?",
    "Quel est ton plus grand regret romantique ?",
    "Quelle est la pire chose que tu aies faite au travail/à l'école ?"
  ]
};

export const DARES = {
  soft: [
    "Fais l'accent québécois pendant 1 minute.",
    "Imite une célébrité jusqu'à ce qu'on devine qui c'est.",
    "Mange une cuillère de moutarde (ou mayo).",
    "Fais 10 pompes ou abdos.",
    "Laisse quelqu'un te dessiner sur le visage avec un stylo lavable."
  ],
  fun: [
    "Danse sans musique pendant 30 secondes.",
    "Appelle un ami au hasard et chante-lui joyeux anniversaire.",
    "Parle avec la langue sortie pour tes 3 prochaines phrases.",
    "Fais une déclaration d'amour passionnée à un objet de la pièce.",
    "Bois un grand verre d'eau sans utiliser tes mains."
  ],
  hard: [
    "Envoie un message 'Je dois te dire un secret' à la 5ème personne dans tes contacts.",
    "Fais un câlin très gênant et long à la personne à ta gauche.",
    "Laisse la personne à ta droite envoyer un message depuis ton téléphone.",
    "Publie une photo très moche de toi en story pendant 1 heure.",
    "Échange tes vêtements avec quelqu'un pour le reste de la partie."
  ]
};

export function checkConnect4Win(board: (string | null)[][]): {row: number, col: number}[] | null {
  const rows = 6;
  const cols = 7;

  // Check horizontal, vertical, diagonal
  const directions = [
    [0, 1], [1, 0], [1, 1], [1, -1]
  ];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const player = board[r][c];
      if (!player) continue;

      for (const [dr, dc] of directions) {
        const winningChips = [{row: r, col: c}];
        let win = true;
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || board[nr][nc] !== player) {
            win = false;
            break;
          }
          winningChips.push({row: nr, col: nc});
        }
        if (win) return winningChips;
      }
    }
  }
  return null;
}

export function assignWerewolfRoles(playerIds: string[]) {
  const roles = ['loup', 'voyante', 'sorciere', 'chasseur', 'voleur', 'cupidon', 'petite_fille'];
  const assigned: Record<string, string> = {};
  const shuffledIds = [...playerIds].sort(() => Math.random() - 0.5);
  
  shuffledIds.forEach((id, index) => {
    // If more players than special roles, rest are villagers
    assigned[id] = index < roles.length ? roles[index] : 'villageois';
  });
  
  // Guarantee at least 1 wolf if there are enough players
  if (playerIds.length > 2 && !Object.values(assigned).includes('loup')) {
    assigned[shuffledIds[0]] = 'loup';
  }

  return assigned;
}

export const YAMS_CATEGORIES = [
  '1', '2', '3', '4', '5', '6',
  'brelan', 'carre', 'full', 'petite_suite', 'grande_suite', 'yams', 'chance'
];

export function calculateYamsScore(dice: number[], category: string): number {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // 1-indexed for ease
  let sum = 0;
  for (const d of dice) {
    counts[d]++;
    sum += d;
  }

  // Numbers 1-6
  const num = parseInt(category);
  if (!isNaN(num) && num >= 1 && num <= 6) {
    return counts[num] * num;
  }

  switch (category) {
    case 'brelan':
      return counts.some(c => c >= 3) ? sum : 0;
    case 'carre':
      return counts.some(c => c >= 4) ? sum : 0;
    case 'full':
      const has3 = counts.some(c => c === 3);
      const has2 = counts.some(c => c === 2);
      const has5 = counts.some(c => c === 5);
      return (has3 && has2) || has5 ? 25 : 0;
    case 'petite_suite':
      const uniqueVals = [...new Set(dice)].sort();
      const str = uniqueVals.join('');
      if (str.includes('1234') || str.includes('2345') || str.includes('3456')) return 30;
      return 0;
    case 'grande_suite':
      const sortedVals = [...dice].sort();
      const gStr = sortedVals.join('');
      if (gStr === '12345' || gStr === '23456') return 40;
      return 0;
    case 'yams':
      return counts.some(c => c === 5) ? 50 : 0;
    case 'chance':
      return sum;
    default:
      return 0;
  }
}
