import React, { useState, useMemo } from 'react';
import {
  Anchor, AlertTriangle, Calendar, CheckCircle2, ChevronDown, ChevronUp,
  ChevronRight, Clock, Cigarette, Download, Edit3, FileSignature, FileText,
  Image as ImageIcon, Info, Stethoscope, User, Wrench, X,
} from 'lucide-react';

// ═════════════════════════════════════════════════════════════════
// Mock data — Roberto Méndez Aguilar (SPEC §12.1)
// ═════════════════════════════════════════════════════════════════
const patient = {
  name: 'Roberto Méndez Aguilar',
  age: 58,
  birthDate: '1967-03-12',
  fileNumber: 'EXP-2024-1015',
  phone: '+52 999 123 4567',
  asaClassification: 'ASA II',
  medicalConditions: ['Hipertensión controlada con losartán'],
  smokingHistory: { status: 'EX_SMOKER', quitYear: 2019, packYears: 20 },
};

const implant = {
  id: 'imp_roberto_36',
  toothFdi: 36,
  brand: 'STRAUMANN',
  brandLabel: 'Straumann',
  modelName: 'BLX',
  diameterMm: 4.5,
  lengthMm: 10.0,
  connectionType: 'Cono Morse',
  surfaceTreatment: 'SLActive',
  lotNumber: 'A12345678',
  manufactureDate: '2023-03-01',
  expiryDate: '2028-03-01',
  placedAt: '2024-10-15',
  protocol: 'ONE_STAGE',
  protocolLabel: '1 fase',
  currentStatus: 'FUNCTIONAL',
  notes: 'Diente 36 ausente desde hace 8 meses. Volumen óseo D2 suficiente. Margen al conducto dentario inferior 2 mm.',
};

const surgicalRecord = {
  surgeryDate: '2024-10-15',
  doctor: 'Dr. Salazar',
  asa: 'ASA II',
  insertionTorqueNcm: 38,
  isqMesiodistal: 74,
  isqVestibulolingual: 72,
  boneDensity: 'D2',
  ridgeWidthMm: 7.0,
  ridgeHeightMm: 11.0,
  flapType: 'Crestal con liberación distal',
  drillingProtocol: 'Estándar D2',
  healingAbutmentLot: 'HA-22334-R',
  sutureMaterial: 'Monofilamento nylon 4-0',
  durationMinutes: 65,
  preopAntibioticType: 'Amoxicilina 2g VO 1h pre-op',
};

const healingPhase = {
  startedAt: '2024-10-15',
  expectedDurationWeeks: 8,
  isqAt4Weeks: 75,
  isqAt8Weeks: 78,
  isqLatest: 78,
  isqLatestAt: '2024-12-10',
  completedAt: '2024-12-10',
};

const prostheticPhase = {
  abutmentType: 'Pilar Ti prefabricado',
  abutmentLot: 'SP-87654',
  abutmentDiameterMm: 4.5,
  abutmentHeightMm: 4.0,
  abutmentTorqueNcm: 35,
  prosthesisType: 'Corona unitaria atornillada',
  prosthesisMaterial: 'Zirconia monolítica',
  prosthesisLabName: 'Zarate Lab',
  prosthesisLabLot: '8X-2024-0815',
  prosthesisDeliveredAt: '2024-12-24',
  occlusionScheme: 'Función de grupo',
};

const followUps = [
  { milestone: '1 sem',  scheduledAt: '2024-10-22', performedAt: '2024-10-22', clinicalStatusOk: true },
  { milestone: '1 mes',  scheduledAt: '2024-11-15', performedAt: '2024-11-15', clinicalStatusOk: true },
  { milestone: '3 meses',scheduledAt: '2025-01-15', performedAt: '2025-01-15', boneLossMm: 0.4, albrektsson: true },
  { milestone: '6 meses',scheduledAt: '2025-06-15', performedAt: '2025-06-15', boneLossMm: 0.5, albrektsson: true },
  { milestone: '12 meses', scheduledAt: '2025-12-15', performedAt: null },
  { milestone: '24 meses', scheduledAt: '2026-12-15', performedAt: null },
];

const nextFollowUp = followUps.find((f) => !f.performedAt);

// ═════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

const STATUS_BADGES = {
  PLANNED:            { label: 'Planeado',         cls: 'bg-zinc-500/15 text-zinc-200 ring-zinc-500/30' },
  PLACED:             { label: 'Recién colocado',  cls: 'bg-blue-500/15 text-blue-200 ring-blue-500/30' },
  OSSEOINTEGRATING:   { label: 'Cicatrizando',     cls: 'bg-blue-500/15 text-blue-200 ring-blue-500/30' },
  UNCOVERED:          { label: '2ª cirugía hecha', cls: 'bg-blue-500/15 text-blue-200 ring-blue-500/30' },
  LOADED_PROVISIONAL: { label: 'Provisional',      cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/30' },
  LOADED_DEFINITIVE:  { label: 'Carga definitiva', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30' },
  FUNCTIONAL:         { label: 'En función',       cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30' },
  COMPLICATION:       { label: 'Complicación',     cls: 'bg-orange-500/15 text-orange-200 ring-orange-500/40' },
  FAILED:             { label: 'Fracaso',          cls: 'bg-red-500/15 text-red-200 ring-red-500/40' },
  REMOVED:            { label: 'Removido',         cls: 'bg-red-500/15 text-red-300 ring-red-500/40' },
};

const STATUS_BORDERS = {
  PLACED: 'border-blue-700/40', OSSEOINTEGRATING: 'border-blue-700/40', UNCOVERED: 'border-blue-700/40',
  LOADED_DEFINITIVE: 'border-emerald-700/40', FUNCTIONAL: 'border-emerald-700/40',
  LOADED_PROVISIONAL: 'border-amber-700/40',
  COMPLICATION: 'border-orange-700/50',
  FAILED: 'border-red-700/50', REMOVED: 'border-red-700/50',
  PLANNED: 'border-zinc-800',
};

// ═════════════════════════════════════════════════════════════════
// TimelineMilestone — hito clicable con popover
// ═════════════════════════════════════════════════════════════════
function TimelineMilestone({ def, state, detail, onSelect, selected }) {
  const Icon = def.icon;

  const styles = {
    completed: { ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/15', icon: 'text-emerald-300', label: 'text-emerald-200' },
    active:    { ring: 'ring-blue-500/60',    bg: 'bg-blue-500/20',    icon: 'text-blue-200',    label: 'text-blue-100' },
    future:    { ring: 'ring-zinc-700',       bg: 'bg-zinc-800',       icon: 'text-zinc-500',    label: 'text-zinc-400' },
    skipped:   { ring: 'ring-zinc-800',       bg: 'bg-zinc-900',       icon: 'text-zinc-600',    label: 'text-zinc-500' },
    failed:    { ring: 'ring-red-500/50',     bg: 'bg-red-500/15',     icon: 'text-red-200',     label: 'text-red-200' },
  }[state];

  return (
    <div className="relative flex flex-col items-center">
      <button
        onClick={onSelect}
        className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full ring-2 ${styles.ring} ${styles.bg} transition-all hover:scale-110 ${selected ? 'scale-110 ring-4' : ''}`}
        title={def.description}
      >
        {state === 'completed' ? (
          <CheckCircle2 size={18} className={styles.icon} />
        ) : (
          <Icon size={18} className={styles.icon} />
        )}
        {state === 'active' && (
          <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-blue-400/30" />
        )}
      </button>

      <div className="mt-2 max-w-[110px] text-center">
        <div className={`text-[11px] font-medium ${styles.label}`}>{def.label}</div>
        {detail?.date && <div className="mt-0.5 text-[9px] text-zinc-500">{detail.date}</div>}
        {detail?.summary && <div className="mt-0.5 text-[9px] text-zinc-400 leading-tight">{detail.summary}</div>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// MilestoneDetailPopover — detalle del hito seleccionado
// ═════════════════════════════════════════════════════════════════
function MilestoneDetailPopover({ milestone, onClose }) {
  const content = MILESTONE_DETAILS[milestone];
  if (!content) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-zinc-100">{content.title}</h4>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        {content.fields.map((f) => (
          <div key={f.label} className="flex flex-col">
            <span className="text-zinc-500">{f.label}</span>
            <span className={`${f.mono ? 'font-mono tabular-nums' : ''} ${f.accent ? 'text-amber-300' : 'text-zinc-200'}`}>{f.value}</span>
          </div>
        ))}
      </div>
      {content.note && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
          {content.note}
        </div>
      )}
    </div>
  );
}

const MILESTONE_DETAILS = {
  PLANNING: {
    title: 'Planeación pre-quirúrgica',
    fields: [
      { label: 'Fase', value: 'v1.1 (planeación CBCT estructurada)' },
      { label: 'Estado', value: 'Datos en notas clínicas' },
    ],
    note: 'En MVP se registra como notas. Modelo ImplantSurgicalPlan disponible en v1.1.',
  },
  SURGERY: {
    title: 'Cirugía de colocación',
    fields: [
      { label: 'Fecha', value: fmtDate(surgicalRecord.surgeryDate), mono: true },
      { label: 'Cirujano', value: surgicalRecord.doctor },
      { label: 'Profilaxis', value: surgicalRecord.preopAntibioticType },
      { label: 'Densidad ósea', value: `${surgicalRecord.boneDensity} (Lekholm-Zarb)`, mono: true },
      { label: 'Torque inserción', value: `${surgicalRecord.insertionTorqueNcm} Ncm`, mono: true, accent: true },
      { label: 'ISQ MD / VL', value: `${surgicalRecord.isqMesiodistal} / ${surgicalRecord.isqVestibulolingual}`, mono: true, accent: true },
      { label: 'Reborde', value: `${surgicalRecord.ridgeWidthMm}×${surgicalRecord.ridgeHeightMm} mm`, mono: true },
      { label: 'Colgajo', value: surgicalRecord.flapType },
      { label: 'Fresado', value: surgicalRecord.drillingProtocol },
      { label: 'Sutura', value: surgicalRecord.sutureMaterial },
      { label: 'Lote pilar cicatrización', value: surgicalRecord.healingAbutmentLot, mono: true, accent: true },
      { label: 'Duración', value: `${surgicalRecord.durationMinutes} min`, mono: true },
    ],
  },
  OSSEOINTEGRATION: {
    title: 'Osteointegración',
    fields: [
      { label: 'Inicio', value: fmtDate(healingPhase.startedAt), mono: true },
      { label: 'Duración esperada', value: `${healingPhase.expectedDurationWeeks} semanas`, mono: true },
      { label: 'ISQ semana 4', value: healingPhase.isqAt4Weeks, mono: true },
      { label: 'ISQ semana 8', value: healingPhase.isqAt8Weeks, mono: true, accent: true },
      { label: 'Completada', value: fmtDate(healingPhase.completedAt), mono: true },
      { label: 'Decisión', value: 'Apto para carga (ISQ ≥70)' },
    ],
    note: 'Albrektsson 1986: ISQ 78 supera el umbral ITI de 70 — apto para fase protésica.',
  },
  SECOND_STAGE: {
    title: '2ª cirugía',
    fields: [
      { label: 'Aplicabilidad', value: 'No aplica' },
      { label: 'Razón', value: 'Protocolo 1 fase con pilar de cicatrización inmediato' },
    ],
    note: 'Este hito solo aplica para implantes con protocolo TWO_STAGE.',
  },
  PROSTHETIC: {
    title: 'Fase protésica',
    fields: [
      { label: 'Pilar', value: prostheticPhase.abutmentType },
      { label: 'Lote pilar', value: prostheticPhase.abutmentLot, mono: true, accent: true },
      { label: 'Dimensiones pilar', value: `⌀${prostheticPhase.abutmentDiameterMm}×${prostheticPhase.abutmentHeightMm} mm`, mono: true },
      { label: 'Torque pilar', value: `${prostheticPhase.abutmentTorqueNcm} Ncm`, mono: true },
      { label: 'Tipo prótesis', value: prostheticPhase.prosthesisType },
      { label: 'Material', value: prostheticPhase.prosthesisMaterial },
      { label: 'Laboratorio', value: prostheticPhase.prosthesisLabName },
      { label: 'Lote prótesis', value: prostheticPhase.prosthesisLabLot, mono: true, accent: true },
      { label: 'Entrega', value: fmtDate(prostheticPhase.prosthesisDeliveredAt), mono: true },
      { label: 'Oclusión', value: prostheticPhase.occlusionScheme },
    ],
    note: 'Carnet del implante generado automáticamente al guardar esta fase.',
  },
  MAINTENANCE: {
    title: 'Mantenimiento periimplantario',
    fields: [
      { label: 'Próximo control', value: nextFollowUp ? `${nextFollowUp.milestone} (${fmtDate(nextFollowUp.scheduledAt)})` : '—', mono: true },
      { label: 'Pérdida ósea acumulada', value: '0.5 mm', mono: true, accent: true },
      { label: 'Albrektsson', value: 'Cumplido (esperable hasta 1.5 mm año 1)' },
      { label: 'Recall sugerido', value: 'Cada 6 meses' },
      { label: 'Riesgo', value: 'Bajo (no fumador activo, sin diabetes)' },
    ],
    note: 'Si BoP+ o supuración, se crea PeriImplantAssessment en módulo Periodoncia automáticamente.',
  },
};

// ═════════════════════════════════════════════════════════════════
// ImplantTimeline — los 6 hitos
// ═════════════════════════════════════════════════════════════════
const MILESTONE_DEFS = [
  { key: 'PLANNING',          label: 'Planeación',     icon: FileText,    description: 'Datos del CBCT' },
  { key: 'SURGERY',           label: 'Cirugía',        icon: Anchor,      description: 'Colocación del implante' },
  { key: 'OSSEOINTEGRATION',  label: 'Osteointegración', icon: Clock,    description: 'Cicatrización ósea' },
  { key: 'SECOND_STAGE',      label: '2ª cirugía',     icon: Wrench,      description: 'Solo protocolo 2 fases' },
  { key: 'PROSTHETIC',        label: 'Fase protésica', icon: Anchor,      description: 'Pilar y prótesis' },
  { key: 'MAINTENANCE',       label: 'Mantenimiento',  icon: Stethoscope, description: 'Controles periódicos' },
];

function ImplantTimeline({ selected, onSelect }) {
  const states = {
    PLANNING:         'completed',
    SURGERY:          'completed',
    OSSEOINTEGRATION: 'completed',
    SECOND_STAGE:     'skipped',
    PROSTHETIC:       'completed',
    MAINTENANCE:      'active',
  };

  const dates = {
    PLANNING:         { date: '—' },
    SURGERY:          { date: fmtDate(surgicalRecord.surgeryDate), summary: `${surgicalRecord.insertionTorqueNcm} Ncm · ISQ ${surgicalRecord.isqMesiodistal}/${surgicalRecord.isqVestibulolingual}` },
    OSSEOINTEGRATION: { date: `${healingPhase.expectedDurationWeeks} sem`, summary: `ISQ final ${healingPhase.isqLatest}` },
    SECOND_STAGE:     { summary: 'no aplica' },
    PROSTHETIC:       { date: fmtDate(prostheticPhase.prosthesisDeliveredAt), summary: 'Zirconia monolítica' },
    MAINTENANCE:      { date: fmtDate(nextFollowUp?.scheduledAt), summary: `próximo: ${nextFollowUp?.milestone}` },
  };

  return (
    <div className="relative">
      <div className="absolute left-6 right-6 top-[22px] h-0.5 bg-zinc-800" />
      <div className="relative grid grid-cols-6 gap-2">
        {MILESTONE_DEFS.map((def) => (
          <TimelineMilestone
            key={def.key}
            def={def}
            state={states[def.key]}
            detail={dates[def.key]}
            selected={selected === def.key}
            onSelect={() => onSelect(selected === def.key ? null : def.key)}
          />
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ImplantHeader
// ═════════════════════════════════════════════════════════════════
function ImplantHeader({ expanded, onToggle }) {
  const badge = STATUS_BADGES[implant.currentStatus];
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-950 ring-1 ring-zinc-800">
          <span className="font-mono text-2xl font-semibold text-zinc-100">{implant.toothFdi}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 ring-1 ring-blue-500/20">
            <Anchor size={18} className="text-blue-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                {implant.brandLabel} <span className="text-zinc-400">{implant.modelName}</span>
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              ⌀{implant.diameterMm} × {implant.lengthMm} mm · Lote {implant.lotNumber} · Colocado {fmtDate(implant.placedAt)}
            </div>
          </div>
        </div>
      </div>
      <button
        onClick={onToggle}
        className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        title={expanded ? 'Colapsar' : 'Expandir'}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ImplantSidePanel — datos COFEPRIS y técnicos
// ═════════════════════════════════════════════════════════════════
function SideRow({ label, value, mono, accent }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-zinc-500">{label}</span>
      <span className={`${mono ? 'font-mono tabular-nums' : ''} ${accent ? 'text-amber-300' : 'text-zinc-200'} text-right`}>
        {value}
      </span>
    </div>
  );
}

function SideSection({ title, children }) {
  return (
    <div>
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ImplantSidePanel() {
  const days = daysSince(implant.placedAt);
  return (
    <aside className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <SideSection title="Implante (COFEPRIS clase III)">
        <SideRow label="Marca" value={implant.brandLabel} />
        <SideRow label="Modelo" value={implant.modelName} />
        <SideRow label="Diámetro" value={`${implant.diameterMm} mm`} mono />
        <SideRow label="Longitud" value={`${implant.lengthMm} mm`} mono />
        <SideRow label="Conexión" value={implant.connectionType} />
        <SideRow label="Superficie" value={implant.surfaceTreatment} />
        <SideRow label="Lote" value={implant.lotNumber} mono accent />
        <SideRow label="Caducidad" value={fmtDate(implant.expiryDate)} mono />
      </SideSection>

      <SideSection title="Cirugía">
        <SideRow label="Fecha" value={fmtDate(surgicalRecord.surgeryDate)} mono />
        <SideRow label="Torque inserción" value={`${surgicalRecord.insertionTorqueNcm} Ncm`} mono />
        <SideRow label="ISQ MD / VL" value={`${surgicalRecord.isqMesiodistal} / ${surgicalRecord.isqVestibulolingual}`} mono />
        <SideRow label="Densidad ósea" value={surgicalRecord.boneDensity} mono />
        <SideRow label="Protocolo" value={implant.protocolLabel} />
      </SideSection>

      <SideSection title="Prótesis">
        <SideRow label="Pilar" value={prostheticPhase.abutmentType} />
        <SideRow label="Lote pilar" value={prostheticPhase.abutmentLot} mono accent />
        <SideRow label="Torque pilar" value={`${prostheticPhase.abutmentTorqueNcm} Ncm`} mono />
        <SideRow label="Material" value={prostheticPhase.prosthesisMaterial} />
        <SideRow label="Lab" value={prostheticPhase.prosthesisLabName} />
        <SideRow label="Lote prótesis" value={prostheticPhase.prosthesisLabLot} mono accent />
      </SideSection>

      <div className="border-t border-zinc-800 pt-2 text-center text-[10px] text-zinc-500">
        En función desde hace <span className="font-mono text-zinc-300">{days}</span> días
      </div>
    </aside>
  );
}

// ═════════════════════════════════════════════════════════════════
// ImplantActions — footer con acciones rápidas
// ═════════════════════════════════════════════════════════════════
function ActionBtn({ icon: Icon, label, onClick, tone, hint, disabled }) {
  const cls = tone === 'warning'
    ? 'border-orange-700/40 bg-orange-900/20 text-orange-200 hover:bg-orange-900/40'
    : tone === 'caution'
    ? 'border-amber-700/40 bg-amber-900/20 text-amber-200 hover:bg-amber-900/40'
    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${cls} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function ImplantActions({ onShowPassport, onShowBrandModal, onShowRemoveModal }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-5 py-3">
      <ActionBtn icon={ImageIcon} label="Radiografías" />
      <ActionBtn icon={FileSignature} label="Consentimiento" />
      <ActionBtn icon={Download} label="Carnet PDF" onClick={onShowPassport} />
      <span className="mx-2 h-4 w-px bg-zinc-800" />
      <ActionBtn icon={AlertTriangle} label="Registrar complicación" tone="warning" />
      <ActionBtn icon={Stethoscope} label="Mantenimiento" />
      <span className="ml-auto" />
      <ActionBtn icon={Edit3} label="Modificar trazabilidad" tone="caution" hint="Requiere justificación COFEPRIS ≥20 chars" onClick={onShowBrandModal} />
      <ActionBtn icon={X} label="Remover implante" tone="caution" hint="No borra — cambia a status REMOVED con motivo" onClick={onShowRemoveModal} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ImplantCard — tarjeta-timeline horizontal (núcleo del módulo)
// ═════════════════════════════════════════════════════════════════
function ImplantCard({ onShowPassport, onShowBrandModal, onShowRemoveModal }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedMilestone, setSelectedMilestone] = useState(null);
  const borderCls = STATUS_BORDERS[implant.currentStatus];

  return (
    <article className={`rounded-xl border-2 bg-zinc-900 transition-all ${borderCls}`}>
      <ImplantHeader expanded={expanded} onToggle={() => setExpanded(!expanded)} />

      {expanded && (
        <>
          <div className="grid grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-[1fr,300px]">
            <div>
              <ImplantTimeline selected={selectedMilestone} onSelect={setSelectedMilestone} />
              {selectedMilestone && (
                <div className="mt-4">
                  <MilestoneDetailPopover milestone={selectedMilestone} onClose={() => setSelectedMilestone(null)} />
                </div>
              )}
              {!selectedMilestone && (
                <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-400">
                  <Info size={11} className="mr-1 inline" />
                  Toca cualquier hito del timeline para ver el detalle clínico de esa fase.
                </div>
              )}
            </div>
            <ImplantSidePanel />
          </div>
          <ImplantActions
            onShowPassport={onShowPassport}
            onShowBrandModal={onShowBrandModal}
            onShowRemoveModal={onShowRemoveModal}
          />
        </>
      )}
    </article>
  );
}

// ═════════════════════════════════════════════════════════════════
// Modales
// ═════════════════════════════════════════════════════════════════
function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function BrandUpdateJustificationModal({ onClose }) {
  const [field, setField] = useState('lotNumber');
  const [newValue, setNewValue] = useState('');
  const [justification, setJustification] = useState('');
  const ok = justification.trim().length >= 20 && newValue.trim().length > 0;

  return (
    <Modal onClose={onClose}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-300">
          <Edit3 size={14} />
          Modificar trazabilidad COFEPRIS
        </h3>
      </div>
      <div className="space-y-4 p-5">
        <div className="rounded-md border border-amber-900/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          <strong>Atención:</strong> los campos de trazabilidad son inmutables por defecto (regulación COFEPRIS clase III).
          Esta modificación quedará registrada en audit log con tu cédula profesional, fecha exacta, valor anterior, valor nuevo y justificación.
        </div>

        <div>
          <label className="text-xs text-zinc-400">Campo a modificar</label>
          <select
            value={field}
            onChange={(e) => setField(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-blue-700"
          >
            <option value="lotNumber">lotNumber</option>
            <option value="brand">brand</option>
            <option value="placedAt">placedAt</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-zinc-400">Valor actual</label>
          <div className="mt-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-400">
            {String(implant[field])}
          </div>
        </div>

        <div>
          <label className="text-xs text-zinc-400">Nuevo valor</label>
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-blue-700"
            placeholder="Ej: A87654321"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-400">
            Justificación <span className="text-amber-400">(mínimo 20 caracteres — obligatorio)</span>
          </label>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder="Ej: error de captura inicial — el lote correcto según factura del proveedor 2024-XX-001 es..."
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-700"
          />
          <div className={`mt-1 text-[11px] ${justification.trim().length >= 20 ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {justification.trim().length} / 20 caracteres
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button onClick={onClose} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
          Cancelar
        </button>
        <button
          disabled={!ok}
          onClick={onClose}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Confirmar modificación
        </button>
      </div>
    </Modal>
  );
}

function RemoveImplantModal({ onClose }) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 20;

  return (
    <Modal onClose={onClose}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-red-300">
          <X size={14} />
          Remover implante — diente {implant.toothFdi}
        </h3>
      </div>
      <div className="space-y-4 p-5">
        <div className="rounded-md border border-red-900/40 bg-red-950/30 p-3 text-xs text-red-200">
          <strong>Importante:</strong> el implante NO se borra de la base de datos.
          Cambia su <code className="font-mono text-red-100">currentStatus</code> a <code className="font-mono text-red-100">REMOVED</code> y queda
          en el historial del paciente con la razón documentada. La trazabilidad COFEPRIS se preserva.
        </div>
        <div>
          <label className="text-xs text-zinc-400">
            Motivo de remoción <span className="text-amber-400">(mínimo 20 caracteres)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            placeholder="Ej: peri-implantitis avanzada con pérdida ósea >50%, decisión de explantación tras consenso con el paciente..."
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-700"
          />
          <div className={`mt-1 text-[11px] ${ok ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {reason.trim().length} / 20 caracteres
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button onClick={onClose} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
          Cancelar
        </button>
        <button
          disabled={!ok}
          onClick={onClose}
          className="rounded-md bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          Confirmar remoción
        </button>
      </div>
    </Modal>
  );
}

function PassportPreviewModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Download size={14} />
            Carnet del implante — preview
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X size={14} />
          </button>
        </div>

        {/* Mock del carnet en formato licencia horizontal */}
        <div className="p-6">
          <div className="mx-auto rounded-lg border-2 border-zinc-700 bg-gradient-to-br from-zinc-50 to-zinc-100 p-5 text-zinc-900" style={{ aspectRatio: '85/54' }}>
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-zinc-300 pb-2">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500">Carnet del implante dental</div>
                  <div className="mt-0.5 text-base font-semibold">{patient.name}</div>
                  <div className="text-[10px] text-zinc-600">Nacido: {fmtDate(patient.birthDate)} · {patient.fileNumber}</div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                  <Anchor size={18} />
                </div>
              </div>

              {/* Datos en 2 columnas */}
              <div className="mt-3 grid flex-1 grid-cols-2 gap-3 text-[10px]">
                <div>
                  <div className="mb-1 font-semibold uppercase tracking-wider text-zinc-500">Implante</div>
                  <PassRow k="Posición FDI" v={String(implant.toothFdi)} />
                  <PassRow k="Marca" v={implant.brandLabel} />
                  <PassRow k="Modelo" v={implant.modelName} />
                  <PassRow k="Dimensiones" v={`⌀${implant.diameterMm}×${implant.lengthMm} mm`} />
                  <PassRow k="Lote" v={implant.lotNumber} mono highlight />
                  <PassRow k="Colocado" v={fmtDate(implant.placedAt)} />
                </div>
                <div>
                  <div className="mb-1 font-semibold uppercase tracking-wider text-zinc-500">Prótesis</div>
                  <PassRow k="Tipo" v="Corona unitaria" />
                  <PassRow k="Material" v={prostheticPhase.prosthesisMaterial} />
                  <PassRow k="Lab" v={prostheticPhase.prosthesisLabName} />
                  <PassRow k="Lote prótesis" v={prostheticPhase.prosthesisLabLot} mono highlight />
                  <PassRow k="Lote pilar" v={prostheticPhase.abutmentLot} mono highlight />
                  <PassRow k="Entrega" v={fmtDate(prostheticPhase.prosthesisDeliveredAt)} />
                </div>
              </div>

              {/* Footer */}
              <div className="mt-2 flex items-end justify-between border-t border-zinc-300 pt-2 text-[9px]">
                <div>
                  <div className="font-semibold">Dr. Roberto Salazar · Cédula 12345678</div>
                  <div className="text-zinc-600">MediFlow Clínica · +52 999 100 2000</div>
                </div>
                <div className="text-zinc-400 italic">QR público: opt-in (no activado)</div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-400">
            <strong className="text-zinc-200">Generado automáticamente</strong> al finalizar fase protésica el {fmtDate(prostheticPhase.prosthesisDeliveredAt)}.
            Formato: licencia horizontal landscape (85×54mm). Cualquier cambio posterior regenera el PDF y conserva el anterior en historial.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            Cerrar
          </button>
          <button className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
            Descargar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function PassRow({ k, v, mono, highlight }) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-zinc-500">{k}</span>
      <span className={`${mono ? 'font-mono tabular-nums' : ''} ${highlight ? 'font-semibold text-amber-700' : 'text-zinc-800'} text-right`}>
        {v}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Sub-tab placeholders
// ═════════════════════════════════════════════════════════════════
function PlaceholderTab({ name, description }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
        <FileText size={18} className="text-zinc-500" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-300">Vista de {name}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">{description}</p>
      <p className="mt-3 text-[10px] text-zinc-600">Implementación en componente real (ver SPEC §6.15-6.16).</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Header del paciente
// ═════════════════════════════════════════════════════════════════
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
              <span>{patient.age} años</span><span>·</span>
              <span>{patient.phone}</span><span>·</span>
              <span>{patient.asaClassification}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-800/40 bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
            <Cigarette size={10} />Ex-fumador (5 años)
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">
            HTA controlada
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 ring-1 ring-emerald-500/30">
            <CheckCircle2 size={12} />
            1 implante en función
          </span>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            <FileText size={12} />Reporte quirúrgico
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
        <span>Pacientes</span><ChevronRight size={11} />
        <span>{patient.name}</span><ChevronRight size={11} />
        <span className="text-blue-300">Implantología</span>
      </div>
    </div>
  );
}

function SubTabsNav({ active, onChange }) {
  const tabs = [
    { id: 'implantes',    label: 'Implantes',           count: 1 },
    { id: 'cirugias',     label: 'Cirugías y aumentos', count: 1 },
    { id: 'mantenimiento',label: 'Mantenimiento',       count: 4 },
  ];
  return (
    <div className="flex border-b border-zinc-800 bg-zinc-950 px-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
            active === t.id ? 'text-blue-300' : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {t.label}
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px]">{t.count}</span>
          {active === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />}
        </button>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Sidebar — Albrektsson + recall
// ═════════════════════════════════════════════════════════════════
function ImplantSidebar() {
  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Estado del implante</h3>
      </div>

      <div className="space-y-2">
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-emerald-400">Albrektsson 1986</span>
            <CheckCircle2 size={12} className="text-emerald-400" />
          </div>
          <div className="mt-1 text-base font-semibold text-emerald-300">Cumplido</div>
          <div className="text-[10px] text-zinc-500">
            Pérdida ósea: <span className="font-mono text-zinc-300">0.5 mm</span> · esperable: <span className="font-mono text-zinc-300">≤1.5 mm</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Próximo control</span>
            <Calendar size={12} className="text-zinc-400" />
          </div>
          <div className="mt-1 text-base font-semibold text-zinc-200">{nextFollowUp?.milestone}</div>
          <div className="text-[10px] text-zinc-500">Programado: {fmtDate(nextFollowUp?.scheduledAt)}</div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Recall sugerido</span>
            <Stethoscope size={12} className="text-zinc-400" />
          </div>
          <div className="mt-1 text-base font-semibold text-zinc-200">Cada 6 meses</div>
          <div className="text-[10px] text-zinc-500">Riesgo bajo (no fumador activo)</div>
        </div>
      </div>

      {/* Evolución ISQ */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Evolución ISQ</div>
        <div className="space-y-1.5">
          {[
            { label: 'Baseline (cirugía)', value: '74 / 72', date: fmtDate(surgicalRecord.surgeryDate) },
            { label: 'Semana 4', value: '75', date: '15 nov 2024' },
            { label: 'Semana 8', value: '78', date: '10 dic 2024', highlight: true },
          ].map((r) => (
            <div key={r.label} className="flex items-baseline justify-between text-[10px]">
              <div>
                <div className="text-zinc-300">{r.label}</div>
                <div className="text-zinc-600">{r.date}</div>
              </div>
              <div className={`font-mono font-semibold ${r.highlight ? 'text-emerald-300' : 'text-zinc-200'}`}>{r.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-zinc-800 pt-2 text-[9px] text-zinc-500">
          Umbral ITI para carga: <span className="font-mono text-emerald-400">≥70</span>
        </div>
      </div>

      {/* Leyenda */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Leyenda timeline</div>
        <div className="space-y-1.5 text-[10px] text-zinc-400">
          <LegendDot color="emerald" label="Hito completado" />
          <LegendDot color="blue" label="Hito activo (en curso)" />
          <LegendDot color="amber" label="Control próximo" />
          <LegendDot color="orange" label="Complicación leve" />
          <LegendDot color="red" label="Complicación severa / fracaso" />
          <LegendDot color="zinc" label="No aplica (skipped)" />
        </div>
      </div>
    </aside>
  );
}

function LegendDot({ color, label }) {
  const cls = {
    emerald: 'bg-emerald-500/20 ring-emerald-500/40',
    blue:    'bg-blue-500/20 ring-blue-500/60',
    amber:   'bg-amber-500/20 ring-amber-500/40',
    orange:  'bg-orange-500/20 ring-orange-500/50',
    red:     'bg-red-500/20 ring-red-500/50',
    zinc:    'bg-zinc-800 ring-zinc-700',
  }[color];
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded-full ring-2 ${cls}`} />
      <span>{label}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Main App
// ═════════════════════════════════════════════════════════════════
export default function ImplantsModule() {
  const [activeTab, setActiveTab] = useState('implantes');
  const [showPassport, setShowPassport] = useState(false);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: 'ui-sans-serif, system-ui' }}>
      <PatientHeader />
      <SubTabsNav active={activeTab} onChange={setActiveTab} />

      <div className="flex">
        {activeTab === 'implantes' && <ImplantSidebar />}

        <main className="flex-1 p-6">
          {activeTab === 'implantes' && (
            <ImplantCard
              onShowPassport={() => setShowPassport(true)}
              onShowBrandModal={() => setShowBrandModal(true)}
              onShowRemoveModal={() => setShowRemoveModal(true)}
            />
          )}
          {activeTab === 'cirugias' && (
            <PlaceholderTab
              name="Cirugías y aumentos"
              description="Timeline cronológico con todas las cirugías del paciente: colocaciones de implante, descubrimientos de 2ª fase, aumentos óseos (v1.1) con biomateriales y lotes. Para Roberto: 1 cirugía de colocación el 15 oct 2024."
            />
          )}
          {activeTab === 'mantenimiento' && (
            <PlaceholderTab
              name="Mantenimiento"
              description="Tabla cronológica de visitas con BoP, PD máx, pérdida ósea radiográfica, criterios Albrektsson y próximo control. Para Roberto: 4 controles realizados (1 sem, 1 mes, 3 meses, 6 meses) + 2 programados (12 m, 24 m)."
            />
          )}
        </main>
      </div>

      {showPassport && <PassportPreviewModal onClose={() => setShowPassport(false)} />}
      {showBrandModal && <BrandUpdateJustificationModal onClose={() => setShowBrandModal(false)} />}
      {showRemoveModal && <RemoveImplantModal onClose={() => setShowRemoveModal(false)} />}
    </div>
  );
}
