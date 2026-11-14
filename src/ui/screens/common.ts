import type { Mode } from '../../app/state';
import { STEPS } from '../../app/state';
import { h, icon } from '../dom';
import { brand } from '../theme';

export const NOTICE = 'Planning aid only. All measurements, positions and guides must be verified clinically before treatment.';

export function footer(): HTMLElement {
  return h('footer', { class: 'footer' },
    h('span', { class: 'notice' }, icon('info', 14), ' ', NOTICE),
    h('span', { class: 'tagline' }, brand.tagline),
  );
}

export function modeSwitch(mode: Mode, set: (m: Mode) => void): HTMLElement {
  const opts: [Mode, string][] = [['staff', 'Staff'], ['doctor', 'Doctor'], ['patient', 'Patient view']];
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Mode' },
    opts.map(([m, label]) => h('button', {
      class: m === mode ? 'on' : '', 'aria-pressed': String(m === mode), onclick: () => set(m),
    }, label)),
  );
}

export function stepper(current: number, maxReached: number, go: (i: number) => void): HTMLElement {
  return h('nav', { class: 'stepper', 'aria-label': 'Workflow steps' },
    STEPS.map((st, i) => {
      const done = i < current && i <= maxReached;
      const active = i === current;
      const enabled = st.ready && i <= maxReached;
      return h('button', {
        class: `step${active ? ' active' : ''}${done ? ' done' : ''}`,
        disabled: !enabled,
        'aria-current': active ? 'step' : undefined,
        title: st.ready ? undefined : 'Coming in a later build',
        onclick: () => go(i),
      },
      h('span', { class: 'step-dot' }, done ? icon('check', 14) : !st.ready ? icon('lock', 13) : String(i + 1)),
      h('span', { class: 'step-label' }, st.label));
    }),
  );
}
