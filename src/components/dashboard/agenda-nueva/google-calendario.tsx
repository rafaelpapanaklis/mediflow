"use client";

/**
 * GOOGLE CALENDAR → AGENDA, la parte que se ve (WS1-T9, grupo Salamanca).
 *
 * Tres piezas, para que la agenda cambie lo mínimo (una línea en cada sitio):
 *
 *   · `SincronizarGoogleAlAbrir` — en la raíz de la agenda. Al abrirla (y cada
 *     pocos minutos mientras está a la vista) pide una sincronización: así
 *     panel.108, que no corre crons, también se pone al día. Si Google no deja
 *     LEER el calendario, enseña el aviso de volver a conectar.
 *   · `AccionBloqueoGoogle` — dentro de la franja gris de un bloqueo de Google.
 *     Al tocarla: el evento y «Convertir en cita» (paciente existente o nuevo,
 *     procedimiento; la hora y el doctor vienen del bloqueo).
 *   · `AvisoGoogleCita` — dentro del panel de una cita convertida: «El evento de
 *     Google cambió a <hora>. ¿Mover la cita?» / «…se eliminó. ¿Cancelar la cita?».
 *     La cita NUNCA se mueve ni se cancela sola.
 *
 * Con la bandera apagada: la primera no pinta nada (una petición al abrir la
 * agenda), y las otras dos no se montan o no piden nada.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock, Layers, Loader2, RefreshCw, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { instrumentSans } from "@/fonts/menu";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { PatientSearchField } from "@/components/dashboard/new-appointment/patient-search-field";
import { MotivoField } from "@/components/dashboard/new-appointment/motivo-field";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { avisarResultadoWhatsApp, type ResultadoAvisoWhatsApp } from "@/lib/agenda/aviso-whatsapp";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import { bookingRuleMessage } from "@/lib/agenda/booking-rules";
import type { BandaBloqueo } from "@/components/dashboard/bloqueos/fechas";
import { CLASES_PORTAL_AGENDA } from "./ropa";
import {
  camposSobreagendar,
  confirmacionDesde409,
  moverCitaAlEvento,
  preguntarOtraVez,
  type ConfirmacionSobreagenda,
} from "./google-sobreagendar";
import s from "./agenda-nueva.module.css";
import g from "./google-calendario.module.css";

// ═══════════════════════════════════════════════════════════════════════
// ¿La clínica tiene esto encendido? Lo sabe la sincronización al abrir.
// ═══════════════════════════════════════════════════════════════════════

let encendida = false;
const oyentes = new Set<() => void>();
function fijarEncendida(v: boolean) {
  if (encendida === v) return;
  encendida = v;
  for (const f of oyentes) f();
}
function useGoogleEncendido(): boolean {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => { oyentes.delete(f); }; },
    () => encendida,
    () => false,
  );
}

/** Cada cuánto se vuelve a pedir mientras la agenda está a la vista. */
const CADA_MS = 3 * 60 * 1000;

interface EstadoPantalla {
  encendida: boolean;
  conectada: boolean;
  error: string | null;
  cambios?: boolean;
}

function leerEstado(raw: unknown): EstadoPantalla | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    encendida: r.encendida === true,
    conectada: r.conectada === true,
    error: typeof r.error === "string" ? r.error : null,
    cambios: r.cambios === true,
  };
}

export function SincronizarGoogleAlAbrir() {
  const t = useT();
  const { invalidateRangeCache, refetchView } = useAgenda();
  const [estado, setEstado] = useState<EstadoPantalla | null>(null);

  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/google/agenda/sincronizar", { method: "POST", credentials: "include" });
        // Sesión vencida o sin permiso: no se vuelve a preguntar cada 3 min (G12).
        if (res.status === 401 || res.status === 403) { window.clearInterval(id); return; }
        if (!res.ok || !vivo) return;
        const e = leerEstado(await res.json());
        if (!e || !vivo) return;
        setEstado(e);
        fijarEncendida(e.encendida);
        // Sin la bandera no se vuelve a preguntar (una sola petición al abrir).
        if (!e.encendida) window.clearInterval(id);
        // Llegaron cambios de Google: la rejilla vuelve a pedir su rango.
        if (e.cambios) {
          invalidateRangeCache();
          refetchView();
        }
      } catch {
        /* sin red: la siguiente vuelta, o el cron, se encargan */
      }
    };
    const id = window.setInterval(() => { void pedir(); }, CADA_MS);
    void pedir();
    return () => { vivo = false; window.clearInterval(id); };
    // Solo al montar: el intervalo hace el resto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const texto = estado?.encendida ? avisoDeConexion(estado.error) : null;
  if (!texto) return null;
  return (
    <div className={g.avisoReconectar} role="status">
      <RefreshCw size={16} aria-hidden className={g.avisoIcono} />
      <span className={g.avisoTexto}>{t(texto)}</span>
      <a className={g.avisoEnlace} href="/dashboard/settings?tab=integraciones">
        {t("agenda.google.reconectarBoton")}
      </a>
    </div>
  );
}

/**
 * Qué aviso enseña la agenda según el error (revisión t8, G3). Con «permisos»
 * solo falla LEER (las citas sí se copian a Google); con la conexión caída o
 * rechazada no va nada en ningún sentido, y no se puede decir lo contrario.
 */
export function avisoDeConexion(error: string | null): string | null {
  if (error === "permisos") return "agenda.google.reconectar";
  if (error === "autorizacion" || error === "conexion_caida") return "agenda.google.reconectarCaida";
  if (error === "calendario_personal" || error === "calendario_compartido") return "agenda.google.calendarioNoValido";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// LA FRANJA: clic → el evento y «Convertir en cita»
// ═══════════════════════════════════════════════════════════════════════

interface DetalleBloqueo {
  id: string;
  titulo: string;
  /** false = quien mira no puede ver el título (G1): se pinta «Ocupado (Google)». */
  tituloVisible: boolean;
  inicio: string;
  fin: string;
  diaCompleto: boolean;
  doctorId: string | null;
  doctorNombre: string | null;
  /** El doctor del bloqueo atiende: la cita es suya. Si no, se elige. */
  doctorFijo: boolean;
  alcance: string | null;
  activo: boolean;
  citaId: string | null;
}

function leerDetalle(raw: unknown): DetalleBloqueo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.inicio !== "string" || typeof r.fin !== "string") return null;
  return {
    id: r.id,
    titulo: typeof r.titulo === "string" ? r.titulo : "",
    tituloVisible: r.tituloVisible !== false,
    inicio: r.inicio,
    fin: r.fin,
    diaCompleto: r.diaCompleto === true,
    doctorId: typeof r.doctorId === "string" ? r.doctorId : null,
    doctorNombre: typeof r.doctorNombre === "string" ? r.doctorNombre : null,
    doctorFijo: r.doctorFijo === true,
    alcance: typeof r.alcance === "string" ? r.alcance : null,
    activo: r.activo === true,
    citaId: typeof r.citaId === "string" ? r.citaId : null,
  };
}

/** La capa que hace clicable la franja gris. No deja pasar el clic a la columna (que agendaría ahí). */
export function AccionBloqueoGoogle({ banda }: { banda: BandaBloqueo }) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  if (!banda.google) return null;
  // Sin título visible (G1) la franja ya dice «Ocupado (Google)»: el nombre accesible, igual.
  const titulo = banda.google.titulo || banda.reason || t("agenda.google.sinTitulo");
  const parar = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <>
      <button
        type="button"
        className={g.capaFranja}
        aria-label={t("agenda.google.abrirAria", { titulo })}
        onPointerDown={parar}
        onMouseMove={parar}
        onClick={(e) => { e.stopPropagation(); setAbierto(true); }}
      />
      {abierto && <PanelBloqueoGoogle bloqueoId={banda.id} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

const REASON_PRESET_KEYS = [
  "appointments.newApptDialog.presetGeneralConsult",
  "appointments.newApptDialog.presetFirstConsult",
  "appointments.newApptDialog.presetCleaning",
  "appointments.newApptDialog.presetResin",
  "appointments.newApptDialog.presetPain",
  "appointments.newApptDialog.presetUrgency",
];

function useFormatoRango() {
  const locale = useLocale();
  const { state } = useAgenda();
  return useCallback(
    (inicio: string, fin: string, diaCompleto: boolean, todoElDia: string) => {
      const zona = state.timezone;
      const fecha = new Intl.DateTimeFormat(locale, { timeZone: zona, weekday: "long", day: "numeric", month: "long" });
      const hora = new Intl.DateTimeFormat(locale, { timeZone: zona, hour: "2-digit", minute: "2-digit" });
      const i = new Date(inicio);
      const f = new Date(fin);
      // «martes, 20 de octubre» → «Martes, 20 de octubre» (solo la primera letra).
      const dia = fecha.format(i);
      const diaConMayuscula = dia.charAt(0).toLocaleUpperCase(locale) + dia.slice(1);
      if (diaCompleto) return `${diaConMayuscula} · ${todoElDia}`;
      return `${diaConMayuscula} · ${hora.format(i)}–${hora.format(f)}`;
    },
    [locale, state.timezone],
  );
}

/** Más que esto no se convierte en UNA cita (mismo tope que el servidor, `CONVERTIR_MAX_HORAS`). */
const CONVERTIR_MAX_MS = 12 * 60 * 60 * 1000;

/** El texto del «¿Seguro?» (otra cita del doctor, o su comida). */
function TextoSobreagendar({ c }: { c: ConfirmacionSobreagenda }) {
  const t = useT();
  return (
    <>
      {c.tipo === "comida"
        ? t("agenda.google.sobreagendar.cuerpoComida", { desde: c.comidaDesde ?? "", hasta: c.comidaHasta ?? "" })
        : t("agenda.google.sobreagendar.cuerpoDoctor", { paciente: c.paciente ?? "—", hora: c.hora ?? "" })}
      {c.tipo === "cita" && c.otras > 0 && (
        <><br />{t("agenda.google.sobreagendar.otras", { n: String(c.otras) })}</>
      )}
      {c.tipo === "cita" && c.comidaDesde && c.comidaHasta && (
        <><br />{t("agenda.google.sobreagendar.tambienComida", { desde: c.comidaDesde, hasta: c.comidaHasta })}</>
      )}
    </>
  );
}

/** El código de error de la conversión → la frase (G8). `null` = no es de aquí. */
function claveDeError(codigo: string): string | null {
  switch (codigo) {
    case "google_block_already_converted": return "agenda.google.errorYaConvertido";
    case "google_block_changed":
    case "google_block_inactive":
    case "google_block_not_found": return "agenda.google.errorCambio";
    case "google_block_all_day": return "agenda.google.noConvertibleTodoElDia";
    case "google_block_too_long": return "agenda.google.noConvertibleLargo";
    case "google_block_doctor": return "agenda.google.errorDoctor";
    case "google_block_unavailable": return "agenda.google.errorApagado";
    case "appointment_overlap": return "agenda.google.errorChoque";
    case "lunch_overlap": return "agenda.google.errorComida";
    default: return null;
  }
}

function PanelBloqueoGoogle({ bloqueoId, onCerrar }: { bloqueoId: string; onCerrar: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { state, permissions, invalidateRangeCache, refetchView } = useAgenda();
  const { open: abrirPacienteNuevo } = useNewPatientDialog();
  const formato = useFormatoRango();

  const [detalle, setDetalle] = useState<DetalleBloqueo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recargas, setRecargas] = useState(0);
  const [paciente, setPaciente] = useState<{ id: string; name: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<ConfirmacionSobreagenda | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetch(`/api/google/agenda/bloqueo/${encodeURIComponent(bloqueoId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!vivo) return;
        const d = leerDetalle(raw);
        setDetalle(d);
        if (d?.doctorFijo && d.doctorId) setDoctorId(d.doctorId);
      })
      .catch(() => { if (vivo) setDetalle(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [bloqueoId, recargas]);

  const doctores = useMemo(() => state.doctors.filter((d) => d.activeInAgenda !== false), [state.doctors]);
  const presets = useMemo(() => REASON_PRESET_KEYS.map((k) => t(k)), [t]);
  const muyLargo = !!detalle && new Date(detalle.fin).getTime() - new Date(detalle.inicio).getTime() > CONVERTIR_MAX_MS;
  // Todo el día crearía una cita de 00:00 a 00:00; un evento de 12 h, una cita de 12 h (G5).
  const noConvertible = !!detalle && (detalle.diaCompleto || muyLargo);
  const convertible = !!detalle && detalle.activo && !detalle.citaId && !noConvertible && permissions.canCreate;
  const titulo = detalle && !detalle.tituloVisible
    ? t("agenda.google.ocupado")
    : detalle?.titulo || t("agenda.google.sinTitulo");
  const eligeDoctor = !!detalle && !detalle.doctorFijo;

  const guardar = async (sobreagendar: ConfirmacionSobreagenda | null = null) => {
    if (!detalle) return;
    if (!paciente) return setError(t("agenda.google.faltaPaciente"));
    const doctor = detalle.doctorFijo && detalle.doctorId ? detalle.doctorId : doctorId;
    if (!doctor) return setError(t("agenda.google.faltaDoctor"));
    if (!motivo.trim()) return setError(t("agenda.google.faltaProcedimiento"));
    setError(null);
    setGuardando(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: paciente.id,
          doctorId: doctor,
          startsAt: detalle.inicio,
          endsAt: detalle.fin,
          reason: motivo.trim(),
          // El servidor no cuenta ESTE bloqueo (es el hueco que se ocupa). Sin
          // `bloqueoConfirmado`: otro bloqueo en esa hora nadie lo ha visto.
          googleBloqueoId: detalle.id,
          // Ya se dijo «Sí, sobreagendar» a ESTA cita (o a la comida).
          ...camposSobreagendar(sobreagendar),
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
      if (!res.ok) {
        const codigo = body?.error ?? "";
        if (res.status === 409) {
          const aviso = confirmacionDesde409(body, state.timezone, locale);
          // Se vuelve a preguntar solo si es OTRA cita (o más) que la ya confirmada.
          if (preguntarOtraVez(aviso, sobreagendar)) {
            setConfirmar(aviso);
            return;
          }
          if (codigo === "google_block_changed" || codigo === "google_block_inactive") setRecargas((n) => n + 1);
        }
        const clave = claveDeError(codigo);
        setConfirmar(null);
        setError(
          clave
            ? t(clave)
            : bookingRuleMessage(body) ?? (res.status === 403 ? t("agenda.google.sinPermiso") : t("agenda.google.errorGenerico")),
        );
        return;
      }
      setConfirmar(null);
      // La cita nueva y el bloqueo ya retirado llegan con el rango otra vez.
      invalidateRangeCache();
      refetchView();
      toast.success(t("agenda.google.listo"));
      onCerrar();
    } catch {
      setError(t("agenda.google.errorGenerico"));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && !guardando) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${CLASES_PORTAL_AGENDA} ${s.velo}`} />
        <Dialog.Content
          className={`${CLASES_PORTAL_AGENDA} ${instrumentSans.variable} ${s.modalMover}`}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (guardando) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (guardando) e.preventDefault(); }}
        >
          <div className={s.modalCabecera}>
            <span className={s.panelRotulo}>{t("agenda.google.panelRotulo")}</span>
            <Dialog.Close asChild>
              <button type="button" className={`${s.panelIconoBoton} ${s.panelCerrar}`} aria-label={t("agenda.google.cerrar")} disabled={guardando}>
                <X size={18} strokeWidth={2.2} />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Title className={s.modalTitulo}>
            {confirmar ? t("agenda.google.sobreagendar.titulo") : cargando ? t("agenda.google.cargando") : titulo}
          </Dialog.Title>

          {confirmar ? (
            <div className={g.cuerpo}>
              <p className={g.confirmacion} role="alert">
                <Layers size={16} aria-hidden className={g.confirmacionIcono} />
                <span><TextoSobreagendar c={confirmar} /></span>
              </p>
            </div>
          ) : cargando ? (
            <div className={g.cuerpo}><Loader2 size={18} className={g.girando} aria-hidden /></div>
          ) : !detalle ? (
            <p className={g.cuerpo}>{t("agenda.google.noEncontrado")}</p>
          ) : (
            <div className={g.cuerpo}>
              <p className={g.hora}>
                <CalendarClock size={15} aria-hidden />
                {formato(detalle.inicio, detalle.fin, detalle.diaCompleto, t("agenda.google.todoElDia"))}
              </p>
              {/* Si el doctor se elige abajo, no se repite «Doctor» (salvo para decir a nombre de quién está). */}
              {(!eligeDoctor || !convertible || detalle.doctorId !== null) && (
                <p className={g.dato}>
                  <span className={s.datoRotulo}>{t(eligeDoctor && detalle.doctorId ? "agenda.google.aNombreDe" : "agenda.google.doctor")}</span>
                  <span>{detalle.doctorNombre ?? t("agenda.google.alcanceClinica")}</span>
                </p>
              )}
              {detalle.doctorId === null && detalle.alcance && detalle.alcance !== "sin_invitados" && (
                <p className={g.nota}>{t(`agenda.google.alcance_${detalle.alcance}`)}</p>
              )}
              <p className={g.explicacion}>{t("agenda.google.explicacion")}</p>

              {detalle.citaId ? (
                <p className={g.nota}>{t("agenda.google.yaConvertido")}</p>
              ) : !detalle.activo ? (
                <p className={g.nota}>{t("agenda.google.inactivo")}</p>
              ) : noConvertible ? (
                <p className={g.nota}>{t(detalle.diaCompleto ? "agenda.google.noConvertibleTodoElDia" : "agenda.google.noConvertibleLargo")}</p>
              ) : !permissions.canCreate ? null : (
                <div className={g.formulario}>
                  <h3 className={g.subtitulo}>{t("agenda.google.convertirTitulo")}</h3>

                  <div className={g.campo}>
                    <span className={s.datoRotulo}>{t("agenda.google.paciente")}</span>
                    <PatientSearchField value={paciente} onChange={(p) => { setPaciente(p); setError(null); }} />
                    {/* El buscador ya trae «Crear paciente nuevo» (en blanco); este atajo da de alta con el
                        título del evento como nombre sugerido. Mismo alta, misma detección de duplicados. */}
                    {detalle.tituloVisible && detalle.titulo && !paciente ? (
                      <>
                        <button
                          type="button"
                          className={g.botonTexto}
                          onClick={() =>
                            abrirPacienteNuevo({
                              initialName: detalle.titulo,
                              onCreated: (p) => { setPaciente(p); setError(null); },
                            })
                          }
                        >
                          <UserPlus size={14} aria-hidden /> {t("agenda.google.pacienteNuevo", { nombre: detalle.titulo })}
                        </button>
                        <span className={g.ayuda}>{t("agenda.google.pacienteNuevoAyuda")}</span>
                      </>
                    ) : null}
                  </div>

                  {eligeDoctor && (
                    <label className={g.campo}>
                      <span className={s.datoRotulo}>{t("agenda.google.doctor")}</span>
                      <select className={g.selector} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setError(null); }}>
                        <option value="">{t("agenda.google.elegirDoctor")}</option>
                        {doctores.map((d) => (
                          <option key={d.id} value={d.id}>{d.displayName}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className={g.campo}>
                    <span className={s.datoRotulo}>{t("agenda.google.procedimiento")}</span>
                    <MotivoField value={motivo} onChange={(v) => { setMotivo(v); setError(null); }} presets={presets} />
                  </div>

                  <p className={g.ayuda}>{t("agenda.google.convertirNota")}</p>
                  {error && <p className={g.error} role="alert">{error}</p>}
                </div>
              )}
            </div>
          )}

          <div className={s.modalPie}>
            {confirmar ? (
              <>
                <button type="button" className={s.accionSecundaria} onClick={() => setConfirmar(null)} disabled={guardando}>
                  {t("agenda.google.sobreagendar.cancelar")}
                </button>
                <button type="button" className={s.accionPrincipal} onClick={() => guardar(confirmar)} disabled={guardando} autoFocus>
                  {guardando ? t("agenda.google.guardando") : t("agenda.google.sobreagendar.confirmar")}
                </button>
              </>
            ) : (
              <>
                <Dialog.Close asChild>
                  <button type="button" className={s.accionSecundaria} disabled={guardando}>{t("agenda.google.cerrar")}</button>
                </Dialog.Close>
                {convertible && (
                  <button type="button" className={s.accionPrincipal} onClick={() => guardar()} disabled={guardando}>
                    {guardando ? t("agenda.google.guardando") : t("agenda.google.guardar")}
                  </button>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL AVISO EN LA CITA CONVERTIDA
// ═══════════════════════════════════════════════════════════════════════

interface AvisoCita {
  tipo: "movido" | "eliminado";
  inicio: string | null;
  fin: string | null;
}

function leerAviso(raw: unknown): AvisoCita | null {
  const a = (raw as { aviso?: unknown } | null)?.aviso as Record<string, unknown> | null | undefined;
  if (!a || (a.tipo !== "movido" && a.tipo !== "eliminado")) return null;
  return {
    tipo: a.tipo,
    inicio: typeof a.inicio === "string" ? a.inicio : null,
    fin: typeof a.fin === "string" ? a.fin : null,
  };
}

export function AvisoGoogleCita({ citaId, onCancelar }: { citaId: string; onCancelar: () => void }) {
  const t = useT();
  const locale = useLocale();
  const activo = useGoogleEncendido();
  const { state, dispatch, permissions, invalidateRangeCache } = useAgenda();
  const [aviso, setAviso] = useState<AvisoCita | null>(null);
  const [enVuelo, setEnVuelo] = useState(false);
  const [confirmar, setConfirmar] = useState<ConfirmacionSobreagenda | null>(null);
  const cita = state.appointments.find((a) => a.id === citaId) ?? null;
  // Se vuelve a preguntar si la cita cambia (la movieron o cancelaron).
  const firma = cita ? `${cita.startsAt}|${cita.endsAt}|${cita.status}` : "";

  useEffect(() => {
    if (!activo || !citaId) { setAviso(null); return; }
    let vivo = true;
    fetch(`/api/google/agenda/cita/${encodeURIComponent(citaId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => { if (vivo) { setAviso(leerAviso(raw)); setConfirmar(null); } })
      .catch(() => { if (vivo) setAviso(null); });
    return () => { vivo = false; };
  }, [activo, citaId, firma]);

  if (!aviso) return null;

  const hora = aviso.inicio
    ? new Intl.DateTimeFormat(locale, {
        timeZone: state.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(aviso.inicio))
    : "";

  // Con la agenda flexible, si la hora nueva cae sobre otra cita o en la
  // comida, el mismo «¿Seguro?» que «Convertir en cita» (C5).
  const mover = async (sobreagendar: ConfirmacionSobreagenda | null = null) => {
    if (!aviso.inicio || !aviso.fin) return;
    setEnVuelo(true);
    try {
      const r = await moverCitaAlEvento({
        citaId, inicio: aviso.inicio, fin: aviso.fin, confirmada: sobreagendar, zona: state.timezone, locale,
      });
      if (r.estado === "confirmar") {
        setConfirmar(r.confirmacion);
        return;
      }
      setConfirmar(null);
      if (r.estado === "error") {
        const clave =
          r.codigo === "appointment_overlap" ? "agenda.google.errorChoque"
          : r.codigo === "lunch_overlap" ? "agenda.google.errorComida"
          : null;
        toast.error(clave ? t(clave) : bookingRuleMessage(r.body as { error?: unknown; reason?: unknown } | null) ?? t("agenda.google.errorMover"));
        return;
      }
      if (r.body.appointment) dispatch({ type: "REPLACE_APPOINTMENT", appointment: r.body.appointment as AgendaAppointmentDTO });
      avisarResultadoWhatsApp(r.body.whatsapp as ResultadoAvisoWhatsApp);
      invalidateRangeCache();
      setAviso(null);
      toast.success(t("agenda.google.movida"));
      if (r.body.scheduleWarning?.message) toast(r.body.scheduleWarning.message, { duration: 6000 });
    } catch {
      toast.error(t("agenda.google.errorMover"));
    } finally {
      setEnVuelo(false);
    }
  };

  const mantener = async () => {
    setEnVuelo(true);
    try {
      const res = await fetch(`/api/google/agenda/cita/${encodeURIComponent(citaId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "mantener" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAviso(null);
      toast.success(t("agenda.google.mantenida"));
    } catch {
      toast.error(t("agenda.google.errorGenerico"));
    } finally {
      setEnVuelo(false);
    }
  };

  if (confirmar) {
    return (
      <div className={g.avisoCita} role="alert">
        <p className={g.avisoCitaTexto}>
          <Layers size={15} aria-hidden />
          <span>
            <strong>{t("agenda.google.sobreagendar.titulo")}.</strong>{" "}
            <TextoSobreagendar c={confirmar} />
          </span>
        </p>
        <div className={g.avisoAcciones}>
          <button type="button" className={g.botonAviso} onClick={() => mover(confirmar)} disabled={enVuelo}>
            {enVuelo ? t("agenda.google.guardando") : t("agenda.google.sobreagendar.confirmar")}
          </button>
          <button type="button" className={g.botonAvisoSecundario} onClick={() => setConfirmar(null)} disabled={enVuelo}>
            {t("agenda.google.sobreagendar.cancelar")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={g.avisoCita} role="status">
      <p className={g.avisoCitaTexto}>
        <CalendarClock size={15} aria-hidden />
        {aviso.tipo === "movido" ? t("agenda.google.avisoMovido", { hora }) : t("agenda.google.avisoEliminado")}
      </p>
      <div className={g.avisoAcciones}>
        {aviso.tipo === "movido" && permissions.canEdit && (
          <button type="button" className={g.botonAviso} onClick={() => mover()} disabled={enVuelo}>
            {t("agenda.google.moverCita")}
          </button>
        )}
        {aviso.tipo === "eliminado" && permissions.canCancel && (
          <button type="button" className={g.botonAviso} onClick={onCancelar} disabled={enVuelo}>
            {t("agenda.google.cancelarCita")}
          </button>
        )}
        {permissions.canEdit && (
          <button type="button" className={g.botonAvisoSecundario} onClick={mantener} disabled={enVuelo}>
            {t("agenda.google.mantener")}
          </button>
        )}
      </div>
    </div>
  );
}
