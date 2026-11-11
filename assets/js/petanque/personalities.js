// The four players in one place (GAME-PLAN section 10): look, stance, SKILL key, idle quirks, reaction styles,
// one-line bio, and commentary pools. Pure data and a picker, no DOM or three.js, so it can be tested in Node.

// Idle quirk names understood by character.js: see QUIRKS there.
// Reaction styles (character.js REACTIONS): celebrate: 'proud' | 'clap' | 'jump' | 'cheer'; dismay: 'wave' | 'sigh' | 'head' | 'shrug'.
export const PERSONALITIES = {
  you: {
    id: 'you', name: 'You', model: 'you', skill: 'human', team: 0,
    spec: {
      height: 1.76, build: 'average', stance: 'crouch',
      colors: { shirt: '#2fa3a0', trousers: '#23396b', skin: '#d9a37c' },
    },
    quirks: { idle: ['shift', 'lookaround'], celebrate: 'cheer', dismay: 'shrug' },
    bio: 'the one with the boules',
  },
  pierre: {
    id: 'pierre', name: 'Pierre', model: 'pierre', skill: 'pierre', team: 0,
    spec: {
      height: 1.82, build: 'average', stance: 'stand',
      colors: { shirt: '#f2c230', trousers: '#23396b', skin: '#b98258', scarf: '#d8322c' }, // yellow shirt, red neckerchief
    },
    quirks: { idle: ['bounce', 'fidget', 'practice'], celebrate: 'jump', dismay: 'head' },
    bio: 'your partner, young, keen, never short of confidence, and he loves a shot',
  },
  marcel: {
    id: 'marcel', name: 'Marcel', model: 'marcel', skill: 'marcel', team: 1,
    spec: {
      height: 1.68, build: 'stout', stance: 'crouch',
      colors: { shirt: '#7d8f5a', trousers: '#8a5a2b', skin: '#cf9a72', hat: '#3f3a34' }, // olive shirt; ?figures=mesh keeps the model's own colours
    },
    quirks: { hat: 'cap', idle: ['hips', 'headshake', 'wipebrow'], celebrate: 'proud', dismay: 'wave' },
    bio: 'has pointed at this terrain since 1974 and will tell you about it',
  },
  odette: {
    id: 'odette', name: 'Odette', model: 'odette', skill: 'odette', team: 1,
    spec: {
      height: 1.74, build: 'slim', stance: 'stand',
      colors: { shirt: '#e9e1d2', trousers: '#9c6a34', skin: '#efc6a4', hat: '#e9d9a0' },
    },
    quirks: { hat: 'sunhat', idle: ['fold', 'checkwatch', 'tilt'], celebrate: 'clap', dismay: 'sigh' },
    bio: 'retired schoolteacher, a very sharp tireur, and she will correct your grammar',
  },
};
export const CAST_IDS = ['you', 'pierre', 'marcel', 'odette'];

// The object createCharacter() takes
export function specFor(id) {
  const p = PERSONALITIES[id];
  return { model: p.model, name: p.name, personality: id, ...p.spec, quirks: p.quirks };
}

// ---------- commentary pools ----------
// Events: spotPoint, spotShoot, spotJack (as the AI picks its spot), good (takes or extends the point), great
// (biberon), carreau, miss, dead (dead boule), oppScores (an opponent just took the point), ownScores (your
// side took it), meneWon, meneLost, gameWon, gameLost, suggestPoint, suggestShoot, suggestYou (Pierre).
// Templates: {target} 'the jack' or 'your boule'.
export const LINES = {
  marcel: {
    spotPoint: [
      'Doucement, doucement. Like this.', 'I have pointed here since 1974.', 'A little roll, and the gravel does the rest.',
      'Patience, mes amis.', 'The terrain tells me where to go.', 'No hurry. The jack is not going anywhere.',
    ],
    spotShoot: [
      'Oh là là, must I? Fine, fine.', 'Odette usually does this. Today it is me.', 'A bold one, for an old man.',
      'Let us see if the arm remembers.', 'Pas de panique, just a little tap.',
    ],
    spotJack: [
      'Voilà, the cochonnet. Somewhere over there.', 'Not too far, not too near.', 'Right, a nice one for everybody.',
      'Watch the lines, Marcel.', 'This is how it is done.',
    ],
    good: [
      'Ah, you see? Pétanque is patience.', 'Bravo, Marcel. Not bad for 1974.', 'That one stays.',
      'Pas mal, hein?', 'The old hand still knows the way.', 'Close enough to smell the jack.',
    ],
    great: [
      'Biberon! Ha! Take a photo.', 'Touching! Do you see this?', 'Oh là là, I am proud of this one.',
      'Fifty years, and still I surprise myself.',
    ],
    carreau: [
      'Carreau! Even I am surprised.', 'Oh là là! Sit down, boule, you are home.', 'Take that, and a coffee too.',
      'Ha! Sur place! Marvellous.',
    ],
    miss: [
      'Tant pis. The gravel has opinions today.', 'This terrain, it does not like me.', 'Hmph. A stone, I am sure of it.',
      'Ah non! Not like this.', 'It was a good throw. It was the ground.', 'Mmm. The arm was not asked.',
    ],
    dead: [
      'C\'est pas vrai! Off the court!', 'Oh là là, the boule has gone to the café.', 'Dead. Well, we all go sometime.',
      'Hmph. The boule has left without me.',
    ],
    oppScores: [
      'Hmph. Beginner\'s luck, surely.', 'Ah, you wish to play properly? Allez.', 'Pas mal. I have seen better, but not today.',
      'We shall see about that.', 'Careful. I take my time, then I take the point.',
    ],
    ownScores: [
      'You see? A point is a point.', 'Bravo, bravo.', 'That is how we do it in Provence.', 'Allez, Odette! Same again.',
    ],
    meneWon: [
      'Voilà. Slow and steady.', 'That is the mène, as I said it would be.', 'Bravo. Time for a little pastis? Later.',
      'Patience pays, as always.',
    ],
    meneLost: [
      'Tant pis. We take the next one.', 'Hmph. The mène was close.', 'Ah, you got that one. Enjoy it.',
      'It happens. To other people, usually.',
    ],
    gameWon: [
      'Voilà! Fifty years of practice!', 'Bravo to all, but especially to me.', 'The old man still has it. Allez!',
    ],
    gameLost: [
      'Bravo, you played well. Tant pis for me.', 'Oh là là, I am getting old. Good game.', 'A fine game. Next time I will be ready.',
    ],
  },
  odette: {
    spotPoint: [
      'I shall place it precisely.', 'A measured throw. As it should be.', 'Observe the technique.',
      'Elementary, really.', 'It is all in the wrist.',
    ],
    spotShoot: [
      '{target}. Let us correct this.', 'A small lesson in accuracy.', 'I will take {target}, thank you.',
      'Watch closely. This is the proper way.', 'Straight at {target}. No fuss.',
    ],
    spotJack: [
      'The cochonnet, within the lines, if you please.', 'Between the lines. Not complicated.', 'There. Exactly where it belongs.',
      'Eight metres, give or take. Precisely.',
    ],
    good: [
      'Adequate. Possibly rather good.', 'Exactly as planned.', 'Bravo, Odette. Naturally.',
      'There. The point is ours.', 'One does one\'s best.', 'A fair throw, if I say so myself.',
    ],
    great: [
      'Biberon. I rather think that is full marks.', 'Touching. Quite satisfactory.', 'Perfect. Write that down.',
      'I could not have drawn it better.',
    ],
    carreau: [
      'Carreau. As demonstrated.', 'And the target has been removed. Class dismissed.', 'Sur place. Textbook.',
      'Oh, bien joué. Me, I mean.',
    ],
    miss: [
      'Hmm. Not my best work.', 'The gravel was at fault. Quite clearly.', 'That was not what I intended.',
      'A momentary lapse. It will not recur.', 'Tant pis. Next.', 'Tiens. A small error.',
    ],
    dead: [
      'That boule was not meant to leave. How careless.', 'Out of bounds. I shall not discuss it.', 'Hmm. Dead. One might say embarrassing.',
      'Tant pis. It escaped.',
    ],
    oppScores: [
      'Not bad. Not bad at all.', 'A reasonable throw. For you.', 'Well done. I did not say it twice.',
      'I see. Allez, we adjust.', 'Hm. Noted.',
    ],
    ownScores: [
      'Bravo, Marcel. See? It is not difficult.', 'Good. The point is ours.', 'A correct result.', 'Well done. Continue.',
    ],
    meneWon: [
      'The mène is ours, as calculated.', 'Bravo. Next, please.', 'Quod erat demonstrandum.',
      'Satisfactory. Let us proceed.',
    ],
    meneLost: [
      'You have the mène. Do not let it go to your head.', 'Tant pis. We regroup.', 'A fair result. This time.',
      'Hm. A small setback.',
    ],
    gameWon: [
      'And that, as they say, is that. Bravo.', 'Game, set, and a very good lesson.', 'A pleasure. Class dismissed.',
    ],
    gameLost: [
      'Well played, genuinely. I shall remember it.', 'Bravo to you both. Truly.', 'A fine game. I will find the lesson in it.',
    ],
  },
  pierre: {
    spotPoint: [
      'Easy. Watch this one.', 'Right on the jack, you will see.', 'Allez! Like a laser.', 'I have got this.',
      'Nice and smooth. Smooth like me.',
    ],
    spotShoot: [
      '{target}? I will blast it!', 'Time to shoot! Everyone stand back!', 'Oh, I love this one. Allez!',
      'Bam! You will see, {target} is history.', 'Shoot first, ask questions later!',
    ],
    spotJack: [
      'Right, a perfect cochonnet.', 'Over there, I think. Allez!', 'Easy. Watch this.', 'Here it goes, nice and clean.',
    ],
    good: [
      'Yes! Did you see that?', 'Allez! Perfect!', 'That is how it is done!', 'Boom! Right next to it!',
      'Easy. I did say it was easy.', 'Bravo, me!',
    ],
    great: [
      'BIBERON! Did you see that?!', 'Oh là là! It is touching!', 'I am a genius, I am telling you!',
      'Incroyable! Somebody, a photo!',
    ],
    carreau: [
      'CARREAU! Yes yes yes!', 'Oh là là, did you see?! Boom!', 'That is the best shot in the history of the club!',
      'Allez! It is gone, and I am standing there!',
    ],
    miss: [
      'Oh, that one slipped. Next one for sure!', 'It was the wind. There is always a wind.', 'Tant pis! I had it, almost.',
      'Okay, okay, I was just warming up.', 'Hmm. I meant that. A little bit.', 'C\'est pas vrai! Next time!',
    ],
    dead: [
      'C\'est pas vrai! It had a mind of its own!', 'Oh là là. That was a very long throw.', 'Er. It slipped. Totally.',
      'Dead? No. It is... exploring.',
    ],
    oppScores: [
      'Pff, lucky. Watch me answer.', 'Oh là là, they are good. Allez, we are better!', 'Okay okay, fine shot. For them.',
      'No problem. I have a plan. Kind of.',
    ],
    ownScores: [
      'Allez! That is our point!', 'Bravo! We are unstoppable!', 'Yes! We are winning this!', 'Fantastic! Keep going!',
    ],
    meneWon: [
      'Allez! We got the mène!', 'Yes! Bravo, team!', 'That is how it is done! High five!',
      'Easy. I said it would be easy.',
    ],
    meneLost: [
      'Tant pis, we get the next one!', 'Oh là là, it was close. We are better than this!', 'We were unlucky. Allez, again!',
      'Pff, next mène. We will crush it.',
    ],
    gameWon: [
      'WE WON! Allez! Bravo, partner!', 'Champions! Champions! Oh là là!', 'I knew it! I told you, did I not?',
    ],
    gameLost: [
      'Oh là là. Next time we crush them, I promise.', 'Tant pis. Good game, everyone. A rematch?', 'Okay, they were good. But next time!',
    ],
    suggestPoint: [
      'I have a feeling about a point here. Want me to place it?', 'I can get right by the jack. Want me to?',
      'Easy point from here! Shall I?', 'Let me point this one, I have got it!', 'A nice soft one, I see it. Me or you?',
    ],
    suggestShoot: [
      'I would shoot {target}. Want me to?', 'Oh, I want to hit {target}! Can I?', 'Shall I shoot {target}? I will not miss. Probably.',
      'Allez, let me blast {target}!', 'One good shot and {target} is gone. Shall I?',
    ],
    suggestYou: [
      'You take this one, I will keep my boules for shooting.', 'You point, I will save myself for a big shot.',
      'Go on, you point. I will be the hero afterwards.', 'Your turn, I say. I will shoot when it matters.',
    ],
  },
  you: {
    good: ['Nicely placed.', 'A good throw.', 'That is a good one.', 'Well done.'],
    great: ['Touching the jack, magnificent.', 'A biberon! Superb.', 'Beautifully done.'],
    carreau: ['A carreau, brilliant.', 'Right on the target.', 'Neatly done.'],
    miss: ['Not this time.', 'A bit off.', 'It happens.', 'Next one.'],
    dead: ['That one went out.', 'Out of the court.', 'A dead boule.'],
    meneWon: ['The mène is yours.', 'Nicely done.', 'Points on the board.'],
    meneLost: ['Not this mène.', 'Next one.', 'They take this one.'],
    gameWon: ['You won the game!', 'A fine win.', 'Game to you.'],
    gameLost: ['Not this time.', 'A good game anyway.', 'Next time.'],
  },
};

// Commentary picker: one random line per (speaker, event), never the same twice in a row. `rand` is a 0..1
// generator (seeded in the game and in tests). A missing pool gives null.
export function createCommentary(rand) {
  const last = new Map();
  function line(id, event, vars = {}) {
    const pool = LINES[id] && LINES[id][event];
    if (!pool || !pool.length) return null;
    const key = id + '/' + event;
    let i = Math.floor(rand() * pool.length) % pool.length;
    if (pool.length > 1 && i === last.get(key)) i = (i + 1 + Math.floor(rand() * (pool.length - 1))) % pool.length;
    last.set(key, i);
    return pool[i].replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }
  // speaker-prefixed form for the status line: Name: "line"
  function say(id, event, vars) {
    const l = line(id, event, vars);
    return l ? `${PERSONALITIES[id].name}: “${l}”` : '';
  }
  return { line, say };
}
