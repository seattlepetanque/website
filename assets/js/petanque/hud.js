// HUD: setup screen, scoreboard, boules in hand, who-throws chooser, mène and game-over panels.
// DOM only: it receives state and callbacks, and holds no game logic.

import { settings, MODE_INFO } from './settings.js';

const TEAM_NAMES = ['You & Pierre', 'Marcel & Odette']; // initial labels; update() sets them from the match

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

// F48: translucent press-and-hold icon buttons (pan the view, read the ground, overhead view). One finger or the mouse
// holds an icon (pointer capture, so sliding off it keeps the hold); Space or Enter holds it from the keyboard. The hold
// ends on release, pointercancel, lost capture, blur or Escape, and never opens a context menu or selects text.
// defs: [{ cls, label, title, svg, onHold({ dirX, dirY, pointer }), onRelease() }]. dirX/dirY (-1..1) say where on the
// icon the pointer is (the pan icon uses them as four arrows); they are 0 for the keyboard.
export function createHoldIcons(defs) {
  const wrap = el('div', 'pc-holds');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Hold to change the view');
  wrap.hidden = true;
  const buttons = defs.map((d) => {
    const b = button('', 'pc-hold ' + d.cls);
    b.innerHTML = d.svg;
    b.setAttribute('aria-label', d.label);
    b.title = d.title || d.label;
    b.setAttribute('aria-pressed', 'false');
    let pointerId = null, keyHeld = false;
    const dirOf = (e) => {
      const r = b.getBoundingClientRect(), nx = (e.clientX - r.left - r.width / 2) / (r.width / 2), ny = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      if (Math.hypot(nx, ny) < 0.18) return { dirX: 0, dirY: 0 }; // dead centre: no direction
      return Math.abs(nx) >= Math.abs(ny) ? { dirX: Math.sign(nx), dirY: 0 } : { dirX: 0, dirY: Math.sign(ny) };
    };
    const held = () => pointerId !== null || keyHeld;
    const start = (info) => { b.classList.add('is-held'); b.setAttribute('aria-pressed', 'true'); d.onHold(info); };
    const end = () => {
      if (!held() && !b.classList.contains('is-held')) return;
      pointerId = null; keyHeld = false;
      b.classList.remove('is-held'); b.setAttribute('aria-pressed', 'false');
      d.onRelease();
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or released pointer */ }
      start({ ...dirOf(e), pointer: true });
    });
    b.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) d.onHold({ ...dirOf(e), pointer: true }); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, (e) => { if (e.pointerId === pointerId) end(); });
    b.addEventListener('pointerleave', (e) => { if (e.pointerId === pointerId && !b.hasPointerCapture(e.pointerId)) end(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('dragstart', (e) => e.preventDefault());
    b.addEventListener('click', (e) => e.preventDefault());
    b.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat && !held()) { keyHeld = true; start({ dirX: 0, dirY: 0, pointer: false }); } }
      else if (e.key === 'Escape' && held()) { e.preventDefault(); e.stopPropagation(); end(); }
    });
    b.addEventListener('keyup', (e) => { if ((e.key === ' ' || e.key === 'Enter') && keyHeld) end(); });
    b.addEventListener('blur', end);
    b.releaseHold = end;
    return b;
  });
  wrap.append(...buttons);
  return {
    el: wrap, buttons,
    setVisible(on) { if (!on) for (const b of buttons) b.releaseHold(); wrap.hidden = !on; },
  };
}

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
    return { box, score, players, nm };
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
  // F32: three actions only: Resume, New game (back to setup) and End game (leave the full-window view for the page)
  const resumeBtn = button('Resume', 'pt-btn pt-resume', () => cb.onResume && cb.onResume());
  pausedEl.append(el('span', 'pt-paused-text', 'Game paused.'), resumeBtn,
    button('New game', 'pt-btn pt-btn-alt pt-paused-new', () => cb.onNewGame && cb.onNewGame()),
    button('End game', 'pt-btn pt-btn-alt pt-paused-end', () => cb.onEndGame && cb.onEndGame()));
  // F11: "who holds the point" banner, shown before each aim (main.js drives its 2 s hold on the game clock)
  const holdEl = el('div', 'pt-holding');
  holdEl.setAttribute('aria-live', 'polite');
  hudEl.append(pausedEl, board, holdEl, dock);

  let setupState = { target: 13, difficulty: 'medium', partner: settings.partner };

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

  // One compact row: a bold label on the left, the radio options inline beside it
  function radioGroup(card, legendText, name, options, value, onChange, cls = '') {
    const fs = el('div', 'pt-fieldset ' + cls);
    fs.setAttribute('role', 'radiogroup');
    fs.setAttribute('aria-label', legendText);
    fs.append(el('span', 'pt-legend', legendText));
    const opts = el('div', 'pt-opts');
    for (const [val, label] of options) {
      const lab = el('label', 'pt-choice');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = name; input.value = String(val);
      input.checked = String(val) === String(value);
      input.addEventListener('change', () => onChange(val));
      lab.append(input, el('span', null, label));
      opts.append(lab);
    }
    fs.append(opts);
    card.append(fs);
    return fs;
  }

  function showSetup(initial) {
    setupState = { ...setupState, ...(initial || {}) };
    board.hidden = true; turnEl.hidden = true;
    const c = card('Set up your game', 'pt-setup');
    const cast = setupState.cast || [];
    const nameOf = (id) => (cast.find((m) => m.id === id) || { name: id }).name;
    const blurb = el('p', 'pt-blurb');
    const bioEl = el('p', 'pt-partner-bio');
    const refresh = () => {
      const part = setupState.partner;
      const opp = cast.filter((m) => m.id !== part).map((m) => m.name);
      blurb.textContent = `You and ${nameOf(part)} play ${opp.join(' and ')}, doublette, three boules each.`;
      const m = cast.find((q) => q.id === part);
      bioEl.textContent = m ? `${m.name}: ${m.bio}.` : '';
    };
    c.append(blurb);
    if (cast.length) {
      // F45: choose your partner; the other two are the opponents
      const fs = el('div', 'pt-fieldset pt-partner');
      fs.setAttribute('role', 'radiogroup');
      fs.setAttribute('aria-label', 'Your partner');
      fs.append(el('span', 'pt-legend', 'Your partner'));
      const row = el('div', 'pt-partners');
      for (const m of cast) {
        const lab = el('label', 'pt-partner-choice');
        const input = document.createElement('input');
        input.type = 'radio'; input.name = 'pt-partner'; input.value = m.id;
        input.checked = m.id === setupState.partner;
        input.addEventListener('change', () => { setupState.partner = m.id; settings.partner = m.id; refresh(); });
        lab.append(input, el('strong', null, m.name), el('span', 'pt-partner-tag', m.tag || ''));
        row.append(lab);
      }
      fs.append(row);
      c.append(fs, bioEl);
    }
    refresh();
    radioGroup(c, 'Play to', 'pt-target', [[13, '13 points'], [7, '7 points (quick)']],
      setupState.target, (v) => { setupState.target = +v; });
    radioGroup(c, 'Opponents', 'pt-diff', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']],
      setupState.difficulty, (v) => { setupState.difficulty = v; });
    const modeDesc = el('p', 'pt-mode-desc', MODE_INFO[settings.mode]);
    radioGroup(c, 'Pace', 'pt-mode', [['slow', 'Slow'], ['quick', 'Quick']], settings.mode,
      (v) => { settings.mode = v; modeDesc.textContent = MODE_INFO[v]; }, 'pt-modes');
    c.append(modeDesc);
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
      const members = match.players.filter((q) => q.team === t);
      if (members.length) teamEls[t].nm.textContent = [...members].sort((a, b) => (b.isHuman ? 1 : 0) - (a.isHuman ? 1 : 0)).map((q) => q.name).join(' & ');
      for (const p of members) {
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
  // players: the throwers with boules; suggestion: your partner's advice (replaced later by setSuggestion).
  let chooserCard = null;
  let suggestEl = null;
  let whoBtns = [];
  let advisor = 'Pierre'; // the partner who suggests (F45: whoever you chose)
  function showChooser(players, suggestion) {
    const partner = players.find((p) => !p.isHuman);
    if (partner) advisor = partner.name;
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
  // playerId: the one your partner says should throw; they get a "<Partner> suggests" tag (never pre-selected)
  function setSuggestion(text, playerId) {
    if (suggestEl) suggestEl.textContent = text;
    for (const b of whoBtns) {
      const on = playerId !== undefined && b.dataset.player === playerId;
      b.classList.toggle('is-suggested', on);
      const tag = b.querySelector('.pt-who-tag');
      if (on && !tag) b.append(el('span', 'pt-who-tag', `${advisor} suggests`));
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

  // F11: text as composed by main.js, team 0 | 1 for the accent. Fades in and out through the is-on class (CSS).
  function showHolding(text, team) {
    holdEl.textContent = text;
    holdEl.classList.toggle('pt-holding1', team === 1);
    holdEl.classList.add('is-on');
  }
  function hideHolding() { holdEl.classList.remove('is-on'); }

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

  // E04: "Yellow card!" when a hand-placed cochonnet comes to rest out of bounds. info: { detail, button }
  function showYellowCard(info, onOk) {
    const c = card('Yellow card!', 'pt-yellow');
    c.classList.add('pt-yellow-card');
    c.append(el('p', 'pt-blurb', 'Place the cochonnet correctly!'));
    if (info.detail) c.append(el('p', 'pt-blurb', info.detail));
    say('Yellow card! Place the cochonnet correctly!' + (info.detail ? ' ' + info.detail : ''));
    if (info.button) {
      const ok = button('Place it again', 'pt-btn pt-next', () => { hideOverlay(); onOk && onOk(); });
      c.append(ok);
      focusSoon(ok);
    }
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

  return { say, showSetup, hideOverlay, update, showChooser, setSuggestion, hideChooser, showHint, hideHint, showHolding, hideHolding, showPaused, showMeneEnd, showYellowCard, showGameOver };
}
