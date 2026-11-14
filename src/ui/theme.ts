// White-label pack: every clinic string, colour and logo comes from brand/tokens.json.
import tokens from '../../brand/tokens.json';
import logoMark from '../../brand/SDC-blue-1.svg';

export const brand = tokens;

export function applyTheme(root: HTMLElement = document.documentElement): void {
  const c = tokens.colors;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--royal', c.royal);
  set('--navy', c.navy);
  set('--champagne', c.champagne);
  set('--warm-gold', c.warmGold);
  set('--bright-gold', c.brightGold);
  set('--ivory', c.ivory);
  set('--white', c.white);
  set('--safe', c.safe);
  set('--warn', c.warn);
  set('--danger', c.danger);
  set('--font-ui', `'${tokens.fonts.ui}', system-ui, sans-serif`);
  set('--font-heading', `'${tokens.fonts.heading}', Georgia, serif`);
  document.title = `${tokens.clinic} · Implant Planner`;
}

/** Logo mark (original artwork, unchanged) plus clinic name and tagline. */
export function brandBlock(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'brand';
  el.setAttribute('aria-label', tokens.clinic);
  const mark = document.createElement('span');
  mark.className = 'brand-mark';
  mark.innerHTML = logoMark.replace(/<\?xml[^>]*>/, ''); // bundled, trusted asset
  const text = document.createElement('div');
  text.className = 'brand-text';
  const name = document.createElement('span');
  name.className = 'brand-name';
  name.textContent = tokens.clinic;
  const tag = document.createElement('span');
  tag.className = 'brand-tag';
  tag.textContent = tokens.tagline;
  text.append(name, tag);
  el.append(mark, text);
  return el;
}
