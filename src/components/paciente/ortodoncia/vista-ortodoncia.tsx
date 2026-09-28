"use client";

// Portal del paciente — «Tu ortodoncia», la VISTA (ws1-t5, ronda 6).
//
// Solo pinta lo que recibe. Los datos los trae la página
// (`/paciente/(panel)/ortodoncia/page.tsx`) y lo que ESCRIBE —el registro
// diario y el envío de la foto— llega por `acciones`, así la vista se puede
// probar y ver con datos inventados sin sesión de paciente ni base.
//
// Qué se enseña lo decide el servidor (`/api/paciente/ortodoncia` +
// `lib/patient-portal/ortodoncia-portal.ts`): de quién es cada caso (93), el
// avance, las indicaciones del último control y el calendario de
// mensualidades (94), a quién se le pregunta por elásticos o alineadores
// (95) y qué casos son de solo lectura (fila 16 del mapa).
//
// Estilo: el del portal (oscuro, estilos en línea, `components/paciente/ui.tsx`).

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PacienteCard, PacienteEmptyState, formatMxn } from "@/components/paciente/ui";
import { fechaConHoraEnClinica, fechaSinHora } from "@/lib/patient-portal/ortodoncia-portal";
import { CameraGuideOverlay } from "@/components/clinical-shared/photos/CameraGuideOverlay";
import type { PacienteOrtodonciaCase } from "@/app/api/paciente/ortodoncia/route";

/** Resultado de una escritura del portal: o salió bien, o trae el mensaje para el paciente. */
export type ResultadoPortal = { ok: true } | { ok: false; error: string };

export interface AccionesOrtodonciaPortal {
  /** Marca el día de hoy. El día lo decide el servidor con la hora de la clínica. */
  registrarUso: (args: {
    treatmentPlanId: string;
    usedElastics: boolean;
    wornHours: number | null;
  }) => Promise<ResultadoPortal>;
  /** Sube la foto y la deja pendiente de revisión en la clínica. */
  enviarFoto: (args: {
    treatmentPlanId: string;
    file: File;
    angle: AnguloDeFoto;
    note: string;
  }) => Promise<ResultadoPortal>;
}

export type AnguloDeFoto = "FRONTAL" | "LATERAL" | "SMILE" | "INTRAORAL";

// La paleta del PORTAL (oscuro, la misma de `components/paciente/ui.tsx` y de
// las demás páginas del paciente), nombrada una sola vez aquí. El portal no
// cuelga de los tokens del panel de la clínica: tiene los suyos.
const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.6)";
const LINEA = "rgba(255,255,255,0.08)";
const BORDE = "rgba(255,255,255,0.14)";
const FONDO_CAMPO = "rgba(255,255,255,0.05)";
const MARCA = "#7c3aed";
const MARCA_CLARA = "#a78bfa";
const BIEN = "#34d399";
const AVISO = "#fbbf24";
const MAL = "#f87171";

// Botones de 44 px de alto: el portal se usa sobre todo desde el teléfono.
const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  background: MARCA,
  color: "#fff",
  border: "1px solid transparent",
  borderRadius: 10,
  padding: "0 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  ...primaryBtn,
  background: "rgba(255,255,255,0.06)",
  color: TEXT,
  border: `1px solid ${BORDE}`,
};

// 16 px en los campos: con menos, iOS hace zoom al enfocarlos.
const campo: CSSProperties = {
  minHeight: 44,
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${BORDE}`,
  background: FONDO_CAMPO,
  color: TEXT,
  fontSize: 16,
  fontFamily: "inherit",
};

const rotulo: CSSProperties = { margin: "0 0 4px", color: MUTED, fontSize: 13 };
const titulo: CSSProperties = { margin: "0 0 8px", color: TEXT, fontSize: 15, fontWeight: 600 };
const cifra: CSSProperties = { fontVariantNumeric: "tabular-nums" };

// El campo de archivo se esconde a la vista pero NO al teclado ni al lector
// de pantalla (con `display: none` no se podía llegar a él con Tab).
const soloLector: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Foco de teclado visible: no se puede declarar con estilos en línea. */
const CSS_FOCO = `
.orto-portal :is(button, a, input, textarea, summary):focus-visible { outline: 2px solid ${MARCA_CLARA}; outline-offset: 2px; }
.orto-portal label:focus-within { outline: 2px solid ${MARCA_CLARA}; outline-offset: 2px; }
.orto-portal button:disabled { opacity: 0.55; cursor: progress; }
.orto-portal-bloque + .orto-portal-bloque { padding-top: 18px; border-top: 1px solid ${LINEA}; }
@keyframes orthoPortalPulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }
@media (prefers-reduced-motion: reduce) { .orto-portal * { animation: none !important; } }
`;

/** Todos los casos de la cuenta, uno por tarjeta. */
export function VistaOrtodoncia({
  cases,
  onSaved,
  acciones,
}: {
  cases: PacienteOrtodonciaCase[];
  onSaved: () => void;
  acciones: AccionesOrtodonciaPortal;
}) {
  if (cases.length === 0) {
    return (
      <MarcoOrtodoncia>
        <PacienteCard>
          <PacienteEmptyState message="Todavía no tienes un caso de ortodoncia." />
        </PacienteCard>
      </MarcoOrtodoncia>
    );
  }
  return (
    <MarcoOrtodoncia>
      {cases.map((c) => (
        <CaseSection key={c.treatmentPlanId} caseData={c} onSaved={onSaved} acciones={acciones} />
      ))}
    </MarcoOrtodoncia>
  );
}

/** No cargó: se dice y se ofrece reintentar. */
export function ErrorOrtodoncia({ onReintentar }: { onReintentar: () => void }) {
  return (
    <MarcoOrtodoncia>
      <PacienteCard>
        <div style={{ textAlign: "center", padding: "24px 8px" }} role="alert">
          <p style={{ color: MUTED, margin: "0 0 14px", fontSize: 14 }}>
            No pudimos cargar tu ortodoncia. Revisa tu conexión e intenta de nuevo.
          </p>
          <button type="button" onClick={onReintentar} style={primaryBtn}>
            Reintentar
          </button>
        </div>
      </PacienteCard>
    </MarcoOrtodoncia>
  );
}

function CaseSection({
  caseData,
  onSaved,
  acciones,
}: {
  caseData: PacienteOrtodonciaCase;
  onSaved: () => void;
  acciones: AccionesOrtodonciaPortal;
}) {
  const c = caseData;
  // Con dos hijos en la misma cuenta, el nombre va primero: es lo que distingue una tarjeta de otra.
  const tituloTarjeta = c.mostrarNombre ? `${c.patientName} · ${c.clinicName}` : c.clinicName;
  const hayCumplimiento = c.compliance.compliancePct !== null;

  return (
    <PacienteCard title={tituloTarjeta}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Avance estado={c.estado} avance={c.avance} />

        {c.soloLectura && c.avisoSoloLectura ? (
          <p
            role="note"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${LINEA}`,
              color: MUTED,
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {c.avisoSoloLectura}
          </p>
        ) : null}

        <MensualidadYControl cobranza={c.cobranza} proximoControl={c.proximoControl} zonaHoraria={c.timezone} />

        {/* Lo que el paciente hace a diario va primero: marcar el día. Solo
            se le pregunta a quien lleva elásticos o alineadores. */}
        {c.registro.preguntar ? (
          <div className="orto-portal-bloque">
            <ElasticsCheckin
              treatmentPlanId={c.treatmentPlanId}
              pregunta={c.registro.pregunta}
              todayLogged={c.todayLogged}
              onSaved={onSaved}
              registrarUso={acciones.registrarUso}
            />
          </div>
        ) : null}

        {c.ultimoControl ? (
          <div className="orto-portal-bloque">
            <Indicaciones control={c.ultimoControl} />
          </div>
        ) : null}

        {c.aligner || hayCumplimiento ? (
          <div
            className="orto-portal-bloque"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}
          >
            {c.aligner ? (
              <div>
                <p style={rotulo}>Tu alineador</p>
                <p style={{ margin: 0, color: TEXT, fontSize: 22, fontWeight: 700, ...cifra }}>
                  {c.aligner.currentTray}{" "}
                  <span style={{ fontSize: 14, color: MUTED, fontWeight: 400 }}>de {c.aligner.totalTrays}</span>
                </p>
              </div>
            ) : null}
            {hayCumplimiento ? (
              <div>
                <p style={rotulo}>Cumplimiento, últimos {c.compliance.windowDays} días</p>
                <p style={{ margin: 0, color: c.compliance.isLow ? AVISO : BIEN, fontSize: 22, fontWeight: 700, ...cifra }}>
                  {c.compliance.compliancePct}%
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {c.calendario.length > 0 ? (
          <div className="orto-portal-bloque">
            <Calendario mensualidades={c.calendario} />
          </div>
        ) : null}

        {c.soloLectura ? null : (
          <div className="orto-portal-bloque">
            <MonitoringUpload treatmentPlanId={c.treatmentPlanId} enviarFoto={acciones.enviarFoto} />
          </div>
        )}
      </div>
    </PacienteCard>
  );
}

/** «En tratamiento · Mes 2 de 18 · Alineación», con su barra. */
function Avance({ estado, avance }: { estado: string; avance: PacienteOrtodonciaCase["avance"] }) {
  return (
    <div>
      <p style={{ margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 999,
            color: MARCA_CLARA,
            background: "rgba(124,58,237,0.18)",
            whiteSpace: "nowrap",
          }}
        >
          {estado}
        </span>
        <span style={{ color: TEXT, fontSize: 15, fontWeight: 600, ...cifra }}>{avance.texto}</span>
      </p>
      {avance.porcentaje !== null ? (
        <div
          role="progressbar"
          aria-label="Avance de tu tratamiento"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={avance.porcentaje}
          aria-valuetext={avance.texto}
          style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}
        >
          <div style={{ width: `${avance.porcentaje}%`, height: "100%", borderRadius: 999, background: MARCA_CLARA }} />
        </div>
      ) : null}
    </div>
  );
}

/** Lo que la doctora le dejó dicho al paciente en su último control. Nunca la nota clínica. */
function Indicaciones({ control }: { control: NonNullable<PacienteOrtodonciaCase["ultimoControl"]> }) {
  const sinNada = !control.indicaciones && control.elasticos.length === 0;
  return (
    <div>
      <p style={titulo}>Indicaciones de tu último control</p>
      <p style={{ ...rotulo, margin: "0 0 8px" }}>Control del {fechaSinHora(control.fecha)}</p>
      {control.elasticos.length > 0 ? (
        <div style={{ margin: "0 0 10px" }}>
          <p style={rotulo}>Tus elásticos</p>
          <ul style={{ margin: 0, padding: "0 0 0 18px", color: TEXT, fontSize: 14, lineHeight: 1.5 }}>
            {control.elasticos.map((e, i) => (
              <li key={i}>{e.texto}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {control.indicaciones ? (
        <p style={{ margin: 0, color: TEXT, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {control.indicaciones}
        </p>
      ) : null}
      {sinNada ? (
        <p style={{ margin: 0, color: MUTED, fontSize: 14 }}>
          No quedaron indicaciones escritas. Si tienes dudas, escríbele a tu clínica.
        </p>
      ) : null}
    </div>
  );
}

const ESTADO_MENSUALIDAD: Record<
  PacienteOrtodonciaCase["calendario"][number]["estado"],
  { texto: string; color: string }
> = {
  pagada: { texto: "Pagada", color: BIEN },
  vencida: { texto: "Vencida", color: MAL },
  porVencer: { texto: "Por pagar", color: MUTED },
};

/** El calendario completo de mensualidades: las mismas cifras que ve recepción. */
function Calendario({ mensualidades }: { mensualidades: PacienteOrtodonciaCase["calendario"] }) {
  const pagadas = mensualidades.filter((m) => m.estado === "pagada").length;
  return (
    <details>
      <summary style={{ ...titulo, margin: 0, cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", gap: 8 }}>
        Calendario de pagos
        <span style={{ color: MUTED, fontSize: 13, fontWeight: 400, ...cifra }}>
          {pagadas} de {mensualidades.length} pagados
        </span>
      </summary>
      <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
        {mensualidades.map((m, i) => {
          const e = ESTADO_MENSUALIDAD[m.estado];
          const parcial = m.estado !== "pagada" && m.faltaMxn > 0 && m.faltaMxn < m.importeMxn;
          return (
            <li
              key={`${m.etiqueta}-${m.vencimiento ?? "sin-fecha"}-${i}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
                padding: "10px 0",
                borderTop: i === 0 ? "none" : `1px solid ${LINEA}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, color: TEXT, fontSize: 14, fontWeight: m.esLaQueSigue ? 700 : 500 }}>
                  {m.etiqueta}
                  {m.esLaQueSigue ? <span style={{ color: MARCA_CLARA, fontWeight: 600 }}> · la que sigue</span> : null}
                </p>
                <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 13, ...cifra }}>
                  {m.vencimiento ? fechaSinHora(m.vencimiento) : "Sin fecha"}
                  {parcial ? ` · faltan ${formatMxn(m.faltaMxn)}` : ""}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, color: TEXT, fontSize: 14, fontWeight: 600, ...cifra }}>{formatMxn(m.importeMxn)}</p>
                <p style={{ margin: "2px 0 0", color: e.color, fontSize: 12.5, fontWeight: 600 }}>{e.texto}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * ws1-t2 (W4) — resumen de mensualidades (de la factura real del
 * tratamiento) y próximo control (Agenda). `cobranza === null` = todavía sin
 * factura de tratamiento abierta: no hay nada que cobrar, se omite el
 * bloque entero en vez de enseñar ceros que confundirían al paciente.
 */
function MensualidadYControl({
  cobranza,
  proximoControl,
  zonaHoraria,
}: {
  cobranza: PacienteOrtodonciaCase["cobranza"];
  proximoControl: string | null;
  zonaHoraria: string;
}) {
  if (!cobranza && !proximoControl) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${LINEA}`,
      }}
    >
      {cobranza && (
        <div>
          <p style={{ ...titulo, margin: "0 0 6px" }}>Tu mensualidad</p>
          {cobranza.vencidoMxn > 0 ? (
            <p style={{ margin: "0 0 4px", color: MAL, fontSize: 15, fontWeight: 700, ...cifra }}>
              Tienes {formatMxn(cobranza.vencidoMxn)} vencido
            </p>
          ) : cobranza.cuotaDeHoyMxn !== null ? (
            <p style={{ margin: "0 0 4px", color: TEXT, fontSize: 15, ...cifra }}>
              Próxima mensualidad: <strong>{formatMxn(cobranza.cuotaDeHoyMxn)}</strong>
              {cobranza.proximoVencimiento ? ` · vence el ${fechaSinHora(cobranza.proximoVencimiento)}` : ""}
            </p>
          ) : (
            <p style={{ margin: "0 0 4px", color: BIEN, fontSize: 15 }}>Vas al corriente con tus pagos.</p>
          )}
          {cobranza.saldoTotalMxn > 0 ? (
            <p style={{ margin: "0 0 10px", color: MUTED, fontSize: 13, ...cifra }}>
              Te falta por pagar de todo el tratamiento: {formatMxn(cobranza.saldoTotalMxn)}
            </p>
          ) : null}
          {(cobranza.vencidoMxn > 0 || (cobranza.cuotaDeHoyMxn ?? 0) > 0) && (
            <a href="/paciente/pagos" style={{ ...secondaryBtn, textDecoration: "none" }}>
              Ir a Tus pagos
            </a>
          )}
        </div>
      )}
      {proximoControl && (
        <div>
          <p style={{ margin: 0, color: MUTED, fontSize: 14 }}>
            Tu próximo control es el{" "}
            <strong style={{ color: TEXT }}>{fechaConHoraEnClinica(proximoControl, zonaHoraria)}</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function ElasticsCheckin({
  treatmentPlanId,
  pregunta,
  todayLogged,
  onSaved,
  registrarUso,
}: {
  treatmentPlanId: string;
  /** La pregunta exacta según lo que lleva el paciente; la decide el servidor. */
  pregunta: string;
  todayLogged: boolean;
  onSaved: () => void;
  registrarUso: AccionesOrtodonciaPortal["registrarUso"];
}) {
  const [hours, setHours] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(todayLogged);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div role="status">
        <p style={{ margin: 0, color: BIEN, fontSize: 15, fontWeight: 600 }}>✓ Ya marcaste hoy. ¡Gracias!</p>
      </div>
    );
  }

  async function submit(usedElastics: boolean) {
    setSaving(true);
    setError(null);
    // El día NO se manda: lo decide el servidor con la hora de la clínica.
    let res: ResultadoPortal;
    try {
      res = await registrarUso({ treatmentPlanId, usedElastics, wornHours: hours === "" ? null : hours });
    } catch {
      res = { ok: false, error: "No se pudo guardar tu registro. Revisa tu conexión e intenta de nuevo." };
    }
    setSaving(false);
    if (res.ok === false) {
      setError(res.error);
      return;
    }
    setDone(true);
    onSaved();
  }

  return (
    <div>
      <p style={titulo}>{pregunta}</p>
      {error ? (
        <p role="alert" style={{ color: MAL, fontSize: 14, margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}
      {/* Los dos botones primero y a todo el ancho en el teléfono: es un toque. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={saving} style={{ ...primaryBtn, flex: "1 1 130px" }} onClick={() => submit(true)}>
          Sí, hoy sí
        </button>
        <button type="button" disabled={saving} style={{ ...secondaryBtn, flex: "1 1 130px" }} onClick={() => submit(false)}>
          Hoy no
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10, color: MUTED, fontSize: 13 }}>
        ¿Cuántas horas? (opcional)
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={24}
          placeholder="Horas"
          value={hours}
          onChange={(e) => setHours(e.target.value === "" ? "" : Number(e.target.value))}
          style={{ ...campo, width: 110 }}
        />
      </label>
    </div>
  );
}

function MonitoringUpload({
  treatmentPlanId,
  enviarFoto,
}: {
  treatmentPlanId: string;
  enviarFoto: AccionesOrtodonciaPortal["enviarFoto"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [angle, setAngle] = useState<AnguloDeFoto>("FRONTAL");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function pick(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus("idle");
  }

  async function send() {
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const res = await enviarFoto({ treatmentPlanId, file, angle, note });
      if (res.ok === false) {
        setError(res.error);
        setStatus("error");
        return;
      }
      setStatus("sent");
      setFile(null);
      setPreview(null);
      setNote("");
    } catch {
      setError("No se pudo enviar la foto. Revisa tu conexión e intenta de nuevo.");
      setStatus("error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <p style={titulo}>Envía una foto de seguimiento</p>
      {status === "sent" ? (
        <p role="status" style={{ color: BIEN, fontSize: 14, margin: "0 0 8px" }}>
          ✓ Enviada. Tu clínica la revisará.
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: MAL, fontSize: 14, margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}

      <div role="group" aria-label="Ángulo de la foto" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {(["FRONTAL", "LATERAL", "SMILE", "INTRAORAL"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAngle(a)}
            aria-pressed={angle === a}
            style={{
              minHeight: 38,
              padding: "0 14px",
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              background: angle === a ? "rgba(124,58,237,0.25)" : FONDO_CAMPO,
              border: angle === a ? `1px solid ${MARCA_CLARA}` : `1px solid ${BORDE}`,
              color: angle === a ? "#fff" : "rgba(245,245,247,0.75)",
            }}
          >
            {ANGLE_LABEL[a]}
          </button>
        ))}
      </div>

      {preview ? (
        <div style={{ marginBottom: 10, maxWidth: 280 }}>
          <CameraGuideOverlay shot={ANGLE_TO_GUIDE[angle]} className="aspect-[3/4]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Vista previa" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </CameraGuideOverlay>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ ...secondaryBtn, position: "relative" }}>
          {file ? "Cambiar foto" : "Elegir foto"}
          <input
            type="file"
            accept="image/*"
            capture="user"
            style={soloLector}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />
        </label>
        {file ? (
          <button type="button" disabled={sending} style={primaryBtn} onClick={send}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        ) : null}
      </div>

      <textarea
        aria-label="Mensaje para tu doctor (opcional)"
        placeholder="¿Algo que quieras contarle a tu doctor? (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        style={{ ...campo, marginTop: 10, width: "100%", boxSizing: "border-box", resize: "vertical" }}
      />
    </div>
  );
}

const ANGLE_LABEL: Record<AnguloDeFoto, string> = {
  FRONTAL: "Frente",
  LATERAL: "Perfil",
  SMILE: "Sonrisa",
  INTRAORAL: "Intraoral",
};

const ANGLE_TO_GUIDE = {
  FRONTAL: "FRONTAL_REPOSO",
  LATERAL: "PERFIL",
  SMILE: "FRONTAL_SONRISA",
  INTRAORAL: "INTRAORAL_FRONTAL",
} as const;

/** El marco de la página: título y foco de teclado. */
export function MarcoOrtodoncia({ children }: { children: ReactNode }) {
  return (
    <div className="orto-portal" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <style>{CSS_FOCO}</style>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Tu ortodoncia</h1>
      {children}
    </div>
  );
}

export function CargandoOrtodoncia() {
  return (
    <MarcoOrtodoncia>
      <div
        role="status"
        aria-label="Cargando tu ortodoncia"
        style={{
          // Alto parecido al de la tarjeta real: al cargar no hay salto.
          height: 420,
          borderRadius: 14,
          background: "rgba(255,255,255,0.06)",
          animation: "orthoPortalPulse 1.4s ease-in-out infinite",
        }}
      />
    </MarcoOrtodoncia>
  );
}
