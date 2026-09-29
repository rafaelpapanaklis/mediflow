"use client";
// Ortodoncia — Configuración del submenú (Ola 1, ws1-t3 · «Acceso y
// permisos»). Catálogo de tipos de cita (C7,
// ÚNICO — ver clinic-settings-db.ts — que new-appointment-dialog.tsx pide a
// /api/orthodontics/context y ofrece como chips de motivo al agendar) y
// plantillas de mensaje. La entrada "Control de ortodoncia" es de solo
// lectura: la Agenda la reconoce por su texto exacto (esCitaControlOrto). Esa
// fila fija se reconoce aquí por su CLAVE (tipos-de-cita.ts), no por el texto.
//
// Diseño (ws1-t3): mismos campos, mismas validaciones y el mismo guardado.
// Cambia cómo se pinta: tarjetas del rediseño, campos con su etiqueta
// enlazada, «Quitar» como botón con nombre y el tipo fijo con su candado y
// su explicación a la vista (antes solo salía al pasar el ratón).

import { useId, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Ban, CalendarClock, ClipboardList, Lock, MessageCircle, MessageSquareText, Plus, Trash2, Wallet } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Pantalla, Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import { updateOrthoClinicSettings, listarProcedimientosDeOrtodonciaAction, sembrarProcedimientosSugeridosOrtodoncia } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type {
  OrthoAppointmentTypeOption,
  OrthoClinicSettings,
} from "@/lib/orthodontics/clinic-settings-db";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { esTipoFijo, motivoDeRechazo, nuevaClave } from "@/lib/orthodontics/tipos-de-cita";
import { ORTHO_BILLING_MODE_LABELS, type OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import type { OrthoProcedureRow } from "@/lib/orthodontics/catalog-procedures";
import { MAX_PLANTILLA, PLANTILLAS_ORTO, motivoDeRechazoDePlantillas } from "@/lib/orthodontics/plantillas-mensaje";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { mensajeDeQuitar, separarActivosYQuitados, textoConfirmarQuitar } from "@/lib/procedures/quitar-procedimiento";
import { TecnicasYPrecios } from "./TecnicasYPrecios";
import { OpcionesDelPlanDeTratamiento } from "./OpcionesDelPlanDeTratamiento";
import type { OpcionesDeLaClinica } from "@/lib/orthodontics/plan-detalle-db";
import { CondicionesDelConvenio } from "./CondicionesDelConvenio";
import type { TecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";

export interface OrthoConfiguracionClientProps {
  settings: OrthoClinicSettings;
  procedimientos: OrthoProcedureRow[];
  /** Precio del tratamiento por técnica (ws1-t10, decisión 2): lo que el alta del caso propone. */
  tecnicasDeLaClinica?: TecnicasDeLaClinica;
  /** ws1-t12: las listas del plan de tratamiento (brackets, alineadores, placas, aditamentos…) de la clínica. */
  opcionesDelPlan?: OpcionesDeLaClinica;
  /**
   * La tarjeta "Suscripción" (ws1-t2, 28-sep-2026) — `null` si no hay nada
   * que cancelar desde aquí: sin permiso (no dueño/administrador), módulo
   * activado por soporte ("admin"), pagado con SPEI/OXXO (sin suscripción
   * que cancelar), o ya cancelado. El servidor ya decidió todo esto
   * (`canRequestModuleCancellation` + `canPurchaseModules`); aquí solo se
   * pinta o no.
   */
  suscripcion: { currentPeriodEnd: string | null } | null;
}

const EXPLICACION_MODO: Record<OrthoBillingMode, string> = {
  PRECIO_TOTAL: "El caso tiene un precio total, que se paga con un enganche y mensualidades.",
  PAGO_POR_CONTROL:
    "Sin precio total: cada control atendido se cobra aparte con el precio de «Control de ortodoncia» del catálogo, y la colocación/enganche va en su propia factura.",
};

// Las plantillas, dónde se usa cada una y qué variables acepta viven en
// plantillas-mensaje.ts (ws1-t5, ronda 6): la pantalla, el guardado y los dos
// envíos leen de ahí, para que lo que aquí se promete sea lo que se manda.

export function OrthoConfiguracionClient({ settings, procedimientos: procedimientosIniciales, tecnicasDeLaClinica, opcionesDelPlan, suscripcion }: OrthoConfiguracionClientProps) {
  const [appointmentTypes, setAppointmentTypes] = useState<OrthoAppointmentTypeOption[]>(
    settings.appointmentTypes,
  );
  const [templates, setTemplates] = useState<Record<string, string>>(settings.messageTemplates);
  const [billingMode, setBillingMode] = useState<OrthoBillingMode>(settings.billingMode);
  // ws1-t1 ronda 2 — interruptor SEPARADO del de dinero (cobranza.bot, en
  // /dashboard/whatsapp): ¿el bot contesta "¿cuándo es mi próximo control?".
  const [proximoControlBotEnabled, setProximoControlBotEnabled] = useState(settings.proximoControlBotEnabled);
  const [saving, setSaving] = useState(false);
  const [procedimientos, setProcedimientos] = useState<OrthoProcedureRow[]>(procedimientosIniciales);
  const [sembrando, setSembrando] = useState(false);
  const [verQuitados, setVerQuitados] = useState(false);
  // Solo los activos van en la lista; los quitados (archivados) esperan tras «Ver quitados».
  const { activos, quitados } = separarActivosYQuitados(procedimientos);

  const controlDelCatalogo = activos.find((p) => p.name === TIPO_CITA_CONTROL_ORTO) ?? procedimientos.find((p) => p.name === TIPO_CITA_CONTROL_ORTO);
  const controlTienePrecio = Boolean(controlDelCatalogo?.isActive && controlDelCatalogo.basePrice > 0);

  async function cargarSugeridos() {
    setSembrando(true);
    try {
      const res = await sembrarProcedimientosSugeridosOrtodoncia();
      if (isFailure(res)) {
        toast.error(res.error);
        return;
      }
      setProcedimientos(res.data.procedimientos);
      toast.success(
        res.data.creados > 0
          ? `${res.data.creados} procedimientos sugeridos agregados — ajusta precios y "incluido/con costo" abajo.`
          : "El catálogo de ortodoncia ya tenía procedimientos.",
      );
    } finally {
      setSembrando(false);
    }
  }

  async function recargarProcedimientos() {
    const res = await listarProcedimientosDeOrtodonciaAction();
    if (!isFailure(res)) setProcedimientos(res.data.procedimientos);
  }

  function actualizarTipo(id: string, campo: "id" | "label", valor: string) {
    setAppointmentTypes((arr) => arr.map((t) => (t.id === id ? { ...t, [campo]: valor } : t)));
  }

  /** ws1-t1 ronda 2 — texto libre del campo de minutos: vacío = "sin valor
   * propio" (cae al mejor esfuerzo al agendar), nunca 0 ni negativo. */
  function actualizarDuracion(id: string, texto: string) {
    const limpio = texto.trim();
    const numero = limpio === "" ? null : Number(limpio);
    setAppointmentTypes((arr) =>
      arr.map((t) => (t.id === id ? { ...t, durationMin: numero != null && Number.isFinite(numero) && numero > 0 ? Math.round(numero) : null } : t)),
    );
  }

  function quitarTipo(id: string) {
    const tipo = appointmentTypes.find((t) => t.id === id);
    if (tipo && esTipoFijo(tipo)) {
      toast.error(`No se puede quitar "${TIPO_CITA_CONTROL_ORTO}" — la Agenda lo usa para reconocer los controles.`);
      return;
    }
    setAppointmentTypes((arr) => arr.filter((t) => t.id !== id));
  }

  function agregarTipo() {
    setAppointmentTypes((arr) => [...arr, { id: nuevaClave(arr), label: "" }]);
  }

  async function guardar() {
    // La misma regla que aplica el servidor (tipos-de-cita.ts): vacío, sin
    // nombre, sin la fila fija o con dos tipos que se llaman igual.
    const rechazo = motivoDeRechazo(appointmentTypes);
    if (rechazo) {
      toast.error(rechazo);
      return;
    }
    // Una variable mal escrita le llegaría al paciente con todo y llaves.
    const rechazoPlantilla = motivoDeRechazoDePlantillas(templates);
    if (rechazoPlantilla) {
      toast.error(rechazoPlantilla);
      return;
    }
    setSaving(true);
    try {
      const res = await updateOrthoClinicSettings({
        appointmentTypes,
        messageTemplates: templates,
        billingMode,
        proximoControlBotEnabled,
      });
      if (isFailure(res)) {
        toast.error(res.error);
        return;
      }
      toast.success("Configuración de Ortodoncia guardada.");
    } finally {
      setSaving(false);
    }
  }

  // Suscripción del módulo (ws1-t2, 28-sep-2026) — "Cancelar módulo".
  const [cancelando, setCancelando] = useState(false);
  const [cancelado, setCancelado] = useState(false);

  async function cancelarModulo() {
    const fecha = suscripcion?.currentPeriodEnd
      ? new Date(suscripcion.currentPeriodEnd).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
      : "el fin del periodo ya pagado";
    const confirmado = window.confirm(
      `¿Cancelar el módulo de Ortodoncia?\n\nSeguirá activo hasta el ${fecha} (ya está pagado). ` +
        "Después de esa fecha ya no se cobrará, y el menú vuelve a pedir contratarlo. " +
        "Los pacientes, casos y todo lo que ya se guardó NO se borran.",
    );
    if (!confirmado) return;
    setCancelando(true);
    try {
      const res = await fetch("/api/marketplace/module-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey: "orthodontics" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo cancelar. Intenta de nuevo.");
        return;
      }
      setCancelado(true);
      toast.success(data?.message ?? "El módulo se cancelará al final del periodo ya pagado.");
    } catch (err) {
      toast.error("No se pudo cancelar. Intenta de nuevo.");
      console.error("[ortho.configuracion.cancelarModulo]", err);
    } finally {
      setCancelando(false);
    }
  }

  const idPlantilla = useId();

  return (
    <Pantalla
      titulo="Configuración"
      sub="Lo que el módulo de Ortodoncia usa por defecto en esta clínica."
      acciones={
        <ButtonNew type="button" variant="primary" onClick={guardar} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </ButtonNew>
      }
    >
      <div className={s.formulario}>
        <div className={s.formularioColumna}>
          <Tarjeta
            icono={Wallet}
            titulo="Modo de cobro"
            sub="Cómo se cobra el tratamiento. Es el modo que se propone al abrir un caso nuevo. Un caso ya abierto conserva el modo con el que se abrió."
          >
            <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(Object.keys(ORTHO_BILLING_MODE_LABELS) as OrthoBillingMode[]).map((modo) => {
                const activo = billingMode === modo;
                return (
                  <label
                    key={modo}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "11px 13px",
                      border: `1px solid ${activo ? "var(--pr-activo)" : "var(--pr-borde)"}`,
                      borderRadius: "var(--pr-radio-s)",
                      background: activo ? "var(--pr-activo-suave)" : "var(--pr-tarjeta-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="billingMode"
                      value={modo}
                      checked={activo}
                      onChange={() => setBillingMode(modo)}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--pr-texto)" }}>
                        {ORTHO_BILLING_MODE_LABELS[modo]}
                      </span>
                      <span style={{ display: "block", fontSize: 12, lineHeight: 1.45, color: "var(--pr-texto-3)", marginTop: 2 }}>
                        {EXPLICACION_MODO[modo]}
                      </span>
                    </span>
                  </label>
                );
              })}
              {billingMode === "PAGO_POR_CONTROL" && !controlTienePrecio ? (
                <div
                  role="alert"
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: "var(--pr-radio-s)",
                    background: "var(--pr-alerta-suave)",
                    color: "var(--pr-alerta)",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                  <span>
                    El catálogo no tiene «{TIPO_CITA_CONTROL_ORTO}» activo con precio — los controles no se facturarán
                    solos hasta que lo agregues en «Procedimientos de ortodoncia», abajo.
                  </span>
                </div>
              ) : null}
            </div>
          </Tarjeta>

          <TecnicasYPrecios iniciales={tecnicasDeLaClinica} />

          <OpcionesDelPlanDeTratamiento iniciales={opcionesDelPlan} />

          <Tarjeta
            icono={CalendarClock}
            titulo="Tipos de cita de Ortodoncia"
            sub="Estos textos son los que aparecen como chips de motivo al agendar una cita en la Agenda, cuando el módulo de Ortodoncia está activo — un solo catálogo, editable aquí."
          >
            <div className={s.tarjetaCuerpo}>
              <ul className={s.tipos}>
                {appointmentTypes.map((tipo, i) => {
                  // La fila fija se reconoce por su CLAVE: teclear su mismo
                  // texto en un tipo nuevo ya no lo bloquea a media escritura.
                  const esControl = esTipoFijo(tipo);
                  return (
                    <li key={tipo.id} className={s.tipo}>
                      <input
                        type="text"
                        className={s.campoEntrada}
                        value={tipo.label}
                        placeholder="Nombre visible"
                        aria-label={`Tipo de cita ${i + 1}`}
                        onChange={(e) => actualizarTipo(tipo.id, "label", e.target.value)}
                        disabled={esControl}
                        title={esControl ? "La Agenda reconoce los controles por este texto exacto — no se puede editar." : undefined}
                      />
                      <input
                        type="number"
                        min={1}
                        step={5}
                        className={s.campoEntrada}
                        value={tipo.durationMin ?? ""}
                        placeholder="min"
                        aria-label={`Duración en minutos de ${tipo.label.trim() || `el tipo de cita ${i + 1}`}`}
                        title="Minutos de esta cita. En blanco = se calcula solo al agendar."
                        onChange={(e) => actualizarDuracion(tipo.id, e.target.value)}
                        style={{ maxWidth: 68, flex: "0 0 68px" }}
                      />
                      {esControl ? (
                        <span className={s.candado} title="Fijo: la Agenda lo usa para reconocer los controles.">
                          <Lock size={15} strokeWidth={1.9} aria-hidden />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => quitarTipo(tipo.id)}
                          className={s.botonIcono}
                          aria-label={`Quitar ${tipo.label.trim() || `el tipo de cita ${i + 1}`}`}
                          title="Quitar"
                        >
                          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className={s.pie}>
                «{TIPO_CITA_CONTROL_ORTO}» es fijo: la Agenda reconoce los controles por ese texto exacto. La
                duración es la que usan el bot de WhatsApp y la reserva pública al agendar; en blanco, se calcula
                sola.
              </p>
              <div style={{ marginTop: 12 }}>
                <ButtonNew
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={15} strokeWidth={1.9} aria-hidden />}
                  onClick={agregarTipo}
                >
                  Agregar tipo de cita
                </ButtonNew>
              </div>
            </div>
          </Tarjeta>
        </div>

        <Tarjeta
          icono={MessageSquareText}
          titulo="Plantillas de mensaje"
          sub="Tu redacción de los dos mensajes de Ortodoncia. Si dejas uno vacío, sale el texto de siempre."
        >
          <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {PLANTILLAS_ORTO.map((p) => (
              <div className={s.campo} key={p.clave}>
                <label className={s.campoEtiqueta} htmlFor={`${idPlantilla}-${p.clave}`}>
                  {p.etiqueta}
                </label>
                <textarea
                  id={`${idPlantilla}-${p.clave}`}
                  className="input-new"
                  rows={4}
                  maxLength={MAX_PLANTILLA}
                  placeholder={p.ejemplo}
                  value={templates[p.clave] ?? ""}
                  aria-describedby={`${idPlantilla}-${p.clave}-ayuda`}
                  onChange={(e) => setTemplates((t) => ({ ...t, [p.clave]: e.target.value }))}
                />
                <div className={s.campoAyuda} id={`${idPlantilla}-${p.clave}-ayuda`}>
                  {p.ayuda} Variables: {p.variables.map((v) => `{${v}}`).join(", ")}.
                </div>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "10px 12px",
                borderRadius: "var(--pr-radio-s)",
                background: "var(--pr-tarjeta-2)",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--pr-texto-3)",
              }}
            >
              <MessageCircle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
              <span>
                El aviso automático de mensualidad <strong>por vencer</strong> no se redacta aquí: está en{" "}
                <a href="/dashboard/whatsapp" style={{ color: "var(--pr-activo)", textDecoration: "underline" }}>
                  Configuración → WhatsApp
                </a>
                , sección &ldquo;Mensualidades&rdquo;.
              </span>
            </div>
          </div>
        </Tarjeta>

        <Tarjeta
          icono={MessageCircle}
          titulo="WhatsApp del bot"
          sub="Dos interruptores separados: uno para el próximo control, otro para dinero."
        >
          <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={proximoControlBotEnabled}
                onChange={(e) => setProximoControlBotEnabled(e.target.checked)}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--pr-texto)" }}>
                  El bot contesta &ldquo;¿cuándo es mi próximo control?&rdquo;
                </span>
                <span style={{ display: "block", fontSize: 12, lineHeight: 1.45, color: "var(--pr-texto-3)", marginTop: 2 }}>
                  Encendido por defecto: solo dice una fecha de cita, nunca dinero. Verifica el teléfono contra el
                  expediente igual que el resto del bot.
                </span>
              </span>
            </label>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "10px 12px",
                borderRadius: "var(--pr-radio-s)",
                background: "var(--pr-tarjeta-2)",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--pr-texto-3)",
              }}
            >
              <Wallet size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
              <span>
                Que el bot diga cuánto debe un paciente es otro interruptor, aparte de este — está apagado por
                defecto y se enciende en{" "}
                <a href="/dashboard/whatsapp" style={{ color: "var(--pr-activo)", textDecoration: "underline" }}>
                  Configuración → WhatsApp
                </a>
                , sección &ldquo;Mensualidades&rdquo;.
              </span>
            </div>
          </div>
        </Tarjeta>

        <div style={{ gridColumn: "1 / -1" }}>
          <CondicionesDelConvenio />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <Tarjeta
            icono={ClipboardList}
            titulo="Procedimientos de ortodoncia"
            sub={`Precio y si va incluido en el tratamiento o se cobra aparte. «${TIPO_CITA_CONTROL_ORTO}» no tiene ese interruptor: en «${ORTHO_BILLING_MODE_LABELS.PRECIO_TOTAL}» va incluido en la mensualidad, en «${ORTHO_BILLING_MODE_LABELS.PAGO_POR_CONTROL}» se cobra con el precio de aquí.`}
          >
            <div className={s.tarjetaCuerpo}>
              <AgregarProcedimiento onCreado={recargarProcedimientos} />
              {activos.length === 0 ? (
                <div className={s.vacio}>
                  <span className={s.vacioIcono} aria-hidden>
                    <ClipboardList size={17} strokeWidth={1.75} />
                  </span>
                  <p className={s.vacioTitulo}>Todavía no hay procedimientos de ortodoncia en el catálogo.</p>
                  <p className={s.vacioPista}>
                    Puedes cargar una lista sugerida (precios de arranque, editables después) o agregarlos uno por
                    uno con «Agregar procedimiento» (aquí arriba) o desde Procedimientos.
                  </p>
                  <div className={s.vacioAcciones}>
                    <ButtonNew type="button" variant="primary" onClick={cargarSugeridos} disabled={sembrando}>
                      {sembrando ? "Cargando…" : "Cargar procedimientos sugeridos"}
                    </ButtonNew>
                  </div>
                </div>
              ) : (
                <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                  {activos.map((p) => (
                    <FilaProcedimiento key={p.id} procedimiento={p} onGuardado={recargarProcedimientos} />
                  ))}
                </ul>
              )}
              {quitados.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setVerQuitados((v) => !v)}
                    aria-expanded={verQuitados}
                    style={{
                      alignSelf: "flex-start",
                      background: "none",
                      border: 0,
                      padding: 0,
                      fontSize: 12,
                      color: "var(--pr-texto-3)",
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    {verQuitados ? "Ocultar quitados" : `Ver quitados (${quitados.length})`}
                  </button>
                  {verQuitados ? (
                    <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                      {quitados.map((p) => (
                        <FilaQuitada key={p.id} procedimiento={p} onCambio={recargarProcedimientos} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Tarjeta>
        </div>

        {suscripcion && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Tarjeta
              icono={Ban}
              titulo="Suscripción"
              sub="Cancelar el módulo de Ortodoncia. No borra pacientes, casos ni ningún dato ya guardado."
            >
              <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cancelado ? (
                  <div
                    role="status"
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      borderRadius: "var(--pr-radio-s)",
                      background: "var(--pr-alerta-suave)",
                      color: "var(--pr-alerta)",
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                    <span>
                      Cancelación programada. El módulo sigue activo hasta el fin del periodo ya pagado; después ya no
                      se cobra y el menú vuelve a pedir contratarlo.
                    </span>
                  </div>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--pr-texto-2)" }}>
                      Se apaga al final del periodo que ya está pagado — no se cobra ni un día de más, y nada de lo
                      guardado (pacientes, casos, hojas de control, facturas) se borra.
                    </p>
                    <div>
                      <ButtonNew type="button" variant="danger" onClick={cancelarModulo} disabled={cancelando}>
                        {cancelando ? "Cancelando…" : "Cancelar módulo"}
                      </ButtonNew>
                    </div>
                  </>
                )}
              </div>
            </Tarjeta>
          </div>
        )}

        <div className={s.barraGuardar}>
          <ButtonNew type="button" variant="primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </ButtonNew>
        </div>
      </div>
    </Pantalla>
  );
}

/**
 * «Agregar procedimiento» (nombre, precio, incluido/con costo aparte): crea en el
 * MISMO catálogo que Procedimientos (POST /api/procedures, categoría Ortodoncia)
 * y la lista se recarga al instante. Aparece también en «Cobrar extra» si es con
 * costo aparte.
 */
function AgregarProcedimiento({ onCreado }: { onCreado: () => void | Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [incluido, setIncluido] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const idNombre = useId();
  const idPrecio = useId();

  function cerrar() {
    setAbierto(false);
    setNombre("");
    setPrecio("");
    setIncluido(null);
  }

  async function crear() {
    if (!nombre.trim()) return void toast.error("Escribe el nombre del procedimiento.");
    const n = Number(precio);
    if (precio.trim() === "" || !Number.isFinite(n) || n < 0) return void toast.error("Precio inválido.");
    if (incluido === null) return void toast.error("Elige cómo se cobra: incluido en el tratamiento o con costo aparte.");
    setGuardando(true);
    try {
      const res = await fetch("/api/procedures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nombre.trim(), category: "orthodontics", basePrice: n, orthoIncludedInTreatment: incluido }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "No se pudo agregar el procedimiento.");
        return;
      }
      toast.success(`«${nombre.trim()}» agregado.`);
      await onCreado();
      cerrar();
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div style={{ marginBottom: 10 }}>
        <ButtonNew type="button" variant="secondary" size="sm" onClick={() => setAbierto(true)}>
          Agregar procedimiento
        </ButtonNew>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 12,
        padding: "10px 12px",
        marginBottom: 10,
        border: "1px solid var(--pr-borde)",
        borderRadius: "var(--pr-radio-s)",
        background: "var(--pr-tarjeta-2)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 0 }}>
        <label className={s.campoEtiqueta} htmlFor={idNombre}>Nombre</label>
        <input id={idNombre} className="input-new" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Recementado de bracket" style={{ minHeight: 34, padding: "6px 9px" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
        <label className={s.campoEtiqueta} htmlFor={idPrecio}>Precio</label>
        <input id={idPrecio} type="number" min={0} step="0.01" className="input-new" value={precio} onChange={(e) => setPrecio(e.target.value)} style={{ minHeight: 34, padding: "6px 9px" }} />
      </div>
      <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }} role="radiogroup" aria-label="¿Cómo se cobra?">
        {([
          { valor: true, etiqueta: "Incluido" },
          { valor: false, etiqueta: "Con costo aparte" },
        ] as const).map((op) => {
          const activo = incluido === op.valor;
          return (
            <button
              key={String(op.valor)}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => setIncluido(op.valor)}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: "var(--pr-radio-s)",
                border: `1px solid ${activo ? "var(--pr-activo)" : "var(--pr-borde)"}`,
                background: activo ? "var(--pr-activo-suave)" : "var(--pr-tarjeta)",
                color: activo ? "var(--pr-activo)" : "var(--pr-texto-2)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {op.etiqueta}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <ButtonNew type="button" variant="primary" size="sm" onClick={crear} disabled={guardando}>
          {guardando ? "Agregando…" : "Agregar"}
        </ButtonNew>
        <ButtonNew type="button" variant="ghost" size="sm" onClick={cerrar} disabled={guardando}>
          Cancelar
        </ButtonNew>
      </div>
    </div>
  );
}

/** Una fila del catálogo de ortodoncia: precio + incluido/con costo, con su propio guardado (PATCH /api/procedures/[id] — el mismo endpoint del modal de Procedimientos de siempre). */
function FilaProcedimiento({ procedimiento, onGuardado }: { procedimiento: OrthoProcedureRow; onGuardado: () => void }) {
  const esControl = procedimiento.name === TIPO_CITA_CONTROL_ORTO;
  const [basePrice, setBasePrice] = useState(String(procedimiento.basePrice));
  const [incluido, setIncluido] = useState<boolean | null>(procedimiento.orthoIncludedInTreatment);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const askConfirm = useConfirm();
  const idPrecio = useId();

  const precioValido = basePrice.trim() !== "" && Number.isFinite(Number(basePrice)) && Number(basePrice) >= 0;
  const dirty =
    (precioValido && Number(basePrice) !== procedimiento.basePrice) ||
    (!esControl && incluido !== procedimiento.orthoIncludedInTreatment);

  async function guardarFila() {
    if (!precioValido) {
      toast.error("Precio inválido.");
      return;
    }
    setGuardando(true);
    try {
      const body: Record<string, unknown> = { basePrice: Number(basePrice) };
      if (!esControl) body.orthoIncludedInTreatment = incluido;
      const res = await fetch(`/api/procedures/${procedimiento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "No se pudo guardar el procedimiento.");
        return;
      }
      toast.success(`«${procedimiento.name}» actualizado.`);
      onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  async function quitarFila() {
    if (!(await askConfirm({
      title: `Quitar «${procedimiento.name}»`,
      description: textoConfirmarQuitar(procedimiento.name),
      variant: "danger",
      confirmText: "Quitar",
    }))) return;
    setQuitando(true);
    try {
      const res = await fetch(`/api/procedures/${procedimiento.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo quitar el procedimiento.");
        return;
      }
      toast.success(mensajeDeQuitar(procedimiento.name, { accion: data?.accion === "eliminado" ? "eliminado" : "archivado", usos: typeof data?.usos === "number" ? data.usos : null }));
      await onGuardado();
    } finally {
      setQuitando(false);
    }
  }

  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid var(--pr-borde)",
        borderRadius: "var(--pr-radio-s)",
        background: "var(--pr-tarjeta-2)",
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pr-texto)" }}>{procedimiento.name}</span>
        {esControl ? (
          <span style={{ display: "block", fontSize: 11.5, color: "var(--pr-texto-3)", marginTop: 2 }}>
            Su cobro depende del modo de cobro de la clínica (arriba), no de un interruptor aquí.
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
        <label className={s.campoEtiqueta} htmlFor={idPrecio}>
          Precio
        </label>
        <input
          id={idPrecio}
          type="number"
          min={0}
          step="0.01"
          className="input-new"
          value={basePrice}
          onChange={(e) => setBasePrice(e.target.value)}
          style={{ minHeight: 34, padding: "6px 9px" }}
        />
      </div>

      {!esControl ? (
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }} role="radiogroup" aria-label={`Incluido o con costo — ${procedimiento.name}`}>
          {([
            { valor: true, etiqueta: "Incluido" },
            { valor: false, etiqueta: "Con costo aparte" },
          ] as const).map((op) => {
            const activo = incluido === op.valor;
            return (
              <button
                key={String(op.valor)}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setIncluido(op.valor)}
                style={{
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--pr-radio-s)",
                  border: `1px solid ${activo ? "var(--pr-activo)" : "var(--pr-borde)"}`,
                  background: activo ? "var(--pr-activo-suave)" : "var(--pr-tarjeta)",
                  color: activo ? "var(--pr-activo)" : "var(--pr-texto-2)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {op.etiqueta}
              </button>
            );
          })}
        </div>
      ) : null}

      {dirty ? (
        <ButtonNew type="button" variant="secondary" size="sm" onClick={guardarFila} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </ButtonNew>
      ) : null}

      {!esControl ? (
        <button
          type="button"
          onClick={quitarFila}
          disabled={quitando}
          aria-label={`Quitar ${procedimiento.name}`}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: "var(--pr-radio-s)",
            border: "1px solid var(--pr-borde)",
            background: "var(--pr-tarjeta)",
            color: "var(--pr-alerta)",
            cursor: quitando ? "default" : "pointer",
            opacity: quitando ? 0.6 : 1,
          }}
        >
          <Trash2 size={13} strokeWidth={1.75} aria-hidden />
          {quitando ? "Quitando…" : "Quitar"}
        </button>
      ) : null}
    </li>
  );
}

/** Un procedimiento quitado (archivado): solo se puede volver a activar. */
function FilaQuitada({ procedimiento, onCambio }: { procedimiento: OrthoProcedureRow; onCambio: () => void | Promise<void> }) {
  const [activando, setActivando] = useState(false);

  async function reactivar() {
    setActivando(true);
    try {
      const res = await fetch(`/api/procedures/${procedimiento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "No se pudo volver a activar.");
        return;
      }
      toast.success(`«${procedimiento.name}» activo otra vez.`);
      await onCambio();
    } finally {
      setActivando(false);
    }
  }

  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        border: "1px dashed var(--pr-borde)",
        borderRadius: "var(--pr-radio-s)",
        background: "var(--pr-tarjeta-2)",
      }}
    >
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, color: "var(--pr-texto-2)" }}>{procedimiento.name}</span>
      <ButtonNew type="button" variant="secondary" size="sm" onClick={reactivar} disabled={activando}>
        {activando ? "Activando…" : "Volver a activar"}
      </ButtonNew>
    </li>
  );
}
