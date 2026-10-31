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

  // Who-throws chooser (human team)
  const chooser = el('div', 'pt-chooser');
  chooser.setAttribute('role', 'group');
  chooser.setAttribute('aria-label', 'Who throws?');
  chooser.hidden = true;
  const suggestEl = el('p', 'pt-suggest');
  const hintEl = el('div', 'pt-hint');
  hintEl.hidden = true;
  hudEl.append(board, turnEl, chooser, hintEl);

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
    board.hidden = true; turnEl.hidden = true; chooser.hidden = true;
    const c = card('Set up your game', 'pt-setup');
    c.append(el('p', 'pt-blurb', 'You and Pierre play Marcel and Odette, doublette, three boules each.'));
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

  // suggestion: optional one-line advice from the partner, replaced later by setSuggestion()
  function showChooser(players, suggestion) {
    chooser.textContent = '';
    chooser.append(el('span', 'pt-chooser-label', 'Who throws?'));
    suggestEl.textContent = suggestion || '';
    let first = null;
    for (const p of players) {
      const b = button(p.isHuman ? 'You throw' : `${p.name} throws`, 'pt-btn pt-who', () => {
        hideChooser();
        cb.onChoose(p.id);
      });
      if (!first) first = b;
      chooser.append(b);
    }
    chooser.append(suggestEl);
    chooser.hidden = false;
    focusSoon(first);
  }
  function setSuggestion(text) { suggestEl.textContent = text; }
  function hideChooser() { chooser.hidden = true; chooser.textContent = ''; }

  // One-time how-to hint with a dismiss button
  function showHint(text) {
    hintEl.textContent = '';
    hintEl.append(el('span', 'pt-hint-text', text));
    hintEl.append(button('Got it', 'pt-hint-close', () => { hideHint(); if (cb.onHintDismiss) cb.onHintDismiss(); }));
    hintEl.hidden = false;
  }
  function hideHint() { hintEl.hidden = true; }

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

  return { say, showSetup, hideOverlay, update, showChooser, setSuggestion, hideChooser, showHint, hideHint, showMeneEnd, showGameOver };
}
