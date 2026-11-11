// F61: the CARREAU ! / BIBERON ! overlay. DOM only; the detection is in announce.js. It sits over the canvas, never takes
// pointer events, hides itself (CSS) while the game is paused or a card is open, and never pauses the simulation.
const WORDS = { carreau: 'CARREAU !', biberon: 'BIBERON !' };
const SHOW_MS = 1900;
const SPARKS = 16;
const SPARK_COLOURS = ['#ff2bd6', '#e6ff00', '#00e5ff', '#ffffff', '#ff2a3d', '#2f5bff'];

export function createAnnouncer(root, { audio } = {}) {
  let node = null, timer = 0;
  function clear() {
    clearTimeout(timer);
    if (node) node.remove();
    node = null;
  }
  // true when the overlay is not wanted right now (paused, or a modal card is open)
  const blocked = () => root.classList.contains('is-paused') || !!root.querySelector('.pt-overlay.is-active');
  function show(kind, { force = false, still = false } = {}) {
    if (!WORDS[kind] || (!force && blocked())) return false;
    clear();
    node = document.createElement('div');
    node.className = `pt-announce pt-announce-${kind}`;
    if (force) node.dataset.force = '1'; // debug preview: shown even under a card
    if (still) node.dataset.still = '1'; // debug: a held frame for screenshots (no animation, stays up)
    node.setAttribute('aria-hidden', 'true'); // the status line already says it in words
    const word = document.createElement('span');
    word.className = 'pt-announce-word';
    word.textContent = WORDS[kind];
    node.append(word);
    for (let i = 0; i < SPARKS; i++) {
      const s = document.createElement('i');
      const a = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.4;
      const d = 22 + Math.random() * 20; // % of the overlay width
      s.className = 'pt-spark';
      s.style.setProperty('--dx', `${(Math.cos(a) * d * 1.3).toFixed(1)}cqi`);
      s.style.setProperty('--dy', `${(Math.sin(a) * d * 0.35).toFixed(1)}cqi`);
      s.style.setProperty('--c', SPARK_COLOURS[i % SPARK_COLOURS.length]);
      s.style.setProperty('--delay', `${(0.12 + Math.random() * 0.25).toFixed(2)}s`);
      node.append(s);
    }
    root.append(node);
    if (!still) timer = setTimeout(clear, SHOW_MS + 100);
    if (audio && audio.fanfare) audio.fanfare(kind);
    return true;
  }
  return { show, clear };
}
