import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  AlertTriangle, Calendar, ChevronRight, Cigarette, FileText,
  Info, Keyboard, Mic, Tablet, User,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// Constantes anatómicas FDI
// ─────────────────────────────────────────────────────────────────
const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const FDI_ALL = [...FDI_UPPER, ...FDI_LOWER];
const POS_FACIAL = ['MV', 'MB', 'DV'];
const POS_LINGUAL = ['DL', 'ML', 'MB_PAL'];
const POS_ALL = [...POS_FACIAL, ...POS_LINGUAL];

const toothCategory = (fdi) => {
  const last = fdi % 10;
  if (last === 1 || last === 2) return 'incisor';
  if (last === 3) return 'canine';
  if (last === 4 || last === 5) return 'premolar';
  return 'molar';
};

// ─────────────────────────────────────────────────────────────────
// Mock data — María Pérez Rodríguez (SPEC §12.1)
// ─────────────────────────────────────────────────────────────────
const patient = {
  name: 'María Pérez Rodríguez',
  age: 38,
  fileNumber: 'EXP-2024-1015',
  phone: '+52 999 112 2334',
};

const SPECIFIC_SITES = {
  '16-MV':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '16-MB':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '16-DV':     { pdMm: 7, recMm: 2, bop: true,  plaque: true,  suppuration: false },
  '16-MB_PAL': { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '16-ML':     { pdMm: 4, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '16-DL':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '26-MV':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '26-MB':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '26-DV':     { pdMm: 7, recMm: 2, bop: true,  plaque: true,  suppuration: true  },
  '26-MB_PAL': { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '26-ML':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '26-DL':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: true  },
  '31-MV':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '31-MB':     { pdMm: 4, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '31-DV':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '31-MB_PAL': { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '31-ML':     { pdMm: 4, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '31-DL':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '41-MV':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '41-MB':     { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '41-DV':     { pdMm: 4, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '41-MB_PAL': { pdMm: 4, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '41-ML':     { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '41-DL':     { pdMm: 4, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '36-MV':     { pdMm: 5, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '36-MB':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '36-DV':     { pdMm: 5, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '36-MB_PAL': { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '36-ML':     { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '36-DL':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '46-MV':     { pdMm: 5, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '46-MB':     { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '46-DV':     { pdMm: 6, recMm: 1, bop: true,  plaque: true,  suppuration: false },
  '46-MB_PAL': { pdMm: 5, recMm: 0, bop: true,  plaque: true,  suppuration: false },
  '46-ML':     { pdMm: 5, recMm: 0, bop: true,  plaque: false, suppuration: false },
  '46-DL':     { pdMm: 5, recMm: 1, bop: true,  plaque: true,  suppuration: false },
};

const SPECIFIC_TOOTH = {
  16: { mobility: 1, furcation: 2 },
  26: { mobility: 1, furcation: 1 },
  31: { mobility: 2, furcation: 0 },
  41: { mobility: 2, furcation: 0 },
  36: { mobility: 1, furcation: 1 },
  46: { mobility: 1, furcation: 1 },
};

// PRNG determinístico (seed fija → mismo periodontograma cada render)
function makeRand(seed) {
  let t = seed;
  return () => {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateInitialSites() {
  const sites = [];
  const rand = makeRand(42);
  for (const fdi of FDI_ALL) {
    const cat = toothCategory(fdi);
    for (const pos of POS_ALL) {
      const key = `${fdi}-${pos}`;
      if (SPECIFIC_SITES[key]) {
        sites.push({ fdi, position: pos, ...SPECIFIC_SITES[key] });
      } else {
        const isMolar = cat === 'molar';
        const isAnt = cat === 'incisor' || cat === 'canine';
        const lo = isMolar ? 4 : isAnt ? 3 : 4;
        const hi = isMolar ? 5 : isAnt ? 4 : 5;
        const pd = lo + Math.floor(rand() * (hi - lo + 1));
        sites.push({
          fdi, position: pos,
          pdMm: pd, recMm: 0,
          bop: rand() > 0.25,
          plaque: rand() > 0.15,
          suppuration: false,
        });
      }
    }
  }
  return sites;
}

function generateInitialTooth() {
  return FDI_ALL.map((fdi) => ({
    fdi,
    mobility: SPECIFIC_TOOTH[fdi]?.mobility ?? 0,
    furcation: SPECIFIC_TOOTH[fdi]?.furcation ?? 0,
    absent: false,
    isImplant: false,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function computeMetrics(sites, teeth) {
  const present = sites.filter((s) => {
    const t = teeth.find((tt) => tt.fdi === s.fdi);
    return !t || !t.absent;
  });
  const total = present.length || 1;
  const fdisWithPockets5 = new Set(present.filter((s) => s.pdMm >= 5).map((s) => s.fdi));
  return {
    bopPct: Math.round((present.filter((s) => s.bop).length / total) * 1000) / 10,
    plaquePct: Math.round((present.filter((s) => s.plaque).length / total) * 1000) / 10,
    sites1to3: present.filter((s) => s.pdMm >= 1 && s.pdMm <= 3).length,
    sites4to5: present.filter((s) => s.pdMm >= 4 && s.pdMm <= 5).length,
    sites6plus: present.filter((s) => s.pdMm >= 6).length,
    teethWithPockets5plus: fdisWithPockets5.size,
  };
}

function parsePdRec(raw) {
  const norm = raw.trim().replace(/\s+/g, '').replace(/[/,]/g, '-');
  const m = /^(-?\d{1,2})?-?(-?\d{1,2})?$/.exec(norm);
  if (!m) return { pdMm: null, recMm: null };
  const pd = m[1] ? parseInt(m[1], 10) : null;
  const rec = m[2] ? parseInt(m[2], 10) : null;
  return {
    pdMm: pd !== null && pd >= 0 && pd <= 15 ? pd : null,
    recMm: rec !== null && rec >= -5 && rec <= 15 ? rec : null,
  };
}

function nextSite(fdi, position) {
  const sIdx = POS_ALL.indexOf(position);
  if (sIdx < POS_ALL.length - 1) return { fdi, position: POS_ALL[sIdx + 1] };
  const fIdx = FDI_ALL.indexOf(fdi);
  if (fIdx === -1 || fIdx === FDI_ALL.length - 1) return null;
  return { fdi: FDI_ALL[fIdx + 1], position: POS_ALL[0] };
}

// ─────────────────────────────────────────────────────────────────
// SiteCell — captura inline (núcleo)
// ─────────────────────────────────────────────────────────────────
function SiteCell({ site, focused, onFocus, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const tone =
    site?.pdMm === undefined ? 'unset'
    : site.pdMm <= 3 ? 'green'
    : site.pdMm <= 5 ? 'yellow'
    : 'red';

  const toneClass = {
    unset:  'bg-zinc-900/80 text-zinc-600',
    green:  'bg-emerald-900/60 text-emerald-100',
    yellow: 'bg-amber-900/60 text-amber-100',
    red:    'bg-red-900/70 text-red-100',
  }[tone];

  const startEdit = () => {
    onFocus?.();
    setEditing(true);
    setDraft(`${site?.pdMm ?? ''}${site?.recMm ? '-' + site.recMm : ''}`);
  };

  const commit = () => {
    const { pdMm, recMm } = parsePdRec(draft);
    if (pdMm !== null) onChange?.({ pdMm, recMm: recMm ?? site?.recMm ?? 0 });
    setEditing(false);
  };

  return (
    <button
      onClick={startEdit}
      className={`relative h-7 w-[14px] border-r border-b border-zinc-950 text-[10px] leading-none ${toneClass} ${focused ? 'ring-2 ring-blue-400 ring-inset z-10' : ''} hover:brightness-125 focus-visible:outline-none transition-all`}
      title={`Diente ${site?.fdi} ${site?.position}: PD ${site?.pdMm ?? '-'} REC ${site?.recMm ?? '-'}${site?.bop ? ' · BoP+' : ''}${site?.plaque ? ' · Placa' : ''}${site?.suppuration ? ' · Sup' : ''}`}
    >
      {!editing && (
        <div className="flex h-full flex-col items-center justify-center font-mono">
          <span className="font-semibold">{site?.pdMm ?? '·'}</span>
          {site?.recMm !== undefined && site.recMm !== 0 && (
            <span className="text-[7px] opacity-70">
              {site.recMm > 0 ? `↓${site.recMm}` : `↑${Math.abs(site.recMm)}`}
            </span>
          )}
        </div>
      )}
      {editing && (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="absolute inset-0 w-full bg-zinc-950 text-center font-mono text-[10px] text-zinc-100 outline-none"
          placeholder="PD-REC"
        />
      )}
      <div className="pointer-events-none absolute right-[1px] top-[1px] flex flex-col gap-px">
        {site?.bop && <span className="h-1 w-1 rounded-full bg-red-400" />}
        {site?.plaque && <span className="h-1 w-1 rounded-full bg-sky-400" />}
        {site?.suppuration && <span className="h-1 w-1 rounded-full bg-orange-400" />}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// ToothCenter — silueta SVG por categoría
// ─────────────────────────────────────────────────────────────────
function ToothCenter({ fdi, arcade, tooth, sites, onClick }) {
  const cat = toothCategory(fdi);
  const maxRec = Math.max(...sites.map((s) => s.recMm || 0), 0);
  const fill = '#52525B';

  const path = useMemo(() => {
    if (cat === 'molar') {
      return arcade === 'upper'
        ? 'M 4 2 Q 4 0 6 0 L 22 0 Q 24 0 24 2 L 26 16 Q 26 18 24 18 L 4 18 Q 2 18 2 16 Z M 6 18 L 4 38 Q 4 40 6 40 L 22 40 Q 24 40 24 38 L 22 18 Z'
        : 'M 6 2 Q 4 0 4 2 L 2 24 Q 2 26 4 26 L 24 26 Q 26 26 26 24 L 24 2 Q 24 0 22 2 Z M 4 26 L 6 38 Q 6 40 8 40 L 20 40 Q 22 40 22 38 L 24 26 Z';
    }
    if (cat === 'premolar') return 'M 7 2 Q 7 0 9 0 L 19 0 Q 21 0 21 2 L 22 14 Q 22 16 20 16 L 8 16 Q 6 16 6 14 Z M 8 16 L 6 38 Q 6 40 8 40 L 20 40 Q 22 40 22 38 L 20 16 Z';
    if (cat === 'canine') return 'M 10 2 Q 10 0 12 0 L 16 0 Q 18 0 18 2 L 20 14 Q 20 16 18 16 L 10 16 Q 8 16 8 14 Z M 10 16 Q 8 28 10 38 Q 12 40 14 40 Q 16 40 18 38 Q 20 28 18 16 Z';
    return 'M 9 2 Q 9 0 11 0 L 17 0 Q 19 0 19 2 L 20 14 Q 20 16 18 16 L 10 16 Q 8 16 8 14 Z M 10 16 L 9 38 Q 9 40 11 40 L 17 40 Q 19 40 19 38 L 18 16 Z';
  }, [cat, arcade]);

  return (
    <button
      onClick={onClick}
      className="group relative flex h-10 w-[42px] items-center justify-center hover:bg-zinc-800/40 transition-colors"
      title={`Diente ${fdi} — clic para editar movilidad/furca`}
    >
      <svg width="28" height="40" viewBox="0 0 28 40">
        <path d={path} fill={fill} stroke="#71717A" strokeWidth="0.5" />
      </svg>
      {maxRec > 0 && (
        <div
          className="absolute left-2 right-2 h-px bg-orange-400/70"
          style={{ top: arcade === 'upper' ? `${5 + Math.min(maxRec * 1.2, 8)}px` : `${35 - Math.min(maxRec * 1.2, 8)}px` }}
        />
      )}
      <span className="absolute -bottom-0.5 text-[8px] font-medium text-zinc-500">{fdi}</span>
      {tooth && tooth.mobility >= 1 && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] text-amber-400 font-semibold">
          {'★'.repeat(tooth.mobility)}
        </span>
      )}
      {tooth && tooth.furcation >= 1 && (
        <span
          className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] leading-none font-bold"
          style={{ color: tooth.furcation === 1 ? '#84CC16' : tooth.furcation === 2 ? '#EAB308' : '#EF4444' }}
        >▲</span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// ToothColumn
// ─────────────────────────────────────────────────────────────────
function ToothColumn({ fdi, arcade, sites, tooth, focused, onCellFocus, onCellChange, onToothClick }) {
  const findSite = (p) => sites.find((s) => s.position === p);
  const isFocused = (p) => focused?.fdi === fdi && focused?.position === p;

  return (
    <div className="flex flex-col items-center">
      <div className="flex">
        {POS_FACIAL.map((p) => (
          <SiteCell
            key={p}
            site={findSite(p)}
            focused={isFocused(p)}
            onFocus={() => onCellFocus(p)}
            onChange={(patch) => onCellChange(p, patch)}
          />
        ))}
      </div>
      <ToothCenter fdi={fdi} arcade={arcade} tooth={tooth} sites={sites} onClick={onToothClick} />
      <div className="flex">
        {POS_LINGUAL.map((p) => (
          <SiteCell
            key={p}
            site={findSite(p)}
            focused={isFocused(p)}
            onFocus={() => onCellFocus(p)}
            onChange={(patch) => onCellChange(p, patch)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LiveIndicators
// ─────────────────────────────────────────────────────────────────
function Indicator({ label, value, tone, hint }) {
  const cls = {
    success: 'border-emerald-700/50 bg-emerald-900/20 text-emerald-200',
    warning: 'border-amber-700/50 bg-amber-900/20 text-amber-200',
    danger:  'border-red-700/50 bg-red-900/20 text-red-200',
    muted:   'border-zinc-700 bg-zinc-900/50 text-zinc-300',
  }[tone];
  return (
    <div className={`rounded-md border ${cls} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[9px] opacity-60">{hint}</div>}
    </div>
  );
}

function LiveIndicators({ metrics }) {
  const bopTone = metrics.bopPct < 10 ? 'success' : metrics.bopPct < 25 ? 'warning' : 'danger';
  const plaqueTone = metrics.plaquePct < 20 ? 'success' : metrics.plaquePct < 40 ? 'warning' : 'danger';
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
      <Indicator label="BoP %" value={`${metrics.bopPct}%`} tone={bopTone} hint="Meta: <10%" />
      <Indicator label="Placa O'Leary" value={`${metrics.plaquePct}%`} tone={plaqueTone} hint="Meta: <20%" />
      <Indicator label="Sitios 1-3mm" value={metrics.sites1to3} tone="muted" />
      <Indicator label="Sitios 4-5mm" value={metrics.sites4to5} tone="warning" />
      <Indicator label="Sitios ≥6mm" value={metrics.sites6plus} tone="danger" />
      <Indicator label="Dientes ≥5mm" value={metrics.teethWithPockets5plus} tone="danger" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ClassificationFooter
// ─────────────────────────────────────────────────────────────────
function ClassificationFooter() {
  const [showInputs, setShowInputs] = useState(false);

  const Inp = ({ label, value, reason }) => (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-zinc-200">{value}</div>
      {reason && <div className="mt-1 text-[9px] text-emerald-400">{reason}</div>}
    </div>
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-[10px] uppercase tracking-wider text-zinc-500">Clasificación 2017 AAP/EFP</h3>
          <span className="rounded-md bg-red-500/15 px-2.5 py-1 text-sm font-semibold text-red-200 ring-1 ring-red-500/30">
            Estadio III · Grado C · Generalizada
          </span>
          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            Calculado automáticamente
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowInputs(!showInputs)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {showInputs ? 'Ocultar cálculo' : 'Ver cómo se calculó'}
          </button>
          <button className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-blue-300 hover:bg-zinc-800">
            Sobrescribir
          </button>
        </div>
      </div>

      {showInputs && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3 md:grid-cols-4">
          <Inp label="Max CAL interproximal" value="8 mm" reason="≥5mm → Stage III" />
          <Inp label="Pérdida ósea radiográfica" value="45%" />
          <Inp label="Max PD" value="7 mm" />
          <Inp label="Dientes perdidos (perio)" value="0" />
          <Inp label="Factores de complejidad" value="movilidad ≥2 (31, 41), furca II (16), PD ≥6mm" />
          <Inp label="Ratio BL / edad" value="1.18" reason=">1.0 → Grado C" />
          <Inp label="Modificador tabaco" value="12 cig/día" reason="≥10 sube grado" />
          <Inp label="Dientes afectados" value="87%" reason="≥30% → Generalizada" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sidebar — timeline + leyenda
// ─────────────────────────────────────────────────────────────────
function Sidebar() {
  const records = [
    { id: 'r1', date: '15 oct 2024', label: 'Sondaje inicial', type: 'INICIAL', bop: 68, plaque: 81, sites6: 35, selected: true },
    { id: 'r2', date: 'Programado · 22 oct', label: 'Post-Fase 2', type: 'POST_FASE_2', bop: '—', plaque: '—', sites6: '—', selected: false, future: true },
  ];

  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Periodontogramas</h3>
        <button className="rounded border border-blue-700/50 bg-blue-900/30 px-2 py-1 text-[10px] text-blue-300 hover:bg-blue-900/50">
          + Nuevo
        </button>
      </div>

      <div className="space-y-2">
        {records.map((r) => (
          <button
            key={r.id}
            className={`w-full rounded-lg border p-3 text-left transition-all ${
              r.selected ? 'border-blue-700 bg-blue-900/20'
              : r.future ? 'border-zinc-800 bg-zinc-900/40 opacity-60'
              : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200">{r.label}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">{r.type}</span>
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">{r.date}</div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
              <div className={`rounded px-1.5 py-1 ${r.future ? 'bg-zinc-900 text-zinc-600' : 'bg-red-950/30 text-red-300'}`}>BoP {r.bop}{r.future ? '' : '%'}</div>
              <div className={`rounded px-1.5 py-1 ${r.future ? 'bg-zinc-900 text-zinc-600' : 'bg-amber-950/30 text-amber-300'}`}>Pl {r.plaque}{r.future ? '' : '%'}</div>
              <div className={`rounded px-1.5 py-1 ${r.future ? 'bg-zinc-900 text-zinc-600' : 'bg-red-950/30 text-red-300'}`}>≥6: {r.sites6}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Riesgo periodontal</span>
            <AlertTriangle size={12} className="text-red-400" />
          </div>
          <div className="mt-1 text-base font-semibold text-red-400">ALTO</div>
          <div className="text-[10px] text-zinc-500">Berna: tabaco ≥10 + BoP &gt;25%</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Recall sugerido</span>
            <Calendar size={12} className="text-zinc-400" />
          </div>
          <div className="mt-1 text-base font-semibold text-zinc-200">Cada 3 meses</div>
          <div className="text-[10px] text-zinc-500">Próximo: ene 2025</div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Leyenda</div>
        <div className="space-y-1.5 text-[10px] text-zinc-400">
          <Lg color="#22C55E" label="PD 1-3mm (sano)" />
          <Lg color="#EAB308" label="PD 4-5mm (moderado)" />
          <Lg color="#EF4444" label="PD ≥6mm (profundo)" />
          <div className="my-1.5 border-t border-zinc-800" />
          <Dot color="#F87171" label="BoP+ (sangrado)" />
          <Dot color="#38BDF8" label="Placa" />
          <Dot color="#FB923C" label="Supuración" />
          <div className="my-1.5 border-t border-zinc-800" />
          <div className="flex items-center gap-2"><span className="text-amber-400">★</span><span>Movilidad (1-3)</span></div>
          <div className="flex items-center gap-2"><span className="text-amber-400">▲</span><span>Furca (I-III)</span></div>
        </div>
      </div>
    </aside>
  );
}

const Lg = ({ color, label }) => (
  <div className="flex items-center gap-2">
    <span className="h-2.5 w-3 rounded-sm" style={{ backgroundColor: color, opacity: 0.6 }} />
    <span>{label}</span>
  </div>
);
const Dot = ({ color, label }) => (
  <div className="flex items-center gap-2">
    <span className="ml-0.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
    <span>{label}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// Periodontogram Tab
// ─────────────────────────────────────────────────────────────────
function ModeBtn({ icon: Icon, active, onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-all ${
        active ? 'bg-blue-500/15 text-blue-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <Icon size={12} />{children}
    </button>
  );
}

function SaveStatus({ status }) {
  const map = {
    saving: { text: 'Guardando…', color: 'text-amber-300', dot: 'bg-amber-400 animate-pulse' },
    saved:  { text: 'Guardado',   color: 'text-emerald-300', dot: 'bg-emerald-400' },
  }[status];
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      <span className={map.color}>{map.text}</span>
    </div>
  );
}

function PeriodontogramTab() {
  const [sites, setSites] = useState(generateInitialSites);
  const [tooth] = useState(generateInitialTooth);
  const [focused, setFocused] = useState({ fdi: 16, position: 'MV' });
  const [captureMode, setCaptureMode] = useState('keyboard');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [drawerFdi, setDrawerFdi] = useState(null);

  const metrics = useMemo(() => computeMetrics(sites, tooth), [sites, tooth]);

  const handleCellChange = (fdi, position, patch) => {
    setSaveStatus('saving');
    setSites((prev) => {
      const idx = prev.findIndex((s) => s.fdi === fdi && s.position === position);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setTimeout(() => setSaveStatus('saved'), 400);
    const n = nextSite(fdi, position);
    if (n) setFocused(n);
  };

  // Atajos: Espacio/P/S sobre celda enfocada
  useEffect(() => {
    const handler = (e) => {
      if (!focused) return;
      if (e.target?.tagName === 'INPUT') return;
      if (![' ', 'p', 'P', 's', 'S'].includes(e.key)) return;
      e.preventDefault();
      const field = e.key === ' ' ? 'bop' : (e.key === 'p' || e.key === 'P') ? 'plaque' : 'suppuration';
      setSites((prev) => {
        const idx = prev.findIndex((x) => x.fdi === focused.fdi && x.position === focused.position);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: !next[idx][field] };
        return next;
      });
      setSaveStatus('saving');
      setTimeout(() => setSaveStatus('saved'), 400);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focused]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <ModeBtn icon={Keyboard} active={captureMode === 'keyboard'} onClick={() => setCaptureMode('keyboard')}>Teclado</ModeBtn>
          <ModeBtn icon={Mic} disabled>Voz <span className="rounded bg-zinc-800 px-1 text-[8px]">v1.1</span></ModeBtn>
          <ModeBtn icon={Tablet} disabled>Tablet <span className="rounded bg-zinc-800 px-1 text-[8px]">v1.1</span></ModeBtn>
        </div>
        <SaveStatus status={saveStatus} />
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-900/40 bg-blue-950/30 px-3 py-2 text-[11px] text-blue-200">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Teclea <kbd className="rounded bg-zinc-800 px-1 font-mono text-[10px]">5-2</kbd> en cualquier celda para PD 5mm REC 2mm.
          <kbd className="ml-2 rounded bg-zinc-800 px-1 font-mono text-[10px]">Tab</kbd> avanza al siguiente sitio.
          <kbd className="ml-2 rounded bg-zinc-800 px-1 font-mono text-[10px]">Espacio</kbd> sangrado,
          <kbd className="ml-1 rounded bg-zinc-800 px-1 font-mono text-[10px]">P</kbd> placa,
          <kbd className="ml-1 rounded bg-zinc-800 px-1 font-mono text-[10px]">S</kbd> supuración.
        </span>
      </div>

      <LiveIndicators metrics={metrics} />

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
        <div className="min-w-max space-y-3">
          <div className="flex items-center gap-3 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Arcada superior</span>
            <span className="text-[10px] text-zinc-600">vestibular ↑ · palatina ↓</span>
          </div>
          <div className="flex justify-center gap-px">
            {FDI_UPPER.map((fdi, i) => (
              <React.Fragment key={fdi}>
                {i === 8 && <div className="w-2 border-l border-dashed border-zinc-700" />}
                <ToothColumn
                  fdi={fdi}
                  arcade="upper"
                  sites={sites.filter((s) => s.fdi === fdi)}
                  tooth={tooth.find((t) => t.fdi === fdi)}
                  focused={focused}
                  onCellFocus={(p) => setFocused({ fdi, position: p })}
                  onCellChange={(p, patch) => handleCellChange(fdi, p, patch)}
                  onToothClick={() => setDrawerFdi(fdi)}
                />
              </React.Fragment>
            ))}
          </div>
          <div className="border-t border-dashed border-zinc-700" />
          <div className="flex justify-center gap-px">
            {FDI_LOWER.map((fdi, i) => (
              <React.Fragment key={fdi}>
                {i === 8 && <div className="w-2 border-l border-dashed border-zinc-700" />}
                <ToothColumn
                  fdi={fdi}
                  arcade="lower"
                  sites={sites.filter((s) => s.fdi === fdi)}
                  tooth={tooth.find((t) => t.fdi === fdi)}
                  focused={focused}
                  onCellFocus={(p) => setFocused({ fdi, position: p })}
                  onCellChange={(p, patch) => handleCellChange(fdi, p, patch)}
                  onToothClick={() => setDrawerFdi(fdi)}
                />
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-3 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Arcada inferior</span>
            <span className="text-[10px] text-zinc-600">vestibular ↑ · lingual ↓</span>
          </div>
        </div>
      </div>

      <ClassificationFooter />

      {/* Drawer stub */}
      {drawerFdi && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40" onClick={() => setDrawerFdi(null)}>
          <div
            className="h-full w-96 border-l border-zinc-800 bg-zinc-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-100">Detalle del diente {drawerFdi}</h3>
              <button onClick={() => setDrawerFdi(null)} className="text-zinc-400 hover:text-zinc-200">×</button>
            </div>
            <p className="text-sm text-zinc-500">
              Drawer detalle del diente {drawerFdi} — campos completos en componente real:
              movilidad (Miller 0-3), furca (Hamp 0-3), recesión (Cairo RT1/RT2/RT3),
              fenotipo gingival, ausente/implante.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-tabs placeholders
// ─────────────────────────────────────────────────────────────────
function PlaceholderTab({ name, description }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
        <FileText size={18} className="text-zinc-500" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-300">Vista de {name}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">{description}</p>
      <p className="mt-3 text-[10px] text-zinc-600">Implementación en componente real (ver SPEC §6).</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Header del paciente + sub-tabs nav
// ─────────────────────────────────────────────────────────────────
function PatientHeader() {
  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500/15">
            <User size={18} className="text-blue-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{patient.name}</h2>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{patient.fileNumber}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
              <span>{patient.age} años</span><span>·</span><span>{patient.phone}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-red-800/40 bg-red-900/30 px-2 py-1 text-[11px] text-red-200">
            <Cigarette size={10} />12 cig/día
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-800/40 bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
            Bruxismo
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-200 ring-1 ring-red-500/30">
            <AlertTriangle size={12} />
            Estadio III · Grado C · Generalizada
          </span>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            <FileText size={12} />Informe PDF
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
        <span>Pacientes</span><ChevronRight size={11} />
        <span>{patient.name}</span><ChevronRight size={11} />
        <span className="text-blue-300">Periodoncia</span>
      </div>
    </div>
  );
}

function SubTabsNav({ active, onChange }) {
  const tabs = [
    { id: 'resumen',         label: 'Resumen' },
    { id: 'periodontograma', label: 'Periodontograma' },
    { id: 'plan',            label: 'Plan' },
    { id: 'cirugias',        label: 'Cirugías' },
    { id: 'mantenimientos',  label: 'Mantenimientos' },
  ];
  return (
    <div className="flex border-b border-zinc-800 bg-zinc-950 px-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-xs font-medium transition-colors ${
            active === t.id ? 'text-blue-300' : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {t.label}
          {active === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────
export default function PeriodonticsModule() {
  const [activeTab, setActiveTab] = useState('periodontograma');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: 'ui-sans-serif, system-ui' }}>
      <PatientHeader />
      <SubTabsNav active={activeTab} onChange={setActiveTab} />

      <div className="flex">
        {activeTab === 'periodontograma' && <Sidebar />}

        <main className="flex-1 p-6">
          {activeTab === 'periodontograma' && <PeriodontogramTab />}
          {activeTab === 'resumen' && (
            <PlaceholderTab
              name="Resumen"
              description="Cards: clasificación 2017 actual, evolución BoP%, próximo mantenimiento, alertas clínicas, factores sistémicos."
            />
          )}
          {activeTab === 'plan' && (
            <PlaceholderTab
              name="Plan"
              description="Las 4 fases del tratamiento periodontal (Causal · SRP · Quirúrgica · Mantenimiento) con tracking de progreso y mapa de cuadrantes Q1-Q4."
            />
          )}
          {activeTab === 'cirugias' && (
            <PlaceholderTab
              name="Cirugías"
              description="Lista de cirugías periodontales con tipo, sitios intervenidos, biomateriales, fecha de retiro de suturas y comparativo antes/después."
            />
          )}
          {activeTab === 'mantenimientos' && (
            <PlaceholderTab
              name="Mantenimientos"
              description="Tabla cronológica de visitas con BoP%, Plaque Index, sitios residuales y badge de riesgo Berna."
            />
          )}
        </main>
      </div>
    </div>
  );
}
