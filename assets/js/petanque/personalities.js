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
// Events: spotPoint, spotShoot, spotJack (as the AI picks its spot), jackPlace (as it places your invalid jack), good (takes or extends the point), great
// (biberon), carreau, miss, dead (dead boule), oppScores (an opponent just took the point), ownScores (your
// side took it), meneWon, meneLost, gameWon, gameLost, suggestPoint, suggestShoot, suggestYou (Pierre).
// Tactical reasons (tactics.js explain): `why.<code>` lines for the AI's spot text and `suggest.<code>` for Pierre's
// advice, with `who.<kind>` naming who should throw. Templates: {target} 'the jack' or 'your boule', {n}, {gap}.
// Templates: {target} 'the jack' or 'your boule'.
export const LINES = {
  marcel: {
    why: {
      'takePoint': [
        'Doucement. I take the point.', 'A gentle one, and the point is mine.',
      ],
      'holdPoint': [
        'A little more, to be safe.', 'We are in front. I add a little.',
      ],
      'downOnBoules': [
        'They have more boules. I do not gamble.', 'Fewer boules than them. Patience.',
      ],
      'upOnBoules': [
        'We have the boules. I can afford a bold one.', 'More boules than them. Why not a shot?',
      ],
      'bringInBoules': [
        'Move that one, and ours count.', 'Out goes that boule, and ours come in.',
      ],
      'removePoints': [
        'Odette, take that one away.', 'They hold too much. That one must go.',
      ],
      'protectOwn': [
        'Too near our own boule. I point.', 'I will not knock our own boule.',
      ],
      'lastBoule': [
        'The last one. Safe.', 'Last boule. No heroics.',
      ],
      'closeOut': [
        '{n} to go. A safe point wins it.', 'Nearly there. No gambling now.',
      ],
      'voidMene': [
        'Pff. We shoot the cochonnet and start again.', 'This mène is lost. Out with the cochonnet.',
      ],
      'jackScoreTrick': [
        'They have none left. Cochonnet out, and mine are points.', 'No boules for them. The cochonnet goes, mine count.',
      ],
      'blockFront': [
        'I put one in front, as a door.', 'A door in front of the jack.',
      ],
      'safetyBehind': [
        'Behind the jack, in case she shoots it.', 'Behind, for safety.',
      ],
      'coverJack': [
        'Behind the jack, in case she shoots it.', 'The jack is near the line. I cover it.',
      ],
      'noReply': [
        'They have none left. Points, points.', 'Nobody answers. I add points.',
      ],
    },
    spotPoint: [
      'Doucement, doucement. Like this.', 'I have pointed here since 1974.', 'A little roll, and the gravel does the rest.',
      'Patience, mes amis.', 'The terrain tells me where to go.', 'No hurry. The jack is not going anywhere.',
    ],
    spotShoot: [
      'Oh là là, must I? Fine, fine.', 'Odette usually does this. Today it is me.', 'A bold one, for an old man.',
      'Let us see if the arm remembers.', 'Pas de panique, just a little tap.',
    ],
    jackPlace: [
      'Here, I think. A gentle spot for a gentle game.', 'Right here. The gravel is kind.', 'Not too far. Marcel does not like walking.',
      'Voilà. Since 1974 I have known a good place.',
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
    why: {
      'takePoint': [
        'The point should be ours. Observe.', 'A measured throw to take the point.',
      ],
      'holdPoint': [
        'We lead. I extend it, carefully.', 'Hold the point. Elementary.',
      ],
      'downOnBoules': [
        'They hold more boules. I shall not gamble.', 'Outnumbered. Precision, not risk.',
      ],
      'upOnBoules': [
        'We outnumber them. A shot is affordable.', 'More boules than they. Let us be bold.',
      ],
      'bringInBoules': [
        'Remove that one and ours count.', 'One shot, and two of ours score.',
      ],
      'removePoints': [
        'They hold {n}. A lesson is in order.', 'That boule is worth several points. It goes.',
      ],
      'protectOwn': [
        'Too close to our own boule. I point.', "One does not knock one's own boule.",
      ],
      'lastBoule': [
        'The last boule. Safe, if you please.', 'Last one. No theatrics.',
      ],
      'closeOut': [
        'Only {n} to win. No gambling.', 'Nearly won. Safety first.',
      ],
      'voidMene': [
        'Down {n}. The cochonnet goes, and we begin again.', 'A void mène is better than this.',
      ],
      'jackScoreTrick': [
        'They have none left. The cochonnet goes; mine score.', 'Remove the cochonnet, and my boules are points.',
      ],
      'blockFront': [
        'A boule in front, to stop the roller.', 'A door, in front of the jack.',
      ],
      'safetyBehind': [
        'Behind the jack, in case it is shot.', 'A safety behind.',
      ],
      'coverJack': [
        'The jack is near the line. I cover it from behind.', 'Behind the jack, near the line.',
      ],
      'noReply': [
        'They have none left. Points, then.', 'No reply possible. I add points.',
      ],
    },
    spotPoint: [
      'I shall place it precisely.', 'A measured throw. As it should be.', 'Observe the technique.',
      'Elementary, really.', 'It is all in the wrist.',
    ],
    spotShoot: [
      '{target}. Let us correct this.', 'A small lesson in accuracy.', 'I will take {target}, thank you.',
      'Watch closely. This is the proper way.', 'Straight at {target}. No fuss.',
    ],
    jackPlace: [
      'Here. Precisely here.', 'A correct distance. Measure it, if you doubt.', 'I place it where it belongs.',
      'There. Try not to throw it out this time.',
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
    why: {
      'takePoint': [
        'Easy. I take the point!', 'Right next to the jack, you will see.',
      ],
      'holdPoint': [
        'We are in front. A little more!', 'Keep it, add more. Allez!',
      ],
      'downOnBoules': [
        'They have more boules. OK, I point. Boring.', 'Fewer boules than them. Careful, careful.',
      ],
      'upOnBoules': [
        'We have the boules. Time to shoot!', 'More boules! Bam, let us go for it.',
      ],
      'bringInBoules': [
        'Knock that one out and ours come in!', 'One shot, two boules scoring. Allez!',
      ],
      'removePoints': [
        'They hold {n}. I will blast the first one!', 'That is a lot of points. It is going.',
      ],
      'protectOwn': [
        'Too close to ours. I will point.', 'Not touching our own boule. Probably.',
      ],
      'lastBoule': [
        'Last boule. Safe, for once.', 'The last one. No fireworks.',
      ],
      'closeOut': [
        'Only {n} to win. Careful now!', 'Almost there. A safe one.',
      ],
      'voidMene': [
        'We are losing {n}. Bye-bye, cochonnet!', 'Shoot the jack and void it. Genius.',
      ],
      'jackScoreTrick': [
        'They are out of boules. Cochonnet out, ours score!', 'No boules for them. Bam, the jack!',
      ],
      'blockFront': [
        'A door in front. They will not roll past!', 'One in front, stop their roller.',
      ],
      'safetyBehind': [
        'Behind the jack, just in case.', 'A safety behind.',
      ],
      'coverJack': [
        'The jack is near the line. Cover it!', 'Behind the jack, it is near the line.',
      ],
      'noReply': [
        'They are out. Points, points, points!', 'Nobody can answer. Add points.',
      ],
    },
    suggest: {
      'takePoint': [
        'Their boule is {gap} off the jack. Point it, you have got this.', 'Point it, {gap} is all it takes.',
      ],
      'holdPoint': [
        'We are in front. Keep pointing.', 'We lead. Add one, softly.',
      ],
      'downOnBoules': [
        'They have {n} more boules than us. Point, do not shoot.', 'We are short of boules. Point.',
      ],
      'upOnBoules': [
        'We are up on boules, you can shoot.', 'We have the boules. Shoot if you like.',
      ],
      'bringInBoules': [
        'Knock that boule out and our {n} come into the point.', 'Hit that one and ours count.',
      ],
      'removePoints': [
        'They hold {n}. Shoot the first one.', 'They hold {n}. Take out the closest.',
      ],
      'protectOwn': [
        'Do not shoot, you would knock our boule.', 'Our own boule is too close. Point.',
      ],
      'lastBoule': [
        'Last boule, play it safe.', 'The last one. Safe.',
      ],
      'closeOut': [
        'Only {n} to win, do not gamble.', 'So close. Safe point.',
      ],
      'voidMene': [
        'We are losing {n}. Shoot the jack and void it.', 'Knock the jack out, we start again.',
      ],
      'jackScoreTrick': [
        'They are out of boules, knock the jack out and we score ours.', 'No boules left for them. Jack out, ours count.',
      ],
      'blockFront': [
        'Put one in front, stop their roller.', 'A blocker in front of the jack.',
      ],
      'safetyBehind': [
        'Cover the jack from behind.', 'Behind the jack, just in case.',
      ],
      'coverJack': [
        'The jack is near the line. Cover it from behind.', 'Behind the jack, it is near the line.',
      ],
      'noReply': [
        'They are out. Just add points.', 'Nobody can answer. Points.',
      ],
    },
    who: {
      'youPoint': [
        'You point, I will shoot after.', 'You point. I will be the hero afterwards.',
      ],
      'youPointAlone': [
        'You point this one.', 'Your turn to point.',
      ],
      'youShoot': [
        'You shoot this one.', 'Go on, you shoot.',
      ],
      'iShoot': [
        'I will shoot this one.', 'Let me take this shot.',
      ],
      'iPoint': [
        'Let me point this one.', 'I will point this one, then you.',
      ],
      'only': [
        'Mine to throw.', 'Only my boules are left.',
      ],
    },
    spotPoint: [
      'Easy. Watch this one.', 'Right on the jack, you will see.', 'Allez! Like a laser.', 'I have got this.',
      'Nice and smooth. Smooth like me.',
    ],
    spotShoot: [
      '{target}? I will blast it!', 'Time to shoot! Everyone stand back!', 'Oh, I love this one. Allez!',
      'Bam! You will see, {target} is history.', 'Shoot first, ask questions later!',
    ],
    jackPlace: [
      'Here! Nice and tricky for you.', 'Right there. Let us see you point that!', 'Perfect spot. For us, obviously.',
      'Allez, here it is. No pressure!',
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
    const pool = LINES[id] && event.split('.').reduce((o, k) => (o ? o[k] : undefined), LINES[id]);
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
