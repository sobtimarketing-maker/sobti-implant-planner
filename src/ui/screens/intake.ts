// Step 1: patient, medical flags, planned treatment per tooth, and the CBCT.
import type { AppState } from '../../app/state';
import { age, CaseRecord, LOWER, MedicalFlags, toothName, Treatment, TREATMENTS, UPPER } from '../../core/case/model';
import { h, icon } from '../dom';

export interface IntakeActions {
  changed(): void;
  loadFiles(files: File[]): void;
  next(): void;
}

type Field = { key: keyof CaseRecord['patient']; label: string; type?: string; placeholder?: string; wide?: boolean };

const PATIENT_FIELDS: Field[] = [
  { key: 'name', label: 'Full name', placeholder: 'Patient name', wide: true },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'patientId', label: 'Patient / file no.' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'referredBy', label: 'Referred by' },
  { key: 'complaint', label: 'Chief complaint', placeholder: 'e.g. missing lower right back teeth, wants fixed teeth', wide: true },
];

const MEDICAL: [keyof MedicalFlags, string][] = [
  ['diabetes', 'Diabetes'], ['smoker', 'Smoker'], ['bisphosphonates', 'Bisphosphonates'],
  ['anticoagulants', 'Blood thinners'], ['cardiac', 'Heart condition'], ['radiotherapy', 'Head/neck radiotherapy'],
  ['pregnancy', 'Pregnancy'],
];

export function renderIntake(s: AppState, c: CaseRecord, act: IntakeActions, load: { busy: boolean; progress: number; message: string; error: string }): HTMLElement {
  const p = c.patient;
  const input = (f: Field) => {
    const id = `f-${f.key}`;
    return h('label', { class: `field${f.wide ? ' wide' : ''}`, for: id },
      h('span', null, f.label),
      h('input', {
        id, type: f.type ?? 'text', value: p[f.key] as string, placeholder: f.placeholder ?? '', autocomplete: 'off',
        oninput: (e: Event) => { (p as Record<string, unknown>)[f.key] = (e.target as HTMLInputElement).value; act.changed(); if (f.key === 'dob') ageOut.textContent = ageText(); },
      }),
    );
  };
  const ageText = () => { const a = age(p.dob); return a === undefined ? '' : `${a} years`; };
  const ageOut = h('span', { class: 'muted age' }, ageText());

  const sex = h('div', { class: 'field' }, h('span', null, 'Sex'),
    h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Sex' },
      ([['F', 'Female'], ['M', 'Male'], ['O', 'Other']] as const).map(([v, l]) => h('button', {
        class: p.sex === v ? 'on' : '', 'aria-pressed': String(p.sex === v),
        onclick: (e: Event) => {
          p.sex = v; act.changed();
          const grp = (e.currentTarget as HTMLElement).parentElement!;
          [...grp.children].forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
        },
      }, l))));

  const medical = h('div', { class: 'chips' }, MEDICAL.map(([k, l]) => h('button', {
    class: `chip${p.medical[k] ? ' on' : ''}`, 'aria-pressed': String(!!p.medical[k]),
    onclick: (e: Event) => { (p.medical as unknown as Record<string, boolean>)[k] = !p.medical[k]; (e.currentTarget as HTMLElement).classList.toggle('on'); act.changed(); },
  }, l)));

  // ---- Tooth chart and per-site plan
  const siteList = h('div', { class: 'site-list' });
  const chart = h('div', { class: 'tooth-chart', role: 'group', 'aria-label': 'Tooth chart (FDI)' });
  const drawChart = () => {
    chart.replaceChildren(
      h('div', { class: 'chart-side' }, h('span', null, 'Patient right'), h('span', null, 'Patient left')),
      ...[UPPER, LOWER].map((row, r) => h('div', { class: `tooth-row ${r ? 'lower' : 'upper'}` },
        row.map((fdi) => {
          const site = c.plan.sites.find((x) => x.fdi === fdi);
          return h('button', {
            class: `tooth${site ? ` sel t-${site.treatment}` : ''}${fdi % 10 >= 6 ? ' molar' : ''}`,
            'aria-pressed': String(!!site), 'aria-label': `Tooth ${fdi}, ${toothName(fdi)}`,
            onclick: () => {
              const i = c.plan.sites.findIndex((x) => x.fdi === fdi);
              if (i >= 0) c.plan.sites.splice(i, 1);
              else { c.plan.sites.push({ fdi, treatment: 'implant', notes: '' }); c.plan.sites.sort((a, b) => a.fdi - b.fdi); }
              act.changed(); drawChart();
            },
          }, String(fdi));
        }))),
    );
    siteList.replaceChildren(...(c.plan.sites.length ? c.plan.sites.map((site) => h('div', { class: 'site-row' },
      h('span', { class: 'site-fdi' }, String(site.fdi)),
      h('span', { class: 'site-name' }, toothName(site.fdi)),
      h('select', {
        'aria-label': `Treatment for tooth ${site.fdi}`,
        onchange: (e: Event) => { site.treatment = (e.target as HTMLSelectElement).value as Treatment; act.changed(); drawChart(); },
      }, TREATMENTS.map((t) => h('option', { value: t.id, selected: t.id === site.treatment }, t.label))),
      h('input', { class: 'site-notes', placeholder: 'Notes', value: site.notes, 'aria-label': `Notes for tooth ${site.fdi}`, oninput: (e: Event) => { site.notes = (e.target as HTMLInputElement).value; act.changed(); } }),
    )) : [h('p', { class: 'muted' }, 'Tap the teeth to treat. Each one starts as "Implant + crown"; change it in the list.')]));
  };
  drawChart();

  const sel = <K extends keyof CaseRecord['plan']>(key: K, label: string, opts: [string, string][]) => h('label', { class: 'field' },
    h('span', null, label),
    h('select', { onchange: (e: Event) => { (c.plan as Record<string, unknown>)[key] = (e.target as HTMLSelectElement).value; act.changed(); } },
      opts.map(([v, l]) => h('option', { value: v, selected: c.plan[key] === v }, l))));
  const text = <K extends keyof CaseRecord['plan']>(key: K, label: string, type = 'text', placeholder = '', wide = false) => h('label', { class: `field${wide ? ' wide' : ''}` },
    h('span', null, label),
    h('input', { type, value: c.plan[key] as string, placeholder, oninput: (e: Event) => { (c.plan as Record<string, unknown>)[key] = (e.target as HTMLInputElement).value; act.changed(); } }));

  // ---- CBCT card
  const study = c.study;
  const cbct = h('section', { class: 'card cbct-card' },
    h('h2', null, icon('scan'), ' CBCT scan'),
    study ? h('div', { class: 'study' },
      h('div', { class: 'ok-line' }, icon('check', 16), ` Loaded ${study.sliceCount} slices`),
      h('dl', null,
        h('dt', null, 'Scanner'), h('dd', null, [study.meta.manufacturer, study.meta.model].filter(Boolean).join(' ') || '–'),
        h('dt', null, 'Scan date'), h('dd', null, study.meta.studyDate ? `${study.meta.studyDate.slice(6, 8)}/${study.meta.studyDate.slice(4, 6)}/${study.meta.studyDate.slice(0, 4)}` : '–'),
        h('dt', null, 'Field of view'), h('dd', null, study.sourceDims.map((d, i) => (d * study.sourceSpacing[i]).toFixed(0)).join(' × ') + ' mm'),
        h('dt', null, 'Voxel'), h('dd', null, `${study.sourceSpacing[0].toFixed(2)} mm, working at ${study.workingSpacing[0].toFixed(2)} mm`),
      ),
      study.warnings.map((w) => h('div', { class: 'warn-line' }, w)),
    ) : h('p', { class: 'muted' }, 'Open the CBCT export: one ZIP file, or select all the DICOM (.dcm) files. Nothing leaves this device.'),
    load.busy ? h('div', { class: 'progress' },
      h('div', { class: 'bar' }, h('span', { style: `width:${Math.round(load.progress * 100)}%` })),
      h('span', { class: 'muted' }, load.message)) : null,
    load.error ? h('div', { class: 'error-line', role: 'alert' }, load.error) : null,
    h('label', { class: `btn ${study ? 'secondary' : 'primary'} big file-btn${load.busy ? ' disabled' : ''}` },
      icon('folder'), study ? 'Replace CBCT' : 'Open CBCT',
      h('input', {
        type: 'file', multiple: true, accept: '.zip,.dcm,.DCM,application/zip,application/dicom,*/*', disabled: load.busy,
        onchange: (e: Event) => { const fl = (e.target as HTMLInputElement).files; if (fl && fl.length) act.loadFiles([...fl]); },
      })),
    study ? h('button', { class: 'btn primary big', onclick: act.next }, 'Check orientation', icon('next')) : null,
  );

  return h('div', { class: 'intake' },
    h('div', { class: 'intake-main' },
      h('section', { class: 'card' },
        h('h2', null, icon('user'), ' Patient'),
        h('div', { class: 'form-grid' }, PATIENT_FIELDS.slice(0, 2).map(input), ageOut, sex, PATIENT_FIELDS.slice(2).map(input)),
        h('h3', null, 'Medical history'),
        medical,
        h('div', { class: 'form-grid' },
          h('label', { class: 'field wide' }, h('span', null, 'Allergies'), h('input', { value: p.medical.allergies, oninput: (e: Event) => { p.medical.allergies = (e.target as HTMLInputElement).value; act.changed(); } })),
          h('label', { class: 'field wide' }, h('span', null, 'Other medical notes'), h('input', { value: p.medical.other, oninput: (e: Event) => { p.medical.other = (e.target as HTMLInputElement).value; act.changed(); } })),
        ),
      ),
      h('section', { class: 'card' },
        h('h2', null, icon('tooth'), ' Planned treatment'),
        chart,
        siteList,
        h('div', { class: 'form-grid' },
          sel('prosthesis', 'Prosthesis', [['single-crowns', 'Single crowns'], ['splinted-crowns', 'Splinted crowns'], ['bridge', 'Implant bridge'], ['overdenture', 'Overdenture'], ['full-arch', 'Full arch']]),
          sel('retention', 'Retention', [['screw', 'Screw-retained'], ['cement', 'Cement-retained'], ['undecided', 'Decide later']]),
          text('implantSystem', 'Implant system (any brand)', 'text', 'e.g. any maker / system / line'),
          sel('guideType', 'Surgical guide', [['tooth-supported', 'Tooth-supported'], ['tissue-supported', 'Tissue-supported'], ['bone-supported', 'Bone-supported'], ['none', 'Freehand (no guide)']]),
          text('surgeon', 'Surgeon'),
          text('surgeryDate', 'Planned surgery date', 'date'),
          h('label', { class: 'field wide' }, h('span', null, 'Plan notes'),
            h('textarea', { rows: 3, oninput: (e: Event) => { c.plan.notes = (e.target as HTMLTextAreaElement).value; act.changed(); } }, c.plan.notes)),
        ),
      ),
    ),
    h('aside', { class: 'intake-side' }, cbct),
  );
}
