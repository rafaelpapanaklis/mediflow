import { useState, useMemo, useEffect } from "react";

/* ───────────────────────────────────────────────────────────────────────
   MediFlow — Mockup interactivo del módulo de Odontopediatría
   Caso 2 del brief: Sofía Méndez Pérez · 8 años 2 meses
   Sin dependencias externas. Iconos SVG inline. Tokens fieles al
   globals.css real de MediFlow.
   ─────────────────────────────────────────────────────────────────────── */

/* ── Datos del caso ──────────────────────────────────────────────── */
const PATIENT = {
  id: "PT-002841",
  firstName: "Sofía",
  lastName: "Méndez Pérez",
  fullName: "Sofía Méndez Pérez",
  sex: "F",
  dob: "2017-12-15",
  ageYears: 8,
  ageMonths: 2,
  ageDecimal: 8.16,
  dentition: "Mixta · 1ª fase",
  cambraLevel: "bajo",
  cambraUpdated: "hace 3 meses",
  franklLast: 4,
  visitsCount: 7,
  lastVisit: "12 abr 2026",
  nextVisit: "15 may 2026",
  tutor: {
    name: "Carla Pérez Hernández",
    relation: "Madre",
    age: 34,
    phone: "+52 999 123 4567",
    email: "carla.perez@gmail.com",
  },
  alerts: ["Rinitis alérgica controlada", "Sin alergias medicamentosas"],
  consents: [
    { id: 1, label: "Tx odontológico general", status: "vigente", since: "ene 2026" },
    { id: 2, label: "Aplicación de sellantes", status: "pendiente", since: null },
  ],
};

/* Erupción — 12 dientes representativos para no sobrecargar */
const ERUPTION = [
  { fdi: "55", label: "55", type: "temp", arch: "sup", erupted: 5.2, start: 1.5, expEnd: 6.3, status: "erupted" },
  { fdi: "54", label: "54", type: "temp", arch: "sup", erupted: 1.7, start: 1.3, expEnd: 6.2, status: "erupted" },
  { fdi: "53", label: "53", type: "temp", arch: "sup", erupted: 1.8, start: 1.6, expEnd: 11.5, status: "erupted" },
  { fdi: "52", label: "52", type: "temp", arch: "sup", erupted: 0.9, start: 0.7, expEnd: 7.8, status: "erupted" },
  { fdi: "51", label: "51", type: "temp", arch: "sup", erupted: 0.7, start: 0.6, expEnd: 7.0, status: "shed" },
  { fdi: "11", label: "11", type: "perm", arch: "sup", erupted: 7.3, start: 6.8, expEnd: 11.0, status: "erupting" },
  { fdi: "12", label: "12", type: "perm", arch: "sup", erupted: 7.9, start: 7.2, expEnd: 11.5, status: "erupting" },
  { fdi: "16", label: "16", type: "perm", arch: "sup", erupted: 8.05, start: 6.0, expEnd: 11.0, status: "erupted" },
  { fdi: "26", label: "26", type: "perm", arch: "sup", erupted: 8.0, start: 6.0, expEnd: 11.0, status: "erupted" },
  { fdi: "36", label: "36", type: "perm", arch: "inf", erupted: 7.95, start: 6.0, expEnd: 11.0, status: "erupted" },
  { fdi: "46", label: "46", type: "perm", arch: "inf", erupted: 7.85, start: 6.0, expEnd: 11.0, status: "erupted" },
  { fdi: "31", label: "31", type: "perm", arch: "inf", erupted: 6.4, start: 6.0, expEnd: 11.0, status: "erupted" },
];

const HABITS = [
  {
    id: "h1",
    type: "Respiración bucal",
    icon: "wind",
    status: "observación",
    since: "ene 2026",
    notes: "Ronquido nocturno reportado. Pendiente derivación a ORL.",
  },
  {
    id: "h2",
    type: "Onicofagia",
    icon: "fingerprint",
    status: "observación",
    since: "feb 2026",
    notes: "Ocasional, asociada a tareas escolares.",
  },
  {
    id: "h3",
    type: "Succión digital",
    icon: "hand",
    status: "cesado",
    since: "abandonado a los 5 años",
    notes: "Abandono espontáneo, sin secuelas.",
  },
];

const FRANKL_HISTORY = [
  { date: "08 ago 2025", value: 3 },
  { date: "10 oct 2025", value: 3 },
  { date: "06 dic 2025", value: 4 },
  { date: "10 feb 2026", value: 4 },
  { date: "12 abr 2026", value: 4 },
];

const PREVENTIVE_PLAN = [
  {
    id: "p1",
    item: "Sellantes en 16 y 26",
    priority: "alta",
    suggested: "15 may 2026",
    status: "agendado",
    rationale: "Recién erupcionados, fosas y fisuras profundas",
  },
  {
    id: "p2",
    item: "Aplicación de fluoruro en barniz",
    priority: "media",
    suggested: "15 may 2026",
    status: "agendado",
    rationale: "Refuerzo en transición a dentición mixta",
  },
  {
    id: "p3",
    item: "Control de mordida cruzada lateral derecha",
    priority: "media",
    suggested: "ago 2026",
    status: "pendiente",
    rationale: "Evolución leve, vigilar antes de derivación",
  },
  {
    id: "p4",
    item: "Profilaxis y revisión",
    priority: "baja",
    suggested: "oct 2026",
    status: "pendiente",
    rationale: "Cada 6 meses según protocolo",
  },
  {
    id: "p5",
    item: "Evaluación de respiración bucal con ORL",
    priority: "alta",
    suggested: "antes de jul 2026",
    status: "pendiente",
    rationale: "Hábito en observación · derivación externa",
  },
];

const TOOTH_STATES = {
  "55": "healthy", "54": "healthy", "53": "healthy", "52": "healthy", "51": "shed",
  "61": "shed", "62": "healthy", "63": "healthy", "64": "healthy", "65": "healthy",
  "11": "erupting", "12": "erupting", "16": "sealant-pending", "26": "sealant-pending",
  "21": "erupting", "22": "erupting",
  "75": "restored", "85": "healthy", "84": "healthy", "74": "healthy",
  "73": "healthy", "72": "healthy", "71": "shed", "81": "shed", "82": "healthy", "83": "healthy",
  "36": "sealant-done", "46": "sealant-done", "31": "erupted", "41": "erupted",
};

/* ── Iconos SVG inline ──────────────────────────────────────────── */
const Icon = ({ name, size = 16, className = "" }) => {
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className };
  const paths = {
    baby: <><path d="M9 12h.01" /><path d="M15 12h.01" /><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" /></>,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
    search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
    user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    shieldCheck: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
    shieldAlert: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    sparkles: <><path d="M9.94 14.34a2 2 0 0 0-1.6-1.6L2 11.5l6.34-1.24a2 2 0 0 0 1.6-1.6L11.5 2l1.24 6.66a2 2 0 0 0 1.6 1.6L21 11.5l-6.66 1.24a2 2 0 0 0-1.6 1.6L11.5 21Z" /><path d="M19 3v4" /><path d="M21 5h-4" /></>,
    calendar: <><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
    fileText: <><path d="M14 3v4a2 2 0 0 0 2 2h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
    pen: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></>,
    smile: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01" /><path d="M15 9h.01" /></>,
    smilePlus: <><path d="M22 11v1a10 10 0 1 1-9-10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M16 5h6" /><path d="M19 2v6" /></>,
    meh: <><circle cx="12" cy="12" r="10" /><path d="M8 15h8" /><path d="M9 9h.01" /><path d="M15 9h.01" /></>,
    frown: <><circle cx="12" cy="12" r="10" /><path d="M16 16s-1.5-2-4-2-4 2-4 2" /><path d="M9 9h.01" /><path d="M15 9h.01" /></>,
    wind: <><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" /><path d="M9.6 4.6A2 2 0 1 1 11 8H2" /><path d="M12.6 19.4A2 2 0 1 0 14 16H2" /></>,
    fingerprint: <><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M2 12a10 10 0 0 1 18-6" /><path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" /><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M8.65 22c.21-.66.45-1.32.57-2" /><path d="M9 6.8a6 6 0 0 1 9 5.2v2" /></>,
    hand: <><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></>,
    droplets: <><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" /><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" /></>,
    moonStar: <><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /><path d="M20 3v4" /><path d="M22 5h-4" /></>,
    alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    arrow: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    command: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />,
    grid: <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></>,
    settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg {...common}>{paths[name] || null}</svg>;
};

/* ── Mini chip / pill components ─────────────────────────────────── */
const Chip = ({ tone = "default", icon, children, className = "" }) => {
  const tones = {
    default: { bg: "var(--bg-elev-2)", fg: "var(--text-2)", bd: "var(--border-soft)" },
    brand: { bg: "var(--brand-soft)", fg: "var(--brand)", bd: "var(--border-brand)" },
    success: { bg: "var(--success-soft)", fg: "var(--success)", bd: "transparent" },
    warning: { bg: "var(--warning-soft)", fg: "var(--warning)", bd: "transparent" },
    danger: { bg: "var(--danger-soft)", fg: "var(--danger)", bd: "transparent" },
    info: { bg: "var(--info-soft)", fg: "var(--info)", bd: "transparent" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight ${className}`}
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, height: 22 }}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
};

/* ── Header del paciente ─────────────────────────────────────────── */
const PatientHeader = () => {
  return (
    <header
      className="flex flex-wrap items-center gap-4 px-5 py-4"
      style={{ background: "var(--bg-elev)", borderBottom: "1px solid var(--border-soft)" }}
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold"
        style={{
          background: "linear-gradient(135deg, var(--brand) 0%, #a855f7 100%)",
          color: "#fff",
          fontFamily: "Sora, sans-serif",
        }}
      >
        SM
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1
            className="truncate text-[clamp(15px,1.2vw,18px)] font-semibold leading-tight"
            style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
          >
            {PATIENT.fullName}
          </h1>
          <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
            #{PATIENT.id}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Chip icon="baby" tone="brand">
            {PATIENT.ageYears}a {PATIENT.ageMonths}m
          </Chip>
          <Chip>{PATIENT.dentition}</Chip>
          <Chip tone="success" icon="shieldCheck">
            CAMBRA bajo
          </Chip>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            Última visita {PATIENT.lastVisit}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost-new">
          <Icon name="phone" size={14} /> Llamar
        </button>
        <button className="btn-secondary-new">
          <Icon name="calendar" size={14} /> Agendar
        </button>
      </div>
    </header>
  );
};

/* ── Tabs principales del expediente ─────────────────────────────── */
const PARENT_TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "historia", label: "Historia clínica" },
  { id: "consulta", label: "Nueva consulta" },
  { id: "evolucion", label: "Evolución" },
  { id: "rx", label: "Radiografías" },
  { id: "plan", label: "Plan tratamiento" },
  { id: "pediatria", label: "Pediatría", icon: "baby", brand: true },
  { id: "citas", label: "Citas" },
  { id: "facturacion", label: "Facturación" },
];

const ParentTabs = () => (
  <nav
    className="flex items-center gap-0.5 overflow-x-auto px-5"
    style={{
      background: "var(--bg-elev)",
      borderBottom: "1px solid var(--border-soft)",
      scrollbarWidth: "thin",
    }}
  >
    {PARENT_TABS.map((t) => {
      const active = t.id === "pediatria";
      return (
        <button
          key={t.id}
          className="relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium transition-colors"
          style={{
            color: active ? "var(--brand)" : "var(--text-2)",
            fontFamily: "Sora, sans-serif",
          }}
        >
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
          {active && (
            <span
              className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
              style={{ background: "var(--brand)", boxShadow: "0 0 8px rgba(124,58,237,.5)" }}
            />
          )}
        </button>
      );
    })}
  </nav>
);

/* ── ContextStrip ─────────────────────────────────────────────────── */
const ContextStrip = ({ onCapture }) => {
  return (
    <div
      className="sticky top-0 z-20 flex flex-wrap items-center gap-3 px-5 py-2"
      style={{
        background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--border-soft)",
        minHeight: 56,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          Pediatría
        </span>
      </div>
      <div className="hidden h-5 w-px md:block" style={{ background: "var(--border-soft)" }} />
      <ContextItem label="Edad" value={`${PATIENT.ageYears}a ${PATIENT.ageMonths}m`} sub={`${PATIENT.ageDecimal} dec`} />
      <ContextItem label="Dentición" value="Mixta · 1ª" sub="seg. erupción" />
      <ContextItem label="Riesgo CAMBRA" value="Bajo" sub={PATIENT.cambraUpdated} tone="success" />
      <ContextItem label="Frankl última" value="4 · Coopera" sub="12 abr" tone="success" />
      <ContextItem label="Tutor" value={PATIENT.tutor.relation} sub={PATIENT.tutor.name.split(" ")[0]} />
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-[11px] sm:inline" style={{ color: "var(--text-3)" }}>
          ⌘ J
        </span>
        <button onClick={onCapture} className="btn-primary-new">
          <Icon name="plus" size={14} />
          Nueva entrada
        </button>
      </div>
    </div>
  );
};

const ContextItem = ({ label, value, sub, tone }) => {
  const valueColor =
    tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "var(--text-1)";
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5 text-[13px] font-semibold" style={{ color: valueColor, fontFamily: "Sora, sans-serif" }}>
        {value}
        {sub && (
          <span className="text-[10.5px] font-normal" style={{ color: "var(--text-3)" }}>
            {sub}
          </span>
        )}
      </span>
    </div>
  );
};

/* ── SubNav del módulo Pediatría ─────────────────────────────────── */
const SUB_TABS = [
  { id: "resumen", label: "Resumen", icon: "grid" },
  { id: "odontograma", label: "Odontograma", icon: "smile" },
  { id: "erupcion", label: "Erupción", icon: "sparkles", star: true },
  { id: "habitos", label: "Hábitos", icon: "wind" },
  { id: "conducta", label: "Conducta", icon: "smilePlus" },
  { id: "plan", label: "Plan preventivo", icon: "shieldCheck" },
];

const SubNav = ({ active, onChange }) => (
  <div
    className="flex items-center gap-0.5 overflow-x-auto px-5 py-2"
    style={{ borderBottom: "1px solid var(--border-soft)", scrollbarWidth: "thin" }}
  >
    {SUB_TABS.map((t) => {
      const isActive = t.id === active;
      return (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition"
          style={{
            color: isActive ? "var(--brand)" : "var(--text-2)",
            background: isActive ? "var(--brand-soft)" : "transparent",
            border: isActive ? "1px solid var(--border-brand)" : "1px solid transparent",
            fontFamily: "Sora, sans-serif",
          }}
        >
          <Icon name={t.icon} size={14} />
          {t.label}
          {t.star && (
            <span
              className="ml-0.5 h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--brand)", boxShadow: "0 0 6px var(--brand)" }}
              title="Vista estrella"
            />
          )}
        </button>
      );
    })}
  </div>
);

/* ── SECCIÓN: RESUMEN ────────────────────────────────────────────── */
const ResumenSection = ({ onOpenDrawer }) => {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
      <Kpi
        title="Erupción"
        value="6 / 12"
        sub="dientes en transición"
        tone="brand"
        icon="sparkles"
        action={() => onOpenDrawer("eruption")}
        actionLabel="Ver línea"
      >
        <div className="mt-3 flex flex-wrap gap-1">
          {ERUPTION.slice(0, 8).map((t) => (
            <span
              key={t.fdi}
              className="font-mono text-[10.5px]"
              style={{
                padding: "3px 6px",
                borderRadius: 5,
                background: t.type === "perm" ? "var(--brand-soft)" : "rgba(244, 114, 182, 0.13)",
                color: t.type === "perm" ? "var(--brand)" : "#db2777",
                border: `1px solid ${t.type === "perm" ? "var(--border-brand)" : "rgba(244, 114, 182, 0.3)"}`,
              }}
            >
              {t.fdi}
            </span>
          ))}
        </div>
      </Kpi>

      <Kpi title="CAMBRA" value="Bajo" sub="actualizado hace 3m" tone="success" icon="shieldCheck">
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10.5px]">
          {[
            { l: "Caries 12m", v: "0 nuevas" },
            { l: "F-tópico", v: "Sí" },
            { l: "Higiene", v: "Buena" },
          ].map((r) => (
            <div
              key={r.l}
              className="rounded-md px-2 py-1.5 leading-tight"
              style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)" }}
            >
              <div style={{ color: "var(--text-3)" }}>{r.l}</div>
              <div className="mt-0.5 font-semibold" style={{ color: "var(--text-1)" }}>
                {r.v}
              </div>
            </div>
          ))}
        </div>
      </Kpi>

      <Kpi title="Conducta" value="Frankl 4" sub="def. positivo" tone="success" icon="smilePlus">
        <div className="mt-3 flex h-9 items-end gap-1">
          {FRANKL_HISTORY.map((f, i) => {
            const h = (f.value / 4) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-t"
                style={{
                  height: `${h}%`,
                  background: f.value === 4 ? "var(--success)" : "var(--brand)",
                  opacity: 0.7 + i * 0.05,
                }}
                title={`${f.date} · Frankl ${f.value}`}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px]" style={{ color: "var(--text-3)" }}>
          <span>ago 25</span>
          <span>abr 26</span>
        </div>
      </Kpi>

      <Kpi title="Hábitos" value="2 obs." sub="1 cesado" tone="warning" icon="wind">
        <ul className="mt-3 space-y-1.5">
          {HABITS.slice(0, 3).map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-[12px]">
              <Icon name={h.icon} size={12} />
              <span style={{ color: "var(--text-1)" }}>{h.type}</span>
              <Chip
                tone={h.status === "cesado" ? "success" : h.status === "observación" ? "warning" : "default"}
                className="ml-auto"
              >
                {h.status}
              </Chip>
            </li>
          ))}
        </ul>
      </Kpi>

      <Kpi title="Sellantes" value="2 / 4" sub="pendientes 16, 26" tone="brand" icon="shield">
        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={50} />
          <span className="font-mono text-[12px]" style={{ color: "var(--text-2)" }}>
            50%
          </span>
        </div>
        <button onClick={() => onOpenDrawer("sealant")} className="btn-link-new mt-3">
          Agendar 16, 26 <Icon name="arrow" size={12} />
        </button>
      </Kpi>

      <Kpi title="Consentimientos" value="1 / 2" sub="1 pendiente firma" tone="warning" icon="fileText">
        <ul className="mt-3 space-y-1.5">
          {PATIENT.consents.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[12px]">
              <span style={{ color: "var(--text-1)" }}>{c.label}</span>
              <Chip tone={c.status === "vigente" ? "success" : "warning"} className="ml-auto">
                {c.status}
              </Chip>
            </li>
          ))}
        </ul>
        <button onClick={() => onOpenDrawer("consent")} className="btn-link-new mt-3">
          Firmar sellantes <Icon name="pen" size={12} />
        </button>
      </Kpi>
    </div>
  );
};

const Kpi = ({ title, value, sub, tone = "default", icon, action, actionLabel, children }) => {
  const accent =
    tone === "brand" ? "var(--brand)"
    : tone === "success" ? "var(--success)"
    : tone === "warning" ? "var(--warning)"
    : tone === "danger" ? "var(--danger)"
    : "var(--text-2)";
  const accentBg =
    tone === "brand" ? "var(--brand-soft)"
    : tone === "success" ? "var(--success-soft)"
    : tone === "warning" ? "var(--warning-soft)"
    : tone === "danger" ? "var(--danger-soft)"
    : "var(--bg-elev-2)";
  return (
    <article
      className="card-mock relative overflow-hidden p-4"
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              {title}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="text-[clamp(18px,1.7vw,22px)] font-semibold leading-tight"
              style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
            >
              {value}
            </span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {sub}
          </span>
        </div>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: accentBg, color: accent }}
        >
          <Icon name={icon} size={14} />
        </div>
      </div>
      {children}
      {action && (
        <button onClick={action} className="btn-link-new mt-3">
          {actionLabel} <Icon name="arrow" size={12} />
        </button>
      )}
    </article>
  );
};

const ProgressBar = ({ value }) => (
  <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg-elev-2)" }}>
    <div
      className="h-full rounded-full"
      style={{ width: `${value}%`, background: "var(--brand)", boxShadow: "0 0 6px rgba(124,58,237,.4)" }}
    />
  </div>
);

/* ── SECCIÓN: ODONTOGRAMA ────────────────────────────────────────── */
const OdontogramaSection = ({ onSelectTooth, selectedTooth }) => {
  // Cuadrantes pediátricos / mixtos
  const upperRight = ["55", "54", "53", "52", "51"];
  const upperRightPerm = ["", "16", "", "12", "11"]; // permanentes correspondientes
  const upperLeft = ["61", "62", "63", "64", "65"];
  const upperLeftPerm = ["21", "22", "", "26", ""];
  const lowerLeft = ["75", "74", "73", "72", "71"];
  const lowerLeftPerm = ["", "", "", "", "31"];
  const lowerRight = ["81", "82", "83", "84", "85"];
  const lowerRightPerm = ["41", "", "", "", ""];

  return (
    <div className="p-5">
      <div
        className="rounded-2xl p-6"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
            >
              Odontograma pediátrico — dual
            </h3>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
              Dentición temporal (51–85) y permanente (11–46) en transición
            </p>
          </div>
          <Legend />
        </div>

        {/* Arco superior */}
        <div className="space-y-1">
          <ArchLabel side="Superior" />
          <div className="grid grid-cols-10 gap-1.5">
            {[...upperRight, ...upperLeft].map((fdi) => (
              <ToothCell key={fdi} fdi={fdi} state={TOOTH_STATES[fdi]} type="temp" onClick={onSelectTooth} selected={selectedTooth === fdi} />
            ))}
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {[...upperRightPerm, ...upperLeftPerm].map((fdi, i) =>
              fdi ? (
                <ToothCell key={fdi + i} fdi={fdi} state={TOOTH_STATES[fdi]} type="perm" onClick={onSelectTooth} selected={selectedTooth === fdi} />
              ) : (
                <div key={"e" + i} />
              )
            )}
          </div>
        </div>

        <div className="my-5 h-px" style={{ background: "var(--border-soft)" }} />

        {/* Arco inferior */}
        <div className="space-y-1">
          <div className="grid grid-cols-10 gap-1.5">
            {[...lowerRightPerm, ...lowerLeftPerm].reverse().map((fdi, i) =>
              fdi ? (
                <ToothCell key={fdi + i} fdi={fdi} state={TOOTH_STATES[fdi]} type="perm" onClick={onSelectTooth} selected={selectedTooth === fdi} />
              ) : (
                <div key={"el" + i} />
              )
            )}
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {[...lowerRight, ...lowerLeft].reverse().map((fdi) => (
              <ToothCell key={fdi} fdi={fdi} state={TOOTH_STATES[fdi]} type="temp" onClick={onSelectTooth} selected={selectedTooth === fdi} />
            ))}
          </div>
          <ArchLabel side="Inferior" />
        </div>

        {/* Detalle de diente */}
        {selectedTooth && (
          <div
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)" }}
          >
            <div className="flex items-center gap-3">
              <span
                className="rounded-md px-2.5 py-1 font-mono text-[14px] font-semibold"
                style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              >
                {selectedTooth}
              </span>
              <div>
                <div className="text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>
                  {toothLabel(selectedTooth)}
                </div>
                <div className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                  Estado: {stateLabel(TOOTH_STATES[selectedTooth])} · Última actualización: 12 abr 2026
                </div>
              </div>
            </div>
            <button className="btn-secondary-new">
              <Icon name="pen" size={13} />
              Editar diente
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ArchLabel = ({ side }) => (
  <div className="flex items-center gap-2 py-1">
    <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
      {side}
    </span>
    <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
  </div>
);

const stateColors = {
  healthy: { fill: "rgba(244, 114, 182, 0.18)", border: "rgba(244, 114, 182, 0.4)", fg: "#9d174d" },
  shed: { fill: "var(--bg-elev-2)", border: "var(--border-soft)", fg: "var(--text-4)", strike: true },
  restored: { fill: "rgba(245, 158, 11, 0.18)", border: "rgba(245, 158, 11, 0.5)", fg: "#92400e" },
  "sealant-pending": { fill: "rgba(220, 38, 38, 0.10)", border: "rgba(220, 38, 38, 0.5)", fg: "var(--danger)", pulse: true },
  "sealant-done": { fill: "var(--success-soft)", border: "var(--success)", fg: "var(--success)" },
  erupting: { fill: "var(--brand-soft)", border: "var(--border-brand)", fg: "var(--brand)", striped: true },
  erupted: { fill: "var(--brand-soft)", border: "var(--brand)", fg: "var(--brand)" },
};

const ToothCell = ({ fdi, state = "healthy", type, onClick, selected }) => {
  const c = stateColors[state] || stateColors.healthy;
  const permRing = type === "perm" ? `0 0 0 1.5px ${c.border} inset` : "none";
  return (
    <button
      onClick={() => onClick && onClick(fdi)}
      className="group relative flex aspect-square min-h-[44px] flex-col items-center justify-center rounded-lg text-center transition"
      style={{
        background: c.striped
          ? `repeating-linear-gradient(45deg, ${c.fill}, ${c.fill} 4px, transparent 4px, transparent 7px)`
          : c.fill,
        border: `1.5px solid ${c.border}`,
        color: c.fg,
        boxShadow: selected ? `0 0 0 2px var(--brand), 0 0 12px rgba(124,58,237,.5)` : permRing,
        outline: "none",
      }}
      title={`${fdi} · ${stateLabel(state)}`}
    >
      <span
        className="font-mono text-[11px] font-semibold leading-none"
        style={{ textDecoration: c.strike ? "line-through" : "none" }}
      >
        {fdi}
      </span>
      {state === "sealant-pending" && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: "var(--danger)" }}
        />
      )}
      {state === "sealant-done" && (
        <span
          className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
          style={{ background: "var(--success)", color: "#fff" }}
        >
          <Icon name="check" size={9} />
        </span>
      )}
    </button>
  );
};

const Legend = () => (
  <div className="flex flex-wrap gap-2 text-[11px]">
    <LegendDot color="rgba(244, 114, 182, 0.4)" label="Temporal" />
    <LegendDot color="var(--brand)" label="Permanente" />
    <LegendDot color="rgba(245, 158, 11, 0.5)" label="Restaurado" />
    <LegendDot color="var(--success)" label="Sellante" />
    <LegendDot color="var(--danger)" label="Pendiente" />
  </div>
);

const LegendDot = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
    {label}
  </span>
);

const stateLabel = (s) =>
  ({
    healthy: "Sano",
    shed: "Exfoliado",
    restored: "Restaurado",
    "sealant-pending": "Sellante pendiente",
    "sealant-done": "Sellante colocado",
    erupting: "En erupción",
    erupted: "Erupcionado",
  }[s] || s);

const toothLabel = (fdi) => {
  const n = parseInt(fdi[1]);
  const map = { 1: "Incisivo central", 2: "Incisivo lateral", 3: "Canino", 4: "Primer molar", 5: "Segundo molar", 6: "Primer molar perm.", 7: "Segundo molar perm." };
  return map[n] || `Diente ${fdi}`;
};

/* ── SECCIÓN: ERUPCIÓN (vista estrella) ──────────────────────────── */
const EruptionSection = () => {
  const minAge = 0;
  const maxAge = 13;
  const W = 700;
  const ROW_H = 28;
  const LABEL_W = 55;
  const PLOT_W = W - LABEL_W;
  const x = (age) => LABEL_W + ((age - minAge) / (maxAge - minAge)) * PLOT_W;
  const NEEDLE = x(PATIENT.ageDecimal);

  const sup = ERUPTION.filter((e) => e.arch === "sup");
  const inf = ERUPTION.filter((e) => e.arch === "inf");

  return (
    <div className="p-5">
      <div
        className="rounded-2xl p-6"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
            >
              Cronología de erupción
            </h3>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
              Línea vertical = edad actual de Sofía · {PATIENT.ageDecimal} años decimales
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: "var(--text-2)" }}>
            <LegendDot color="rgba(244, 114, 182, 0.5)" label="Temporal" />
            <LegendDot color="var(--brand)" label="Permanente" />
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--brand)", boxShadow: "0 0 6px var(--brand)" }} />
              Erupción real
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "var(--text-3)" }} />
              Proyección
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${(sup.length + inf.length) * ROW_H + 80}`}
            className="w-full"
            style={{ minWidth: 540 }}
            role="img"
            aria-label="Cronología de erupción"
          >
            {/* Eje X: marcadores de años */}
            {Array.from({ length: maxAge + 1 }).map((_, age) => {
              const xp = x(age);
              return (
                <g key={age}>
                  <line x1={xp} y1={20} x2={xp} y2={(sup.length + inf.length) * ROW_H + 30} stroke="var(--border-soft)" strokeDasharray={age % 2 === 0 ? "0" : "2 3"} strokeWidth={age % 2 === 0 ? 1 : 0.7} />
                  {age % 2 === 0 && (
                    <text x={xp} y={14} textAnchor="middle" style={{ fontSize: 10, fontFamily: "monospace", fill: "var(--text-3)" }}>
                      {age}a
                    </text>
                  )}
                </g>
              );
            })}

            {/* Filas: superior */}
            {sup.map((e, i) => (
              <EruptionRow key={e.fdi} entry={e} y={30 + i * ROW_H} x={x} labelW={LABEL_W} />
            ))}
            <line x1={LABEL_W} y1={30 + sup.length * ROW_H + 4} x2={W - 5} y2={30 + sup.length * ROW_H + 4} stroke="var(--border-soft)" strokeDasharray="3 3" />
            <text x={LABEL_W} y={30 + sup.length * ROW_H + 18} style={{ fontSize: 9, fontFamily: "Sora, sans-serif", fill: "var(--text-3)", letterSpacing: 1 }}>
              INFERIOR
            </text>

            {/* Filas: inferior */}
            {inf.map((e, i) => (
              <EruptionRow key={e.fdi} entry={e} y={30 + (sup.length + i) * ROW_H + 24} x={x} labelW={LABEL_W} />
            ))}

            {/* Needle: edad actual */}
            <line x1={NEEDLE} y1={20} x2={NEEDLE} y2={(sup.length + inf.length) * ROW_H + 30 + 24} stroke="var(--brand)" strokeWidth={2} strokeDasharray="4 3" />
            <circle cx={NEEDLE} cy={20} r={4} fill="var(--brand)" />
            <text x={NEEDLE + 6} y={16} style={{ fontSize: 10, fontFamily: "Sora, sans-serif", fontWeight: 600, fill: "var(--brand)" }}>
              hoy · 8a 2m
            </text>
          </svg>
        </div>

        <div
          className="mt-4 flex flex-wrap items-center gap-4 rounded-xl px-4 py-2.5 text-[11.5px]"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          <span className="font-semibold">Insight:</span>
          <span>Sofía está en transición esperada. Primeros molares permanentes recién erupcionados → ventana ideal de sellantes.</span>
        </div>
      </div>
    </div>
  );
};

const EruptionRow = ({ entry, y, x, labelW }) => {
  const isPerm = entry.type === "perm";
  const fill = isPerm ? "rgba(124,58,237,0.65)" : "rgba(244, 114, 182, 0.45)";
  const x1 = x(entry.start);
  const x2 = x(entry.expEnd);
  const xErupt = x(entry.erupted);
  const isProjection = entry.status !== "erupted" && entry.status !== "shed";
  return (
    <g>
      <text x={labelW - 8} y={y + 12} textAnchor="end" style={{ fontSize: 11, fontFamily: "monospace", fill: isPerm ? "var(--brand)" : "#db2777", fontWeight: 600 }}>
        {entry.label}
      </text>
      {/* Rango esperado */}
      <rect x={x1} y={y + 4} width={x2 - x1} height={14} fill={fill} rx={3} opacity={0.55} />
      {/* Punto de erupción */}
      {entry.status === "erupted" || entry.status === "erupting" ? (
        <circle cx={xErupt} cy={y + 11} r={4.5} fill={isPerm ? "var(--brand)" : "#db2777"} stroke="var(--bg-elev)" strokeWidth={1.5} />
      ) : (
        <circle cx={xErupt} cy={y + 11} r={4} fill="transparent" stroke="var(--text-3)" strokeWidth={1.5} />
      )}
    </g>
  );
};

/* ── SECCIÓN: HÁBITOS ────────────────────────────────────────────── */
const HabitsSection = ({ onOpenDrawer }) => {
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="text-[14px] font-semibold"
            style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
          >
            Hábitos orales
          </h3>
          <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
            {HABITS.length} registros · 2 en observación · 1 cesado
          </p>
        </div>
        <button onClick={() => onOpenDrawer("habit")} className="btn-secondary-new">
          <Icon name="plus" size={13} />
          Registrar hábito
        </button>
      </div>

      <div className="space-y-2">
        {HABITS.map((h) => {
          const tone =
            h.status === "cesado" ? "success" : h.status === "observación" ? "warning" : "danger";
          return (
            <article
              key={h.id}
              className="flex flex-wrap items-center gap-4 rounded-xl px-4 py-3 transition hover:shadow-sm"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: "var(--bg-elev-2)", color: "var(--text-2)" }}
              >
                <Icon name={h.icon} size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
                    {h.type}
                  </span>
                  <Chip tone={tone}>{h.status}</Chip>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: "var(--text-3)" }}>
                  {h.notes}
                </p>
              </div>
              <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                {h.since}
              </span>
              <button className="btn-ghost-new">
                <Icon name="pen" size={13} />
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
};

/* ── SECCIÓN: CONDUCTA ───────────────────────────────────────────── */
const BehaviorSection = ({ onOpenDrawer }) => {
  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[1fr_320px]">
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
              Tendencia Frankl
            </h3>
            <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
              Últimas {FRANKL_HISTORY.length} consultas · clínica
            </p>
          </div>
          <Chip tone="success" icon="check">
            Mejoría sostenida
          </Chip>
        </div>

        {/* Sparkline expandido */}
        <FranklChart data={FRANKL_HISTORY} />

        <div className="mt-5 grid grid-cols-4 gap-2 text-center text-[11px]">
          {[
            { v: 1, l: "Def. negativo", icon: "frown", color: "var(--danger)" },
            { v: 2, l: "Negativo", icon: "frown", color: "var(--warning)" },
            { v: 3, l: "Positivo", icon: "meh", color: "var(--info)" },
            { v: 4, l: "Def. positivo", icon: "smilePlus", color: "var(--success)" },
          ].map((f) => (
            <div
              key={f.v}
              className="rounded-lg p-2.5"
              style={{
                background: f.v === PATIENT.franklLast ? "var(--success-soft)" : "var(--bg-elev-2)",
                border: f.v === PATIENT.franklLast ? `1px solid var(--success)` : "1px solid var(--border-soft)",
                color: f.v === PATIENT.franklLast ? "var(--success)" : "var(--text-2)",
              }}
            >
              <Icon name={f.icon} size={20} className="mx-auto" />
              <div className="mt-1 font-mono text-[14px] font-semibold">{f.v}</div>
              <div className="text-[10.5px]">{f.l}</div>
            </div>
          ))}
        </div>
      </div>

      <aside
        className="rounded-2xl p-5"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
          Última evaluación
        </h3>
        <div className="mt-3 space-y-3 text-[12px]" style={{ color: "var(--text-2)" }}>
          <Row label="Fecha" value="12 abr 2026" />
          <Row label="Frankl" value="4 — Def. positivo" valueColor="var(--success)" />
          <Row label="Evaluador" value="Dr. R. Vargas" />
          <Row label="Tipo procedimiento" value="Profilaxis" />
          <div>
            <div className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              Notas
            </div>
            <p className="mt-1 leading-relaxed">
              Coopera espontáneamente. Acepta instrumentación sin reservas. Comunicación verbal fluida.
            </p>
          </div>
        </div>
        <button onClick={() => onOpenDrawer("frankl")} className="btn-secondary-new mt-4 w-full justify-center">
          <Icon name="plus" size={13} />
          Nueva evaluación
        </button>
      </aside>
    </div>
  );
};

const FranklChart = ({ data }) => {
  const W = 600;
  const H = 140;
  const PAD = { l: 30, r: 16, t: 14, b: 28 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const maxX = data.length - 1;
  const xs = (i) => PAD.l + (i / maxX) * innerW;
  const ys = (v) => PAD.t + innerH - ((v - 1) / 3) * innerH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(d.value)}`).join(" ");
  const area = `${path} L ${xs(maxX)} ${PAD.t + innerH} L ${PAD.l} ${PAD.t + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
      {/* Líneas guía */}
      {[1, 2, 3, 4].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={ys(v)} y2={ys(v)} stroke="var(--border-soft)" strokeDasharray="2 3" />
          <text x={20} y={ys(v) + 3} textAnchor="end" style={{ fontSize: 10, fontFamily: "monospace", fill: "var(--text-3)" }}>
            {v}
          </text>
        </g>
      ))}
      {/* Área */}
      <defs>
        <linearGradient id="franklGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#franklGrad)" />
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Puntos */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xs(i)} cy={ys(d.value)} r={4} fill="var(--bg-elev)" stroke="var(--brand)" strokeWidth={2} />
          <text x={xs(i)} y={H - 10} textAnchor="middle" style={{ fontSize: 10, fontFamily: "monospace", fill: "var(--text-3)" }}>
            {d.date.slice(0, 6)}
          </text>
        </g>
      ))}
    </svg>
  );
};

const Row = ({ label, value, valueColor }) => (
  <div className="flex justify-between">
    <span style={{ color: "var(--text-3)" }}>{label}</span>
    <span style={{ color: valueColor || "var(--text-1)", fontWeight: 500 }}>{value}</span>
  </div>
);

/* ── SECCIÓN: PLAN PREVENTIVO ────────────────────────────────────── */
const PreventivePlanSection = ({ onOpenDrawer }) => {
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
            Plan preventivo
          </h3>
          <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
            {PREVENTIVE_PLAN.length} acciones · 2 agendadas · 3 pendientes
          </p>
        </div>
        <button onClick={() => onOpenDrawer("plan")} className="btn-secondary-new">
          <Icon name="plus" size={13} />
          Agregar acción
        </button>
      </div>

      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}
      >
        {PREVENTIVE_PLAN.map((p, i) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-[var(--bg-hover)]"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{
                background: priorityBg(p.priority),
                color: priorityFg(p.priority),
              }}
            >
              <Icon name={p.status === "agendado" ? "calendar" : "alert"} size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
                  {p.item}
                </span>
                <Chip tone={priorityTone(p.priority)}>Prioridad {p.priority}</Chip>
                <Chip tone={p.status === "agendado" ? "info" : "default"}>{p.status}</Chip>
              </div>
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                {p.rationale}
              </p>
            </div>
            <span className="font-mono text-[11.5px]" style={{ color: "var(--text-2)" }}>
              {p.suggested}
            </span>
            <button className="btn-ghost-new">
              <Icon name="chevronRight" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const priorityTone = (p) => (p === "alta" ? "danger" : p === "media" ? "warning" : "default");
const priorityBg = (p) =>
  p === "alta" ? "var(--danger-soft)" : p === "media" ? "var(--warning-soft)" : "var(--bg-elev-2)";
const priorityFg = (p) =>
  p === "alta" ? "var(--danger)" : p === "media" ? "var(--warning)" : "var(--text-2)";

/* ── SIDERAIL ─────────────────────────────────────────────────────── */
const Siderail = ({ onOpenDrawer }) => (
  <aside className="hidden w-[280px] shrink-0 flex-col gap-3 p-5 pl-0 xl:flex">
    {/* Tutor */}
    <div className="rounded-xl p-4" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          Tutor responsable
        </span>
        <button onClick={() => onOpenDrawer("guardian")} className="btn-icon-new">
          <Icon name="pen" size={11} />
        </button>
      </div>
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: "var(--bg-elev-2)", color: "var(--text-1)" }}
        >
          CP
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold" style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}>
            {PATIENT.tutor.name}
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {PATIENT.tutor.relation} · {PATIENT.tutor.age}a
          </div>
          <div className="mt-2 flex flex-col gap-1 text-[11.5px]" style={{ color: "var(--text-2)" }}>
            <span className="flex items-center gap-1.5 font-mono">
              <Icon name="phone" size={11} />
              {PATIENT.tutor.phone}
            </span>
          </div>
        </div>
      </div>
    </div>

    {/* Alertas */}
    <div className="rounded-xl p-4" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}>
      <div className="mb-2 flex items-center gap-2">
        <Icon name="bell" size={12} className="text-[var(--warning)]" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          Alertas clínicas
        </span>
      </div>
      <ul className="space-y-1.5 text-[12px]" style={{ color: "var(--text-2)" }}>
        {PATIENT.alerts.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: a.includes("Sin") ? "var(--success)" : "var(--warning)" }}
            />
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </div>

    {/* Consentimientos */}
    <div className="rounded-xl p-4" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          Consentimientos
        </span>
        <Chip tone="warning">1 pend.</Chip>
      </div>
      <ul className="space-y-2">
        {PATIENT.consents.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[12px]">
            <Icon
              name={c.status === "vigente" ? "shieldCheck" : "shieldAlert"}
              size={13}
              className={c.status === "vigente" ? "text-[var(--success)]" : "text-[var(--warning)]"}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ color: "var(--text-1)" }}>
                {c.label}
              </div>
              <div className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
                {c.status === "vigente" ? `firmado ${c.since}` : "requiere firma"}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={() => onOpenDrawer("consent")} className="btn-link-new mt-3">
        Firmar pendiente <Icon name="arrow" size={12} />
      </button>
    </div>

    {/* Próxima cita */}
    <div className="rounded-xl p-4" style={{ background: "var(--brand-soft)", border: "1px solid var(--border-brand)" }}>
      <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--brand)" }}>
        Próxima cita
      </span>
      <div className="mt-1 text-[14px] font-semibold" style={{ color: "var(--brand)", fontFamily: "Sora, sans-serif" }}>
        {PATIENT.nextVisit}
      </div>
      <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-2)" }}>
        Sellantes 16, 26 + fluoruro
      </div>
    </div>
  </aside>
);

/* ── DRAWER ──────────────────────────────────────────────────────── */
const DRAWER_TITLES = {
  generic: "Nueva entrada pediátrica",
  habit: "Registrar hábito oral",
  frankl: "Evaluación Frankl",
  sealant: "Programar sellante",
  consent: "Firmar consentimiento",
  guardian: "Editar tutor",
  eruption: "Registrar erupción",
  plan: "Agregar al plan preventivo",
};

const Drawer = ({ open, ctx, onClose }) => {
  const [habitType, setHabitType] = useState("");
  const [franklValue, setFranklValue] = useState(4);
  const [notes, setNotes] = useState("");

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isGeneric = ctx === "generic";

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: "rgba(15,10,30,0.4)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={DRAWER_TITLES[ctx] || "Drawer"}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col transition-transform duration-300 ease-out"
        style={{
          background: "var(--bg-elev)",
          borderLeft: "1px solid var(--border-soft)",
          boxShadow: "-12px 0 32px rgba(15,10,30,0.18)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <header
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-soft)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
            >
              <Icon name="plus" size={16} />
            </div>
            <div>
              <h2
                className="text-[14px] font-semibold leading-tight"
                style={{ color: "var(--text-1)", fontFamily: "Sora, sans-serif" }}
              >
                {DRAWER_TITLES[ctx] || "Nueva entrada"}
              </h2>
              <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                Sofía Méndez · 8a 2m
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon-new" aria-label="Cerrar">
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {isGeneric && (
            <Field label="Tipo de entrada">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "habit", label: "Hábito oral", icon: "wind" },
                  { id: "frankl", label: "Eval. Frankl", icon: "smilePlus" },
                  { id: "eruption", label: "Erupción", icon: "sparkles" },
                  { id: "sealant", label: "Sellante", icon: "shield" },
                  { id: "fluoride", label: "Fluoruro", icon: "droplets" },
                  { id: "consent", label: "Consentimiento", icon: "fileText" },
                ].map((opt, i) => (
                  <button
                    key={opt.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12.5px] font-medium transition hover:border-[var(--border-brand)] hover:bg-[var(--brand-softer)]"
                    style={{
                      background: "var(--bg-elev-2)",
                      border: "1px solid var(--border-soft)",
                      color: "var(--text-1)",
                    }}
                  >
                    <Icon name={opt.icon} size={14} className="text-[var(--brand)]" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label="Fecha">
            <div className="flex items-center gap-2">
              <input type="date" defaultValue="2026-04-30" className="input-mock w-full" />
              <span className="font-mono text-[10.5px]" style={{ color: "var(--text-3)" }}>
                hoy
              </span>
            </div>
          </Field>

          {ctx === "frankl" || isGeneric ? (
            <Field label="Escala Frankl" hint="Definitivamente positivo · cooperación espontánea">
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((v) => {
                  const sel = v === franklValue;
                  const tones = {
                    1: { bg: "var(--danger-soft)", fg: "var(--danger)" },
                    2: { bg: "var(--warning-soft)", fg: "var(--warning)" },
                    3: { bg: "var(--info-soft)", fg: "var(--info)" },
                    4: { bg: "var(--success-soft)", fg: "var(--success)" },
                  };
                  const t = tones[v];
                  return (
                    <button
                      key={v}
                      onClick={() => setFranklValue(v)}
                      className="flex flex-col items-center justify-center gap-1 rounded-lg py-3 transition"
                      style={{
                        background: sel ? t.bg : "var(--bg-elev-2)",
                        border: sel ? `1.5px solid ${t.fg}` : "1px solid var(--border-soft)",
                        color: sel ? t.fg : "var(--text-2)",
                        boxShadow: sel ? `0 0 0 3px ${t.bg}` : "none",
                      }}
                    >
                      <Icon name={["frown", "frown", "meh", "smilePlus"][v - 1]} size={20} />
                      <span className="font-mono text-[14px] font-semibold">{v}</span>
                      <span className="text-[10px]">{["Def. neg.", "Negativo", "Positivo", "Def. pos."][v - 1]}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {ctx === "habit" && (
            <>
              <Field label="Tipo de hábito">
                <div className="grid grid-cols-3 gap-2">
                  {["Succión digital", "Biberón nocturno", "Resp. bucal", "Bruxismo", "Onicofagia", "Deglución at."].map((h) => (
                    <button
                      key={h}
                      onClick={() => setHabitType(h)}
                      className="rounded-lg px-2 py-2 text-[11.5px] font-medium transition"
                      style={{
                        background: habitType === h ? "var(--brand-soft)" : "var(--bg-elev-2)",
                        border: habitType === h ? "1.5px solid var(--brand)" : "1px solid var(--border-soft)",
                        color: habitType === h ? "var(--brand)" : "var(--text-2)",
                      }}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Estado">
                <div className="flex gap-2">
                  {["Activo", "Observación", "Cesado"].map((s) => (
                    <button
                      key={s}
                      className="flex-1 rounded-lg py-2 text-[12px] font-medium"
                      style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", color: "var(--text-2)" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          <Field label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="input-mock w-full resize-none"
              placeholder="Observaciones clínicas, contexto familiar, recomendaciones…"
            />
          </Field>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderTop: "1px solid var(--border-soft)", background: "var(--bg-elev-2)" }}
        >
          <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
            <kbd className="kbd">Esc</kbd> cerrar · <kbd className="kbd">⌘</kbd>+<kbd className="kbd">↵</kbd> guardar
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary-new">
              Cancelar
            </button>
            <button className="btn-primary-new">
              <Icon name="check" size={13} /> Guardar
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
};

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[11.5px] font-semibold" style={{ color: "var(--text-2)", fontFamily: "Sora, sans-serif" }}>
      {label}
    </label>
    {hint && (
      <p className="mb-1.5 mt-0.5 text-[10.5px]" style={{ color: "var(--text-3)" }}>
        {hint}
      </p>
    )}
    <div className={hint ? "" : "mt-1.5"}>{children}</div>
  </div>
);

/* ── APP ROOT ─────────────────────────────────────────────────────── */
export default function App() {
  const [theme, setTheme] = useState("light");
  const [tab, setTab] = useState("resumen");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCtx, setDrawerCtx] = useState("generic");
  const [selectedTooth, setSelectedTooth] = useState("16");

  const openDrawer = (ctx = "generic") => {
    setDrawerCtx(ctx);
    setDrawerOpen(true);
  };

  return (
    <div className={theme} style={{ minHeight: "100vh" }}>
      {/* Estilos globales del mockup */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --bg: #F8F7FC;
          --bg-elev: #FFFFFF;
          --bg-elev-2: #F0EEF7;
          --bg-hover: rgba(124,58,237,0.04);
          --border-soft: rgba(15,10,30,0.10);
          --border-strong: rgba(15,10,30,0.18);
          --border-brand: rgba(124,58,237,0.30);
          --brand: #7c3aed;
          --brand-soft: rgba(124,58,237,0.10);
          --brand-softer: rgba(124,58,237,0.04);
          --text-1: #14101F;
          --text-2: #4A4560;
          --text-3: #7D7892;
          --text-4: #A8A4B8;
          --success: #059669;
          --success-soft: rgba(5,150,105,0.10);
          --warning: #d97706;
          --warning-soft: rgba(217,119,6,0.10);
          --danger: #dc2626;
          --danger-soft: rgba(220,38,38,0.10);
          --info: #2563eb;
          --info-soft: rgba(37,99,235,0.10);
        }
        .dark {
          --bg: #0B0815;
          --bg-elev: #121020;
          --bg-elev-2: #1A1630;
          --bg-hover: rgba(255,255,255,0.04);
          --border-soft: rgba(255,255,255,0.08);
          --border-strong: rgba(255,255,255,0.14);
          --border-brand: rgba(124,58,237,0.40);
          --brand: #8b5cf6;
          --brand-soft: rgba(139,92,246,0.16);
          --brand-softer: rgba(139,92,246,0.06);
          --text-1: #E8E8EC;
          --text-2: #A0A0AB;
          --text-3: #6B6B78;
          --text-4: #45454F;
          --success: #10b981;
          --success-soft: rgba(16,185,129,0.14);
          --warning: #f59e0b;
          --warning-soft: rgba(245,158,11,0.14);
          --danger: #ef4444;
          --danger-soft: rgba(239,68,68,0.14);
          --info: #3b82f6;
          --info-soft: rgba(59,130,246,0.14);
        }

        * { box-sizing: border-box; }
        body, .mediflow-shell {
          font-family: 'Sora', system-ui, sans-serif;
          background: var(--bg);
          color: var(--text-1);
          background-image:
            radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(124,58,237,0.05), transparent 70%),
            linear-gradient(rgba(20,16,31,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(20,16,31,0.025) 1px, transparent 1px);
          background-size: auto, 32px 32px, 32px 32px;
          background-attachment: fixed;
        }
        .dark body, .dark .mediflow-shell {
          background-image:
            radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(124,58,237,0.10), transparent 70%),
            radial-gradient(ellipse 800px 400px at 90% 10%, rgba(168,85,247,0.06), transparent 70%),
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: auto, auto, 32px 32px, 32px 32px;
        }

        .mono { font-family: 'JetBrains Mono', monospace; }

        .btn-primary-new, .btn-secondary-new, .btn-ghost-new, .btn-icon-new, .btn-link-new {
          font-family: 'Sora', sans-serif;
          font-weight: 500;
          font-size: 12.5px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 8px;
          transition: all .15s ease;
          cursor: pointer;
          line-height: 1;
          white-space: nowrap;
        }
        .btn-primary-new {
          background: var(--brand);
          color: #fff;
          padding: 8px 14px;
          border: 1px solid var(--brand);
          box-shadow: 0 0 0 0 var(--brand);
        }
        .btn-primary-new:hover {
          box-shadow: 0 0 0 4px var(--brand-soft), 0 4px 12px rgba(124,58,237,0.25);
          transform: translateY(-1px);
        }
        .btn-secondary-new {
          background: var(--bg-elev);
          color: var(--text-1);
          padding: 7px 12px;
          border: 1px solid var(--border-soft);
        }
        .btn-secondary-new:hover {
          border-color: var(--border-brand);
          background: var(--brand-softer);
        }
        .btn-ghost-new {
          background: transparent;
          color: var(--text-2);
          padding: 6px 10px;
          border: 1px solid transparent;
        }
        .btn-ghost-new:hover {
          background: var(--bg-hover);
          color: var(--text-1);
        }
        .btn-icon-new {
          background: var(--bg-elev-2);
          color: var(--text-2);
          width: 30px;
          height: 30px;
          padding: 0;
          justify-content: center;
          border: 1px solid var(--border-soft);
        }
        .btn-icon-new:hover {
          color: var(--brand);
          border-color: var(--border-brand);
        }
        .btn-link-new {
          background: transparent;
          color: var(--brand);
          font-weight: 600;
          padding: 0;
          font-size: 12px;
        }
        .btn-link-new:hover { text-decoration: underline; }

        .input-mock {
          background: var(--bg-elev);
          border: 1px solid var(--border-soft);
          color: var(--text-1);
          padding: 9px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-family: 'Sora', sans-serif;
          transition: all .15s ease;
        }
        .input-mock:focus {
          outline: none;
          border-color: var(--brand);
          box-shadow: 0 0 0 3px var(--brand-soft);
        }
        .input-mock::placeholder { color: var(--text-3); }

        .kbd {
          display: inline-block;
          background: var(--bg-elev);
          border: 1px solid var(--border-soft);
          border-bottom-width: 2px;
          border-radius: 4px;
          padding: 1px 5px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--text-2);
        }

        button:focus-visible {
          outline: 2px solid var(--brand);
          outline-offset: 2px;
        }

        ::selection { background: var(--brand-soft); color: var(--brand); }
      `}</style>

      {/* Topbar */}
      <header
        className="mediflow-shell sticky top-0 z-30 flex items-center gap-4 px-5 py-2.5"
        style={{
          background: "color-mix(in srgb, var(--bg-elev) 85%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{
              background: "linear-gradient(135deg, var(--brand) 0%, #6366f1 100%)",
              boxShadow: "0 0 12px rgba(124,58,237,0.4)",
            }}
          >
            <Icon name="sparkles" size={14} className="text-white" />
          </div>
          <span className="text-[14px] font-semibold tracking-tight" style={{ fontFamily: "Sora, sans-serif" }}>
            MediFlow
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            / Pacientes / {PATIENT.fullName}
          </span>
        </div>
        <button
          className="ml-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px]"
          style={{
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-3)",
            minWidth: 200,
          }}
        >
          <Icon name="search" size={13} />
          <span className="hidden sm:inline">Buscar paciente, agenda…</span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        </button>
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="btn-icon-new"
          aria-label={`Cambiar a modo ${theme === "light" ? "oscuro" : "claro"}`}
          title={`Modo ${theme === "light" ? "oscuro" : "claro"}`}
        >
          <Icon name={theme === "light" ? "moon" : "sun"} size={14} />
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          RV
        </div>
      </header>

      {/* Content */}
      <main className="mediflow-shell">
        <PatientHeader />
        <ParentTabs />
        <ContextStrip onCapture={() => openDrawer("generic")} />

        <div className="flex">
          <div className="min-w-0 flex-1">
            <SubNav active={tab} onChange={setTab} />
            {tab === "resumen" && <ResumenSection onOpenDrawer={openDrawer} />}
            {tab === "odontograma" && <OdontogramaSection onSelectTooth={setSelectedTooth} selectedTooth={selectedTooth} />}
            {tab === "erupcion" && <EruptionSection />}
            {tab === "habitos" && <HabitsSection onOpenDrawer={openDrawer} />}
            {tab === "conducta" && <BehaviorSection onOpenDrawer={openDrawer} />}
            {tab === "plan" && <PreventivePlanSection onOpenDrawer={openDrawer} />}
          </div>
          <Siderail onOpenDrawer={openDrawer} />
        </div>

        <footer
          className="px-5 py-4 text-center text-[10.5px]"
          style={{ color: "var(--text-3)", borderTop: "1px solid var(--border-soft)" }}
        >
          MediFlow · Módulo de Odontopediatría v1.0 · Mockup interactivo · Datos del Caso 2 (brief clínico)
        </footer>
      </main>

      <Drawer open={drawerOpen} ctx={drawerCtx} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
