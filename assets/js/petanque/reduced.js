// F113: the prefers-reduced-motion predicate, shared. The MediaQueryList is created once and a change listener keeps the
// cached flag current (matchMedia was called about 20 times per frame). Safe without a window (node tests): false.
let mql = null, flag = false, init = false;
export function prefersReducedMotion() {
  if (!init) {
    init = true;
    try {
      mql = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mql) {
        flag = mql.matches;
        const on = (e) => { flag = e.matches; };
        if (mql.addEventListener) mql.addEventListener('change', on); else if (mql.addListener) mql.addListener(on);
      }
    } catch (e) { mql = null; }
  }
  return flag;
}
