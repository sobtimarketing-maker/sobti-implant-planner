import { AppState, Mode } from '../../app/state';
import { CaseRecord, caseTitle, sitesSummary, age } from '../../core/case/model';
import { deleteCase, listCases } from '../../core/store/db';
import { TIERS } from '../../core/volume/budget';
import { h, icon } from '../dom';
import { brandBlock } from '../theme';
import { footer, modeSwitch } from './common';

export interface HomeActions {
  newCase(): void;
  openCase(c: CaseRecord): void;
  setMode(m: Mode): void;
  rerender(): void;
}

export async function renderHome(root: HTMLElement, s: AppState, act: HomeActions): Promise<void> {
  const cases = await listCases();
  const list = h('div', { class: 'case-list' });
  if (!cases.length) {
    list.append(h('div', { class: 'empty card' },
      h('div', { class: 'empty-title' }, 'No cases yet'),
      h('p', null, 'Start a new case: add the patient, mark the teeth to treat, then open the CBCT.'),
    ));
  }
  for (const c of cases) {
    const a = age(c.patient.dob);
    list.append(h('div', { class: 'case-card card' },
      h('button', { class: 'case-open', onclick: () => act.openCase(c), 'aria-label': `Open case ${caseTitle(c)}` },
        h('span', { class: 'case-avatar' }, icon('user', 22)),
        h('span', { class: 'case-main' },
          h('span', { class: 'case-name' }, caseTitle(c), a !== undefined ? h('span', { class: 'muted' }, ` · ${a} y`) : null),
          h('span', { class: 'case-sub' }, sitesSummary(c)),
          h('span', { class: 'case-meta' },
            c.study ? `CBCT ${c.study.sliceCount} slices` : 'No scan yet', ' · ',
            `edited ${new Date(c.modified).toLocaleString()}`),
        ),
        icon('next', 22),
      ),
      s.mode === 'doctor' ? h('button', {
        class: 'icon-btn danger', 'aria-label': `Delete case ${caseTitle(c)}`,
        onclick: async () => {
          if (!confirm(`Delete the case for ${caseTitle(c)}? This cannot be undone.`)) return;
          await deleteCase(c.id); act.rerender();
        },
      }, icon('trash')) : null,
    ));
  }
  const d = s.device;
  const tier = s.tierOverride ?? d.tier;
  root.append(h('div', { class: 'screen home' },
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-title' }, h('span', { class: 'h-title' }, 'Implant Planner'), h('span', { class: 'muted' }, 'Cases on this device')),
      h('div', { class: 'spacer' }),
      modeSwitch(s.mode, act.setMode),
      brandBlock(),
    ),
    h('main', { class: 'home-body' },
      h('div', { class: 'home-actions' },
        h('button', { class: 'btn primary big', onclick: act.newCase }, icon('plus'), 'New case'),
        h('div', { class: 'device-pill', title: 'Device check' },
          icon('info', 16),
          ` ${TIERS[tier].label} quality · ${d.ramGb}${d.ramSource === 'browser' && d.ramGb >= 8 ? '+' : ''} GB RAM · ${d.webgl2 ? 'WebGL2 OK' : 'no WebGL2'}`),
      ),
      list,
    ),
    footer(),
  ));
}
