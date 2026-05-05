import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Pill,
  Stethoscope,
  Syringe,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// Design tokens (consistentes con módulo Pediatría)
// ─────────────────────────────────────────────────────────────────
const tokens = {
  bgBase: '#09090B',      // zinc-950
  bgElev: '#18181B',      // zinc-900
  bgElev2: '#27272A',     // zinc-800
  borderSoft: '#3F3F46',  // zinc-700
  text1: '#FAFAFA',       // zinc-50
  text2: '#A1A1AA',       // zinc-400
  text3: '#71717A',       // zinc-500
  brand: '#3B82F6',       // blue-500
  brandSoft: 'rgba(59, 130, 246, 0.15)',
  success: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  info: '#06B6D4',
};

// Quality colors según SPEC sección 7.6
const QUALITY_COLORS = {
  HOMOGENEA: '#22C55E',     // verde
  ADECUADA: '#84CC16',      // lime
  CON_HUECOS: '#EAB308',    // amarillo
  SOBREOBTURADA: '#EF4444', // rojo
  SUBOBTURADA: '#F97316',   // naranja
  none: '#3F3F46',          // gris
};

// Estados endodónticos por diente (color del odontograma miniatura)
const TOOTH_STATE_COLORS = {
  HEALTHY: '#3F3F46',
  TC_COMPLETO: '#22C55E',
  TC_EN_PROGRESO: '#3B82F6',
  RETRATAMIENTO: '#EAB308',
  LESION_PERIAPICAL: '#EF4444',
  CONTROL_PROGRAMADO: '#A855F7',
};

// ─────────────────────────────────────────────────────────────────
// Mock data: Roberto Salinas, 42 años — TC primario diente 36
// ─────────────────────────────────────────────────────────────────
const patient = {
  name: 'Roberto Salinas Méndez',
  age: 42,
  fileNumber: 'EXP-2024-0847',
  phone: '+52 999 123 4567',
};

const treatment = {
  toothFdi: 36,
  toothName: 'Primer molar inferior izquierdo',
  status: 'COMPLETED',
  type: 'PRIMARY',
  startDate: '2024-09-12',
  completionDate: '2024-09-26',
  rotarySystem: 'ProTaper Gold',
  sealer: 'BioCeramic',
  obturationTechnique: 'Cono único',
};

const diagnosis = {
  pulpal: 'Pulpitis irreversible sintomática',
  periapical: 'Periodontitis apical sintomática',
  vitalityCold: 'POSITIVA_PROLONGADA',
  vitalityPercussion: 'POSITIVA',
  vitalityPalpation: 'NEGATIVA',
  pai: 3,
  date: '2024-09-12',
};

const canals = [
  { name: 'MV',  fdiId: 'canal-mv',  length: 21.0, apicalSize: 35, taper: 0.04, quality: 'HOMOGENEA' },
  { name: 'ML',  fdiId: 'canal-ml',  length: 21.5, apicalSize: 35, taper: 0.04, quality: 'HOMOGENEA' },
  { name: 'MB2', fdiId: 'canal-mb2', length: 20.5, apicalSize: 25, taper: 0.04, quality: 'ADECUADA' },
  { name: 'D',   fdiId: 'canal-d',   length: 20.0, apicalSize: 40, taper: 0.06, quality: 'HOMOGENEA' },
];

const timelineEvents = [
  { date: '2024-09-12', label: 'Diagnóstico',        icon: Stethoscope,   tone: 'info'    },
  { date: '2024-09-12', label: 'Sesión 1 — Acceso',   icon: Activity,      tone: 'brand'   },
  { date: '2024-09-12', label: 'Medicación Ca(OH)₂',  icon: Pill,          tone: 'warning' },
  { date: '2024-09-19', label: 'Sesión 2 — Obturación', icon: Syringe,    tone: 'brand'   },
  { date: '2024-09-26', label: 'Restauración (corona)', icon: CheckCircle2, tone: 'success' },
  { date: '2025-03-26', label: 'Control 6 meses',     icon: Calendar,       tone: 'pending' },
  { date: '2025-09-26', label: 'Control 12 meses',    icon: Calendar,       tone: 'pending' },
  { date: '2026-09-26', label: 'Control 24 meses',    icon: Calendar,       tone: 'pending' },
];

// Estado endodóntico por diente para el odontograma miniatura
const toothStates = {
  16: 'TC_COMPLETO',
  21: 'CONTROL_PROGRAMADO',
  26: 'LESION_PERIAPICAL',
  36: 'TC_COMPLETO',
  46: 'RETRATAMIENTO',
};

// ─────────────────────────────────────────────────────────────────
// Layout FDI: dos arcadas
// ─────────────────────────────────────────────────────────────────
const FDI_LAYOUT = {
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft:  [21, 22, 23, 24, 25, 26, 27, 28],
  lowerRight: [48, 47, 46, 45, 44, 43, 42, 41],
  lowerLeft:  [31, 32, 33, 34, 35, 36, 37, 38],
};

// ═════════════════════════════════════════════════════════════════
// Componente: ToothMiniOdontogram (panel izq, 280px)
// ═════════════════════════════════════════════════════════════════
function ToothMiniOdontogram({ selectedFdi, onSelect }) {
  const renderTooth = (fdi) => {
    const state = toothStates[fdi] || 'HEALTHY';
    const color = TOOTH_STATE_COLORS[state];
    const isSelected = fdi === selectedFdi;
    return (
      <button
        key={fdi}
        onClick={() => onSelect(fdi)}
        className={`relative flex h-7 w-7 items-center justify-center rounded text-[10px] font-medium transition-all ${
          isSelected ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-900' : ''
        }`}
        style={{
          backgroundColor: state === 'HEALTHY' ? tokens.bgElev2 : color,
          color: state === 'HEALTHY' ? tokens.text2 : '#000',
        }}
        title={`Diente ${fdi} — ${state.replace(/_/g, ' ').toLowerCase()}`}
      >
        {fdi}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-1">
        {FDI_LAYOUT.upperRight.map(renderTooth)}
        <div className="w-px bg-zinc-700 mx-1" />
        {FDI_LAYOUT.upperLeft.map(renderTooth)}
      </div>
      <div className="border-t border-dashed border-zinc-700" />
      <div className="flex justify-center gap-1">
        {FDI_LAYOUT.lowerRight.map(renderTooth)}
        <div className="w-px bg-zinc-700 mx-1" />
        {FDI_LAYOUT.lowerLeft.map(renderTooth)}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componente: Leyenda de estados endodónticos
// ═════════════════════════════════════════════════════════════════
function StateLegend() {
  const items = [
    { color: TOOTH_STATE_COLORS.TC_COMPLETO,        label: 'TC completo' },
    { color: TOOTH_STATE_COLORS.TC_EN_PROGRESO,     label: 'En proceso' },
    { color: TOOTH_STATE_COLORS.RETRATAMIENTO,      label: 'Retratamiento' },
    { color: TOOTH_STATE_COLORS.LESION_PERIAPICAL,  label: 'Lesión periapical' },
    { color: TOOTH_STATE_COLORS.CONTROL_PROGRAMADO, label: 'Control programado' },
    { color: TOOTH_STATE_COLORS.HEALTHY,            label: 'Sano' },
  ];
  return (
    <div className="space-y-1.5 text-xs">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-zinc-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componente: DiagnosisCard
// ═════════════════════════════════════════════════════════════════
function DiagnosisCard() {
  const vitalityRows = [
    { label: 'Frío',     value: 'Positiva prolongada', tone: 'danger' },
    { label: 'Calor',    value: 'No realizada',         tone: 'muted'  },
    { label: 'Eléctrica',value: 'No realizada',         tone: 'muted'  },
    { label: 'Percusión',value: 'Positiva',             tone: 'danger' },
    { label: 'Palpación',value: 'Negativa',             tone: 'success'},
    { label: 'Movilidad',value: 'Grado 0',              tone: 'success'},
  ];
  const toneClass = {
    danger:  'text-red-400',
    success: 'text-emerald-400',
    muted:   'text-zinc-500',
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Diagnóstico endodóntico</h3>
        </div>
        <span className="text-xs text-zinc-500">{diagnosis.date}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Diagnóstico pulpar</div>
          <div className="rounded-md border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-200">
            {diagnosis.pulpal}
          </div>
          <div className="mt-3 mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Diagnóstico periapical</div>
          <div className="rounded-md border border-orange-900/40 bg-orange-950/20 px-3 py-2 text-sm text-orange-200">
            {diagnosis.periapical}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">PAI score</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
              {diagnosis.pai} / 5
            </span>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Pruebas de vitalidad</div>
          <div className="space-y-1.5">
            {vitalityRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">{r.label}</span>
                <span className={toneClass[r.tone]}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componente: CanalMap — SVG molar inferior con 4 conductos coloreados
// ═════════════════════════════════════════════════════════════════
function CanalMap() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Mapa canalicular — Diente 36</h3>
        </div>
        <span className="text-xs text-zinc-500">Vertucci 1984 · 4 conductos</span>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px,1fr]">
        {/* SVG esquemática del molar inferior con 4 conductos */}
        <div className="flex justify-center">
          <svg viewBox="0 0 200 280" className="h-64 w-full max-w-[220px]">
            {/* Corona */}
            <path
              d="M 30 30 Q 30 10 50 10 L 150 10 Q 170 10 170 30 L 175 90 Q 175 100 165 100 L 35 100 Q 25 100 25 90 Z"
              fill={tokens.bgElev2}
              stroke={tokens.borderSoft}
              strokeWidth="1.5"
            />
            {/* Línea cemento-esmalte */}
            <line x1="25" y1="100" x2="175" y2="100" stroke={tokens.borderSoft} strokeWidth="1" strokeDasharray="3,2" />

            {/* Raíz mesial (izquierda, 3 conductos) */}
            <path
              d="M 35 100 L 30 250 Q 35 265 50 265 L 90 265 Q 95 250 90 100 Z"
              fill={tokens.bgElev2}
              stroke={tokens.borderSoft}
              strokeWidth="1.5"
            />
            {/* Raíz distal (derecha, 1 conducto) */}
            <path
              d="M 110 100 Q 105 250 115 265 L 155 265 Q 170 265 170 250 L 165 100 Z"
              fill={tokens.bgElev2}
              stroke={tokens.borderSoft}
              strokeWidth="1.5"
            />

            {/* Conducto MV (mesiovestibular) */}
            <g id="canal-mv">
              <path
                d="M 50 105 Q 48 180 42 250"
                stroke={QUALITY_COLORS[canals[0].quality]}
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
              />
              <text x="40" y="280" fontSize="9" fill={tokens.text2} textAnchor="middle">MV</text>
            </g>
            {/* Conducto MB2 */}
            <g id="canal-mb2">
              <path
                d="M 62 105 Q 60 175 58 240"
                stroke={QUALITY_COLORS[canals[2].quality]}
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeDasharray="2,2"
              />
              <text x="60" y="258" fontSize="8" fill={tokens.text3} textAnchor="middle">MB2</text>
            </g>
            {/* Conducto ML (mesiolingual) */}
            <g id="canal-ml">
              <path
                d="M 78 105 Q 80 180 82 250"
                stroke={QUALITY_COLORS[canals[1].quality]}
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
              />
              <text x="82" y="280" fontSize="9" fill={tokens.text2} textAnchor="middle">ML</text>
            </g>
            {/* Conducto D (distal) */}
            <g id="canal-d">
              <path
                d="M 140 105 Q 140 180 140 250"
                stroke={QUALITY_COLORS[canals[3].quality]}
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
              />
              <text x="140" y="280" fontSize="9" fill={tokens.text2} textAnchor="middle">D</text>
            </g>

            {/* Etiqueta diente */}
            <text x="100" y="55" fontSize="11" fill={tokens.text2} textAnchor="middle" fontWeight="600">36</text>
          </svg>
        </div>

        {/* Tabla de conductos */}
        <div>
          <div className="overflow-hidden rounded-md border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950/50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Conducto</th>
                  <th className="px-3 py-2 text-left font-medium">Long.</th>
                  <th className="px-3 py-2 text-left font-medium">Lima</th>
                  <th className="px-3 py-2 text-left font-medium">Cono.</th>
                  <th className="px-3 py-2 text-left font-medium">Calidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {canals.map((c) => (
                  <tr key={c.name} className="text-zinc-300">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">{c.length} mm</td>
                    <td className="px-3 py-2">#{c.apicalSize}</td>
                    <td className="px-3 py-2">.{(c.taper * 100).toString().padStart(2, '0')}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: `${QUALITY_COLORS[c.quality]}25`,
                          color: QUALITY_COLORS[c.quality],
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: QUALITY_COLORS[c.quality] }} />
                        {c.quality.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Sistema rotatorio</div>
              <div className="text-zinc-200">{treatment.rotarySystem}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Sellador</div>
              <div className="text-zinc-200">{treatment.sealer}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componente: ToothTimeline horizontal
// ═════════════════════════════════════════════════════════════════
function ToothTimeline() {
  const toneStyle = {
    info:    { ring: 'ring-cyan-500/40',    bg: 'bg-cyan-500/15',    text: 'text-cyan-300',    icon: 'text-cyan-400'    },
    brand:   { ring: 'ring-blue-500/40',    bg: 'bg-blue-500/15',    text: 'text-blue-300',    icon: 'text-blue-400'    },
    warning: { ring: 'ring-amber-500/40',   bg: 'bg-amber-500/15',   text: 'text-amber-300',   icon: 'text-amber-400'   },
    success: { ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/15', text: 'text-emerald-300', icon: 'text-emerald-400' },
    pending: { ring: 'ring-zinc-700',       bg: 'bg-zinc-800',       text: 'text-zinc-400',    icon: 'text-zinc-500'    },
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Línea de tiempo</h3>
        </div>
        <span className="text-xs text-zinc-500">8 eventos · 5 completos · 3 pendientes</span>
      </div>

      <div className="relative">
        {/* línea horizontal */}
        <div className="absolute left-0 right-0 top-5 h-px bg-zinc-800" />

        <div className="relative grid grid-cols-8 gap-2">
          {timelineEvents.map((ev, idx) => {
            const Icon = ev.icon;
            const s = toneStyle[ev.tone];
            return (
              <div key={idx} className="flex flex-col items-center">
                <div
                  className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ring-2 ${s.ring} ${s.bg}`}
                >
                  <Icon size={16} className={s.icon} />
                </div>
                <div className="mt-2 text-center">
                  <div className={`text-[11px] font-medium ${s.text}`}>{ev.label}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{ev.date}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Header del módulo
// ═════════════════════════════════════════════════════════════════
function ModuleHeader() {
  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15">
            <User size={18} className="text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{patient.name}</h2>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                {patient.fileNumber}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {patient.age} años · {patient.phone}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            <CheckCircle2 size={12} />
            TC completado
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-500/15 px-2.5 py-1 text-xs font-medium text-purple-300">
            <Calendar size={12} />
            En seguimiento
          </span>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            <FileText size={12} />
            Exportar informe
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════════
export default function EndodonticsModule() {
  const [selectedTooth, setSelectedTooth] = useState(36);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: 'ui-sans-serif, system-ui' }}>
      <ModuleHeader />

      {/* Breadcrumb / sub-tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-900 bg-zinc-950 px-6 py-2 text-xs text-zinc-500">
        <span>Pacientes</span>
        <ChevronRight size={12} />
        <span>{patient.name}</span>
        <ChevronRight size={12} />
        <span className="text-blue-400">Endodoncia</span>
      </div>

      <div className="flex">
        {/* Panel izquierdo 280px — odontograma miniatura */}
        <aside className="w-[280px] shrink-0 border-r border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Odontograma
            </h3>
            <span className="text-[10px] text-zinc-600">FDI</span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <ToothMiniOdontogram selectedFdi={selectedTooth} onSelect={setSelectedTooth} />
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Estados endodónticos
            </div>
            <StateLegend />
          </div>

          {/* Stats rápidas */}
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Tasa de éxito</span>
                <TrendingUp size={12} className="text-emerald-400" />
              </div>
              <div className="mt-1 text-lg font-semibold text-emerald-400">94%</div>
              <div className="text-[10px] text-zinc-500">Últimos 12 meses · 47 TC</div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Controles pendientes</span>
                <AlertCircle size={12} className="text-amber-400" />
              </div>
              <div className="mt-1 text-lg font-semibold text-zinc-200">3</div>
              <div className="text-[10px] text-zinc-500">Próximo: 26 mar 2025</div>
            </div>
          </div>
        </aside>

        {/* Contenido principal — 3 secciones verticales */}
        <main className="flex-1 space-y-4 p-6">
          {/* Diente seleccionado info */}
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-xl font-semibold text-zinc-100">
                Diente {treatment.toothFdi}
              </h1>
              <p className="text-sm text-zinc-500">{treatment.toothName}</p>
            </div>
            <div className="text-right text-xs text-zinc-500">
              <div>TC primario · {treatment.startDate}</div>
              <div>Finalizado · {treatment.completionDate}</div>
            </div>
          </div>

          {/* Sección 1: Diagnóstico */}
          <DiagnosisCard />

          {/* Sección 2: Mapa canalicular */}
          <CanalMap />

          {/* Sección 3: Timeline */}
          <ToothTimeline />
        </main>
      </div>
    </div>
  );
}
