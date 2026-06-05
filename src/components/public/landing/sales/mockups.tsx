/**
 * Mockups del producto MediFlow construidos en CSS/SVG (no capturas).
 * Fieles a las pantallas reales del panel: colores, layout y datos de
 * ejemplo realistas. Son presentacionales (sin hooks) → se pueden usar
 * tanto dentro del window interactivo del hero como en los spotlights
 * (server components).
 */
import {
  Home, CalendarDays, Users, Inbox, FileImage, CreditCard, Plus,
  Video, MessageCircle, Sparkles, Scan, TrendingUp, Clock,
  FileCheck2, Armchair, Monitor, Sofa, FlaskConical, Building2, Stethoscope,
} from "lucide-react";

/* ── Sidebar compartido del fake-panel ─────────────────────────────────── */
function MiniSidebar({ active }: { active: string }) {
  const items = [
    { k: "hoy", label: "Hoy", icon: Home },
    { k: "agenda", label: "Agenda", icon: CalendarDays },
    { k: "pacientes", label: "Pacientes", icon: Users },
    { k: "inbox", label: "Inbox", icon: Inbox, count: "5" },
    { k: "xrays", label: "Radiografías", icon: FileImage },
    { k: "billing", label: "Facturación", icon: CreditCard },
    { k: "clinic", label: "Mi Clínica", icon: Building2 },
  ];
  return (
    <aside className="mk__side" aria-hidden="true">
      <div className="mk__brand">
        <span className="mk__logo"><Stethoscope /></span>
        <div>
          <div className="mk__brandname">Clínica Sonrisa</div>
          <div className="mk__brandsub">Plan Pro</div>
        </div>
      </div>
      <div className="mk__sec">Workspace</div>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={it.k} className={`mk__nav${active === it.k ? " mk__nav--active" : ""}`}>
            <Icon /> <span>{it.label}</span>
            {it.count ? <span className="mk__count">{it.count}</span> : null}
          </div>
        );
      })}
    </aside>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   1 · AGENDA (Google Calendar + WhatsApp)
   ════════════════════════════════════════════════════════════════════════ */
type ApptData = { variant: "info" | "ok" | "warn" | "brand"; time: string; name: string; reason: string; live?: boolean; tele?: boolean };

export function AgendaMock() {
  const times = ["09:00", "10:00", "11:00", "12:00"];
  // Citas indexadas por "fila-columna" (3 columnas de día).
  const appts: Record<string, ApptData> = {
    "0-0": { variant: "info", time: "09:00", name: "María García", reason: "Limpieza dental" },
    "0-2": { variant: "brand", time: "09:30", name: "Diego Morales", reason: "Profilaxis" },
    "1-1": { variant: "ok", time: "10:00", name: "Carlos López", reason: "Restauración", live: true },
    "2-0": { variant: "warn", time: "11:00", name: "Ana Martínez", reason: "Consulta" },
    "2-2": { variant: "info", time: "11:30", name: "Sofía Hernández", reason: "Blanqueo" },
    "3-1": { variant: "brand", time: "12:00", name: "Pedro Sánchez", reason: "Corona", tele: true },
  };
  return (
    <div className="mk">
      <MiniSidebar active="agenda" />
      <div className="mk__main">
        <div className="mk__top">
          <div>
            <div className="mk__crumb">Agenda</div>
            <div className="mk__sub">Lun 8 — Mié 10 de junio</div>
          </div>
          <span className="mk__badge mk__badge--ok" style={{ marginLeft: "auto" }}><CalendarDays size={11} /> Google Calendar</span>
          <span className="mk__badge mk__badge--info"><MessageCircle size={11} /> WhatsApp</span>
        </div>
        <div className="mk__body" style={{ paddingTop: 12 }}>
          <div className="mk__panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mk-ag">
              <div className="mk-ag__h" />
              <div className="mk-ag__h">Lun<small>8 jun</small></div>
              <div className="mk-ag__h">Mar<small>9 jun</small></div>
              <div className="mk-ag__h">Mié<small>10 jun</small></div>

              {times.map((t, row) => (
                <ToothFragment key={t}>
                  <div className="mk-ag__time">{t}</div>
                  {[0, 1, 2].map((col) => {
                    const a = appts[`${row}-${col}`];
                    return (
                      <div key={col} className="mk-ag__cell">
                        {a && <Appt {...a} />}
                      </div>
                    );
                  })}
                </ToothFragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Fragmento con key (React necesita key estable al mapear filas del grid).
function ToothFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Appt({ variant, time, name, reason, live, tele }: ApptData) {
  return (
    <div className={`mk-appt mk-appt--${variant}`}>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <time>{time}</time>
        {live && <em style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669", display: "inline-block" }} />}
        {tele && <Video size={10} style={{ color: "#7c3aed" }} />}
      </span>
      <b>{name}</b>
      <span>{reason}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2 · EXPEDIENTE + ODONTOGRAMA
   ════════════════════════════════════════════════════════════════════════ */
type ToothState = "sano" | "caries" | "resina" | "corona" | "endo" | "implante" | "ausente";
const STATE_COLOR: Record<Exclude<ToothState, "sano" | "ausente">, string> = {
  caries: "#dc2626", resina: "#3b82f6", corona: "#d97706", endo: "#7c3aed", implante: "#059669",
};

const TOOTH_D =
  "M6 11 C5 7 4.5 5 7 4 C9 3.2 10.5 4.5 12 4.5 C13.5 4.5 15 3.2 17 4 C19.5 5 19 7 18 11 C17.4 16 16.5 21 15 25 C14.4 26.5 13.2 26.5 12.6 25 C12 23 11.4 20.5 12 20.5 C12.6 20.5 12 23 11.4 25 C10.8 26.5 9.6 26.5 9 25 C7.5 21 6.6 16 6 11 Z";

function MiniTooth({ state }: { state: ToothState }) {
  if (state === "ausente") {
    return (
      <svg className="mk-tooth__svg" viewBox="0 0 24 30" fill="none">
        <path d="M7 7 L17 23 M17 7 L7 23" stroke="#cbd5e1" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "sano") {
    return (
      <svg className="mk-tooth__svg" viewBox="0 0 24 30" fill="none">
        <path d={TOOTH_D} fill="#ffffff" stroke="#94a3b8" strokeWidth="1.5" />
      </svg>
    );
  }
  // state ∈ caries | resina | corona | endo | implante → clave válida de STATE_COLOR
  const color = STATE_COLOR[state];
  return (
    <svg className="mk-tooth__svg" viewBox="0 0 24 30" fill="none">
      <path d={TOOTH_D} fill={`${color}1f`} stroke={color} strokeWidth="1.5" />
      {(state === "caries" || state === "resina") && <circle cx="12" cy="13" r="3.4" fill={color} />}
      {state === "corona" && <path d={TOOTH_D} fill="none" stroke={color} strokeWidth="2.6" />}
      {state === "endo" && <path d="M12 9 L12 21" stroke={color} strokeWidth="2" strokeLinecap="round" />}
      {state === "implante" && <rect x="9.4" y="10" width="5.2" height="5.2" rx="1" fill={color} />}
    </svg>
  );
}

export function ExpedienteMock() {
  const upper: { n: string; s: ToothState }[] = [
    { n: "16", s: "caries" }, { n: "15", s: "sano" }, { n: "14", s: "resina" }, { n: "13", s: "sano" },
    { n: "12", s: "sano" }, { n: "11", s: "corona" }, { n: "21", s: "sano" }, { n: "22", s: "sano" },
  ];
  const lower: { n: string; s: ToothState }[] = [
    { n: "46", s: "endo" }, { n: "45", s: "sano" }, { n: "44", s: "implante" }, { n: "43", s: "sano" },
    { n: "42", s: "sano" }, { n: "41", s: "sano" }, { n: "31", s: "ausente" }, { n: "32", s: "sano" },
  ];
  return (
    <div className="mk">
      <MiniSidebar active="pacientes" />
      <div className="mk__main">
        <div className="mk__top">
          <span className="mk__avatar">AR</span>
          <div>
            <div className="mk__crumb">Ana Rodríguez</div>
            <div className="mk__sub">34 años · Exp. #1042 · Última visita: 28 may</div>
          </div>
          <span className="mk__badge mk__badge--brand" style={{ marginLeft: "auto" }}>Odontograma</span>
        </div>
        <div className="mk__body">
          <div className="mk__panel">
            <div className="mk__panelhead">
              <span className="mk__panelt">Odontograma</span>
              <span className="mk__sub" style={{ marginLeft: "auto" }}>Notación FDI · Permanente</span>
            </div>
            <div style={{ padding: "14px 12px" }}>
              <div className="mk-odo">
                <div className="mk-odo__arch">
                  {upper.map((t) => (
                    <div key={t.n} className="mk-tooth"><MiniTooth state={t.s} /><span className="mk-tooth__n">{t.n}</span></div>
                  ))}
                </div>
                <div className="mk-odo__arch">
                  {lower.map((t) => (
                    <div key={t.n} className="mk-tooth"><span className="mk-tooth__n">{t.n}</span><MiniTooth state={t.s} /></div>
                  ))}
                </div>
                <div className="mk-odo__legend">
                  <span className="mk-leg"><i style={{ background: "#dc2626" }} />Caries</span>
                  <span className="mk-leg"><i style={{ background: "#3b82f6" }} />Resina</span>
                  <span className="mk-leg"><i style={{ background: "#d97706" }} />Corona</span>
                  <span className="mk-leg"><i style={{ background: "#7c3aed" }} />Conducto</span>
                  <span className="mk-leg"><i style={{ background: "#059669" }} />Sellante</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   3 · RADIOGRAFÍAS CON IA
   ════════════════════════════════════════════════════════════════════════ */
export function XrayMock() {
  return (
    <div className="mk">
      <MiniSidebar active="xrays" />
      <div className="mk__main">
        <div className="mk__top">
          <div>
            <div className="mk__crumb">Radiografías</div>
            <div className="mk__sub">Ana Rodríguez · Periapical #26</div>
          </div>
          <span className="mk__badge mk__badge--brand" style={{ marginLeft: "auto" }}><Sparkles size={11} /> Analizado con IA</span>
        </div>
        <div className="mk__body">
          <div className="mk-xray">
            <div className="mk-xray__stage">
              <div className="mk-xray__plate" />
              {/* piezas tenues */}
              <div className="mk-xray__tooth" style={{ left: "16%", top: "30%", width: "16%", height: "46%" }} />
              <div className="mk-xray__tooth" style={{ left: "34%", top: "26%", width: "17%", height: "52%" }} />
              <div className="mk-xray__tooth" style={{ left: "54%", top: "30%", width: "16%", height: "46%" }} />
              <div className="mk-xray__tooth" style={{ left: "71%", top: "33%", width: "15%", height: "42%" }} />
              <span className="mk-xray__label"><Scan /> Periapical · 1024×768</span>
              {/* hallazgos IA */}
              <span className="mk-find mk-find--alta" data-l="Caries · 94%" style={{ left: "37%", top: "40%", width: "12%", height: "16%" }} />
              <span className="mk-find mk-find--media" data-l="Pérdida ósea" style={{ left: "55%", top: "58%", width: "20%", height: "15%" }} />
              <span className="mk-find mk-find--baja" data-l="Raíz residual" style={{ left: "73%", top: "44%", width: "12%", height: "20%" }} />
            </div>
            <div className="mk-xray__panel">
              <div className="mk-xray__ptitle"><Sparkles /> Hallazgos IA</div>
              <FindItem color="#ef4444" t="Caries oclusal #16" sev="Alta" pct="94%" />
              <FindItem color="#f59e0b" t="Pérdida ósea localizada" sev="Media" pct="88%" />
              <FindItem color="#06b6d4" t="Raíz residual #11" sev="Baja" pct="76%" />
              <FindItem color="#10b981" t="Calidad ósea normal" sev="Info" pct="—" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindItem({ color, t, sev, pct }: { color: string; t: string; sev: string; pct: string }) {
  return (
    <div className="mk-fitem">
      <span className="mk-fitem__bar" style={{ background: color }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mk-fitem__t">{t}</div>
        <div className="mk-fitem__m">
          <span style={{ color, fontWeight: 700 }}>{sev}</span>
          <span className="mk-fitem__pct" style={{ color }}>{pct}</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   4 · FACTURACIÓN CFDI 4.0
   ════════════════════════════════════════════════════════════════════════ */
export function BillingMock() {
  return (
    <div className="mk">
      <MiniSidebar active="billing" />
      <div className="mk__main">
        <div className="mk__top">
          <div>
            <div className="mk__crumb">Facturación</div>
            <div className="mk__sub">CFDI 4.0 · junio 2026</div>
          </div>
          <span className="mk__badge mk__badge--brand" style={{ marginLeft: "auto" }}><Plus size={11} /> Nueva factura</span>
        </div>
        <div className="mk__body">
          <div className="mk-kpis">
            <div className="mk-kpi">
              <div className="mk-kpi__l" style={{ color: "#047857" }}><TrendingUp /> Cobrado</div>
              <div className="mk-kpi__v">$128,450</div>
            </div>
            <div className="mk-kpi">
              <div className="mk-kpi__l" style={{ color: "#b45309" }}><Clock /> Por cobrar</div>
              <div className="mk-kpi__v">$24,800</div>
            </div>
            <div className="mk-kpi">
              <div className="mk-kpi__l" style={{ color: "#7c3aed" }}><FileCheck2 /> Timbradas</div>
              <div className="mk-kpi__v">86</div>
            </div>
          </div>
          <div className="mk__panel">
            <table className="mk-tbl">
              <thead>
                <tr><th>Folio</th><th>Paciente</th><th>Total</th><th>CFDI</th><th>Estado</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">FAC-2026-0042</td><td>María López</td><td className="amt">$3,480</td>
                  <td className="mono">A1B2…9F</td><td><span className="mk__badge mk__badge--ok"><i />Timbrada</span></td>
                </tr>
                <tr>
                  <td className="mono">FAC-2026-0041</td><td>Carlos Méndez</td><td className="amt">$1,250</td>
                  <td className="mono">—</td><td><span className="mk__badge mk__badge--warn"><i />Pendiente</span></td>
                </tr>
                <tr>
                  <td className="mono">FAC-2026-0040</td><td>Gabriela Torres</td><td className="amt">$5,900</td>
                  <td className="mono">7C4D…2A</td><td><span className="mk__badge mk__badge--ok"><i />Timbrada</span></td>
                </tr>
                <tr>
                  <td className="mono">FAC-2026-0039</td><td>Javier Ruiz</td><td className="amt">$880</td>
                  <td className="mono">5E1F…8B</td><td><span className="mk__badge mk__badge--ok"><i />Timbrada</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   5 · MI CLÍNICA VISUAL (2.5D)
   ════════════════════════════════════════════════════════════════════════ */
export function ClinicMock() {
  const rooms = [
    { type: "chair", icon: Armchair, tag: "Consultorio 1" },
    { type: "chair", icon: Armchair, tag: "Consultorio 2" },
    { type: "steri", icon: FlaskConical, tag: "Esterilización" },
    { type: "wait", icon: Sofa, tag: "Sala de espera" },
    { type: "desk", icon: Monitor, tag: "Recepción" },
    { type: "chair", icon: Armchair, tag: "Consultorio 3" },
  ];
  return (
    <div className="mk">
      <MiniSidebar active="clinic" />
      <div className="mk__main">
        <div className="mk__top">
          <div>
            <div className="mk__crumb">Mi Clínica Visual</div>
            <div className="mk__sub">Editor 2.5D · planta baja</div>
          </div>
          <span className="mk__badge mk__badge--neutral" style={{ marginLeft: "auto" }}>Edición</span>
        </div>
        <div className="mk__body">
          <div className="mk-floor">
            <div className="mk-floor__grid" />
            <span className="mk-floor__live"><i /> En vivo</span>
            <div className="mk-iso">
              <div className="mk-iso__plane">
                {rooms.map((r, i) => {
                  const Icon = r.icon;
                  return (
                    <div key={i} className={`mk-room mk-room--${r.type}`}>
                      <Icon />
                      <span className="mk-room__tag">{r.tag}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mk-floor__legend">
              <span className="mk-floor__pill"><i style={{ background: "#4a78a8" }} />Consultorio</span>
              <span className="mk-floor__pill"><i style={{ background: "#8c4a1e" }} />Recepción</span>
              <span className="mk-floor__pill"><i style={{ background: "#5b8f72" }} />Sala de espera</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Mini WhatsApp (secundario del spotlight de agenda) ────────────────── */
export function WhatsAppMini() {
  return (
    <div className="mk-chat" style={{ background: "#efeae2", borderRadius: 14, border: "1px solid var(--line2)" }}>
      <div className="mk-bubble mk-bubble--out">
        Hola Ana 👋 Te recordamos tu cita en Clínica Sonrisa el <b>jueves 12 a las 10:00</b>.
        <small>10:02 ✓✓</small>
      </div>
      <div className="mk-bubble mk-bubble--out">
        Responde <b>CONFIRMAR</b> o <b>REAGENDAR</b>.
        <small>10:02 ✓✓</small>
      </div>
      <div className="mk-bubble mk-bubble--in">
        Confirmar ✅
        <small>10:14</small>
      </div>
    </div>
  );
}
