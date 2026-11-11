// HUD: setup screen, scoreboard, boules in hand, who-throws chooser, mène and game-over panels.
// DOM only: it receives state and callbacks, and holds no game logic.

const TEAM_NAMES = ['You & Pierre', 'Marcel & Odette'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text, cls, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const focusSoon = (node) => {
  if (node) setTimeout(() => node.focus({ preventScroll: true }), 0);
};

// root: the #petanque container; callbacks: { onStart({ target, difficulty }), onNext, onPlayAgain, onChoose(playerId) }
export function createHud(root, hudEl, cb) {
  const status = root.querySelector('.petanque-status');
  const say = (text) => { if (status) status.textContent = text; };

  // Overlay sits on top of the canvas
  const overlay = el('div', 'pt-overlay');
  root.append(overlay);

  // Scoreboard
  hudEl.textContent = '';
  const board = el('div', 'pt-board');
  board.hidden = true;
  const teamEls = TEAM_NAMES.map((name, t) => {
    const box = el('div', 'pt-team pt-team' + t);
    const head = el('div', 'pt-team-head');
    const nm = el('span', 'pt-team-name', name);
    const score = el('span', 'pt-score', '0');
    head.append(nm, score);
    const players = el('div', 'pt-players');
    box.append(head, players);
    return { box, score, players };
  });
  const meneEl = el('div', 'pt-mene');
  board.append(teamEls[0].box, meneEl, teamEls[1].box);
  const turnEl = el('div', 'pt-turn');
  turnEl.hidden = true;

  const hintEl = el('div', 'pt-hint');
  hintEl.hidden = true;
  // Dock: hint toast, turn banner and status line (a compact strip at the bottom while playing).
  // The who-throws chooser is a card in the overlay (see showChooser).
  const dock = el('div', 'pt-dock');
  dock.append(hintEl, turnEl);
  if (status) dock.append(status);
  // Paused bar (shown on the page after leaving the full-window view mid-game)
  const pausedEl = el('div', 'pt-paused');
  pausedEl.hidden = true;
  pausedEl.setAttribute('role', 'group');
  pausedEl.setAttribute('aria-label', 'Game paused');
  const resumeBtn = button('Resume game', 'pt-btn pt-resume', () => cb.onResume && cb.onResume());
  pausedEl.append(el('span', 'pt-paused-text', 'Game paused.'), resumeBtn,
    button('New game', 'pt-btn pt-btn-alt pt-paused-new', () => cb.onNewGame && cb.onNewGame()));
  hudEl.append(pausedEl, board, dock);

  let setupState = { target: 13, difficulty: 'medium' };

  function clearOverlay() { overlay.textContent = ''; overlay.className = 'pt-overlay'; }

  function card(title, cls) {
    clearOverlay();
    overlay.classList.add('is-active', cls);
    const c = el('div', 'pt-card');
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'false');
    const h = el('h2', 'pt-card-title', title);
    h.id = 'pt-card-title';
    c.setAttribute('aria-labelledby', h.id);
    c.append(h);
    overlay.append(c);
    return c;
  }

  function radioGroup(card, legendText, name, options, value, onChange) {
    const fs = el('fieldset', 'pt-fieldset');
    fs.append(el('legend', null, legendText));
    for (const [val, label] of options) {
      const lab = el('label', 'pt-choice');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = name; input.value = String(val);
      input.checked = String(val) === String(value);
      input.addEventListener('change', () => onChange(val));
      lab.append(input, el('span', null, label));
      fs.append(lab);
    }
    card.append(fs);
  }

  function showSetup(initial) {
    setupState = { ...setupState, ...(initial || {}) };
    board.hidden = true; turnEl.hidden = true;
    const c = card('Set up your game', 'pt-setup');
    c.append(el('p', 'pt-blurb', 'You and Pierre play Marcel and Odette, doublette, three boules each.'));
    if (setupState.cast) {
      const ul = el('ul', 'pt-cast');
      ul.setAttribute('aria-label', 'The players');
      for (const m of setupState.cast) {
        const li = el('li', 'pt-cast-item pt-cast' + m.team);
        li.append(el('strong', null, m.name), el('span', null, ` \u2014 ${m.bio}`));
        ul.append(li);
      }
      c.append(ul);
    }
    radioGroup(c, 'Play to', 'pt-target', [[13, '13 points'], [7, '7 points (quick)']],
      setupState.target, (v) => { setupState.target = +v; });
    radioGroup(c, 'Opponents', 'pt-diff', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']],
      setupState.difficulty, (v) => { setupState.difficulty = v; });
    const start = button('Start game', 'pt-btn pt-start', () => cb.onStart({ ...setupState }));
    c.append(start);
    say('Choose your game options, then start.');
    focusSoon(start);
  }

  function hideOverlay() { clearOverlay(); }

  function dots(n) {
    const d = el('span', 'pt-dots');
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', n + (n === 1 ? ' boule left' : ' boules left'));
    for (let i = 0; i < 3; i++) d.append(el('span', 'pt-dot' + (i < n ? ' is-full' : '')));
    return d;
  }

  // match: rules state; turn: { playerId, text } or null
  function update(match, turn) {
    board.hidden = false;
    for (const t of [0, 1]) {
      teamEls[t].score.textContent = match.scores[t];
      teamEls[t].box.classList.toggle('is-turn', !!turn && turn.team === t);
      teamEls[t].players.textContent = '';
      for (const p of match.players.filter((q) => q.team === t)) {
        const row = el('div', 'pt-player' + (turn && turn.playerId === p.id ? ' is-active' : ''));
        row.append(el('span', 'pt-pname', p.name), dots(p.boulesLeft));
        teamEls[t].players.append(row);
      }
    }
    meneEl.textContent = `Mène ${match.mene} · first to ${match.target}`;
    turnEl.hidden = !turn;
    turnEl.textContent = turn ? turn.text : '';
  }

  // Who-throws card (human team), centred over the court with a translucent backdrop.
  // players: the throwers with boules; suggestion: Pierre's advice (replaced later by setSuggestion).
  let chooserCard = null;
  let suggestEl = null;
  let whoBtns = [];
  function showChooser(players, suggestion) {
    const c = card('Your team to play', 'pt-choose');
    c.classList.add('pt-choose-card');
    c.tabIndex = -1;
    c.addEventListener('keydown', onChooserKey);
    chooserCard = c;
    suggestEl = el('p', 'pt-suggest', suggestion || '');
    suggestEl.id = 'pt-choose-suggest';
    c.append(suggestEl);
    const group = el('div', 'pt-who-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Who throws?');
    whoBtns = players.map((p) => {
      const b = button('', 'pt-btn pt-who', () => {
        hideChooser();
        cb.onChoose(p.id);
      });
      b.append(el('span', 'pt-who-label', p.isHuman ? 'You throw' : `${p.name} throws`));
      b.dataset.player = p.id;
      b.setAttribute('aria-describedby', suggestEl.id);
      group.append(b);
      return b;
    });
    c.append(group);
    focusSoon(c);
  }
  // playerId: the one Pierre says should throw; they get a "Pierre suggests" tag (never pre-selected)
  function setSuggestion(text, playerId) {
    if (suggestEl) suggestEl.textContent = text;
    for (const b of whoBtns) {
      const on = playerId !== undefined && b.dataset.player === playerId;
      b.classList.toggle('is-suggested', on);
      const tag = b.querySelector('.pt-who-tag');
      if (on && !tag) b.append(el('span', 'pt-who-tag', 'Pierre suggests'));
      if (!on && tag) tag.remove();
    }
  }
  // Arrow keys move between the two throw buttons (wrapping); Enter and Space are native button activation
  function onChooserKey(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || !whoBtns.length) return;
    e.preventDefault();
    const n = whoBtns.length;
    const i = whoBtns.indexOf(document.activeElement);
    const j = i < 0 ? (step > 0 ? 0 : n - 1) : (i + step + n) % n;
    whoBtns[j].focus();
  }
  function hideChooser() {
    if (!chooserCard) return;
    chooserCard = null; suggestEl = null; whoBtns = [];
    if (overlay.classList.contains('pt-choose')) clearOverlay();
  }

  // One-time how-to hint with a dismiss button
  function showHint(text) {
    hintEl.textContent = '';
    hintEl.append(el('span', 'pt-hint-text', text));
    hintEl.append(button('Got it', 'pt-hint-close', () => { hideHint(); if (cb.onHintDismiss) cb.onHintDismiss(); }));
    hintEl.hidden = false;
  }
  function hideHint() { hintEl.hidden = true; }

  function showPaused(on) {
    pausedEl.hidden = !on;
    if (on) focusSoon(resumeBtn);
  }

  // info: { text, detail, scores, nextLabel }
  function showMeneEnd(info) {
    const c = card(info.text, 'pt-mene-end');
    if (info.detail) c.append(el('p', 'pt-blurb', info.detail));
    const next = button('Next mène', 'pt-btn pt-next', cb.onNext);
    c.append(next);
    say(info.text + (info.detail ? (/[.!?]$/.test(info.text) ? ' ' : '. ') + info.detail : ''));
    focusSoon(next);
  }

  // info: { text, detail }
  function showGameOver(info) {
    const c = card(info.text, 'pt-gameover');
    if (info.detail) c.append(el('p', 'pt-blurb', info.detail));
    const again = button('Play again', 'pt-btn pt-again', cb.onPlayAgain);
    c.append(again);
    say(info.text + (info.detail ? (/[.!?]$/.test(info.text) ? ' ' : '. ') + info.detail : ''));
    focusSoon(again);
  }

  return { say, showSetup, hideOverlay, update, showChooser, setSuggestion, hideChooser, showHint, hideHint, showPaused, showMeneEnd, showGameOver };
}
