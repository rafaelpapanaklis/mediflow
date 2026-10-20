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
import { CalendarClock, Loader2, RefreshCw, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { instrumentSans } from "@/fonts/menu";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { PatientSearchField } from "@/components/dashboard/new-appointment/patient-search-field";
import { MotivoField } from "@/components/dashboard/new-appointment/motivo-field";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { rescheduleAppointment } from "@/lib/agenda/mutations";
import type { BandaBloqueo } from "@/components/dashboard/bloqueos/fechas";
import { CLASES_PORTAL_AGENDA } from "./ropa";
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

  const pideReconectar = !!estado?.encendida && (estado.error === "permisos" || estado.error === "autorizacion");
  if (!pideReconectar) return null;
  return (
    <div className={g.avisoReconectar} role="status">
      <RefreshCw size={16} aria-hidden className={g.avisoIcono} />
      <span className={g.avisoTexto}>{t("agenda.google.reconectar")}</span>
      <a className={g.avisoEnlace} href="/dashboard/settings?tab=integraciones">
        {t("agenda.google.reconectarBoton")}
      </a>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA FRANJA: clic → el evento y «Convertir en cita»
// ═══════════════════════════════════════════════════════════════════════

interface DetalleBloqueo {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
  diaCompleto: boolean;
  doctorId: string | null;
  doctorNombre: string | null;
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
    inicio: r.inicio,
    fin: r.fin,
    diaCompleto: r.diaCompleto === true,
    doctorId: typeof r.doctorId === "string" ? r.doctorId : null,
    doctorNombre: typeof r.doctorNombre === "string" ? r.doctorNombre : null,
    activo: r.activo === true,
    citaId: typeof r.citaId === "string" ? r.citaId : null,
  };
}

/** La capa que hace clicable la franja gris. No deja pasar el clic a la columna (que agendaría ahí). */
export function AccionBloqueoGoogle({ banda }: { banda: BandaBloqueo }) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  if (!banda.google) return null;
  const titulo = banda.google.titulo || t("agenda.google.sinTitulo");
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

function PanelBloqueoGoogle({ bloqueoId, onCerrar }: { bloqueoId: string; onCerrar: () => void }) {
  const t = useT();
  const { state, permissions, invalidateRangeCache, refetchView } = useAgenda();
  const { open: abrirPacienteNuevo } = useNewPatientDialog();
  const formato = useFormatoRango();

  const [detalle, setDetalle] = useState<DetalleBloqueo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [paciente, setPaciente] = useState<{ id: string; name: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/google/agenda/bloqueo/${encodeURIComponent(bloqueoId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!vivo) return;
        const d = leerDetalle(raw);
        setDetalle(d);
        if (d?.doctorId) setDoctorId(d.doctorId);
      })
      .catch(() => { if (vivo) setDetalle(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [bloqueoId]);

  const doctores = useMemo(() => state.doctors.filter((d) => d.activeInAgenda !== false), [state.doctors]);
  const presets = useMemo(() => REASON_PRESET_KEYS.map((k) => t(k)), [t]);
  const convertible = !!detalle && detalle.activo && !detalle.citaId && permissions.canCreate;
  const titulo = detalle?.titulo || t("agenda.google.sinTitulo");

  const guardar = async () => {
    if (!detalle) return;
    if (!paciente) return setError(t("agenda.google.faltaPaciente"));
    const doctor = detalle.doctorId ?? doctorId;
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
          googleBloqueoId: detalle.id,
          // El único bloqueo encima es este, y el servidor ya no lo cuenta.
          bloqueoConfirmado: true,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        const codigo = body?.error ?? "";
        setError(
          codigo === "google_block_already_converted"
            ? t("agenda.google.errorYaConvertido")
            : codigo === "appointment_overlap"
              ? t("agenda.google.errorChoque")
              : res.status === 403
                ? t("agenda.google.sinPermiso")
                : t("agenda.google.errorGenerico"),
        );
        return;
      }
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

          <Dialog.Title className={s.modalTitulo}>{cargando ? t("agenda.google.cargando") : titulo}</Dialog.Title>

          {cargando ? (
            <div className={g.cuerpo}><Loader2 size={18} className={g.girando} aria-hidden /></div>
          ) : !detalle ? (
            <p className={g.cuerpo}>{t("agenda.google.noEncontrado")}</p>
          ) : (
            <div className={g.cuerpo}>
              <p className={g.hora}>
                <CalendarClock size={15} aria-hidden />
                {formato(detalle.inicio, detalle.fin, detalle.diaCompleto, t("agenda.google.todoElDia"))}
              </p>
              {/* Sin doctor y convertible, el doctor se elige abajo: no se repite «Doctor». */}
              {(detalle.doctorId !== null || !convertible) && (
                <p className={g.dato}>
                  <span className={s.datoRotulo}>{t("agenda.google.doctor")}</span>
                  <span>{detalle.doctorNombre ?? t("agenda.google.alcanceClinica")}</span>
                </p>
              )}
              <p className={g.explicacion}>{t("agenda.google.explicacion")}</p>

              {detalle.citaId ? (
                <p className={g.nota}>{t("agenda.google.yaConvertido")}</p>
              ) : !detalle.activo ? (
                <p className={g.nota}>{t("agenda.google.inactivo")}</p>
              ) : !permissions.canCreate ? null : (
                <div className={g.formulario}>
                  <h3 className={g.subtitulo}>{t("agenda.google.convertirTitulo")}</h3>

                  <div className={g.campo}>
                    <span className={s.datoRotulo}>{t("agenda.google.paciente")}</span>
                    <PatientSearchField value={paciente} onChange={(p) => { setPaciente(p); setError(null); }} />
                    {/* El buscador ya trae «Crear paciente nuevo» (en blanco); este atajo da de alta con el
                        título del evento como nombre sugerido. Mismo alta, misma detección de duplicados. */}
                    {detalle.titulo && !paciente ? (
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

                  {detalle.doctorId === null && (
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

                  {error && <p className={g.error} role="alert">{error}</p>}
                </div>
              )}
            </div>
          )}

          <div className={s.modalPie}>
            <Dialog.Close asChild>
              <button type="button" className={s.accionSecundaria} disabled={guardando}>{t("agenda.google.cerrar")}</button>
            </Dialog.Close>
            {convertible && (
              <button type="button" className={s.accionPrincipal} onClick={guardar} disabled={guardando}>
                {guardando ? t("agenda.google.guardando") : t("agenda.google.guardar")}
              </button>
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
  const cita = state.appointments.find((a) => a.id === citaId) ?? null;
  // Se vuelve a preguntar si la cita cambia (la movieron o cancelaron).
  const firma = cita ? `${cita.startsAt}|${cita.endsAt}|${cita.status}` : "";

  useEffect(() => {
    if (!activo || !citaId) { setAviso(null); return; }
    let vivo = true;
    fetch(`/api/google/agenda/cita/${encodeURIComponent(citaId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => { if (vivo) setAviso(leerAviso(raw)); })
      .catch(() => { if (vivo) setAviso(null); });
    return () => { vivo = false; };
  }, [activo, citaId, firma]);

  if (!aviso) return null;

  const hora = aviso.inicio
    ? new Intl.DateTimeFormat(locale, {
        timeZone: state.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(aviso.inicio))
    : "";

  const mover = async () => {
    if (!aviso.inicio || !aviso.fin) return;
    setEnVuelo(true);
    try {
      const r = await rescheduleAppointment(citaId, { startsAt: aviso.inicio, endsAt: aviso.fin, bloqueoConfirmado: true });
      dispatch({ type: "REPLACE_APPOINTMENT", appointment: r.appointment });
      invalidateRangeCache();
      setAviso(null);
      toast.success(t("agenda.google.movida"));
      if (r.scheduleWarning?.message) toast(r.scheduleWarning.message, { duration: 6000 });
    } catch (err) {
      const e = err as { error?: string; message?: string };
      toast.error(e?.error === "appointment_overlap" ? t("agenda.google.errorChoque") : t("agenda.google.errorMover"));
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

  return (
    <div className={g.avisoCita} role="status">
      <p className={g.avisoCitaTexto}>
        <CalendarClock size={15} aria-hidden />
        {aviso.tipo === "movido" ? t("agenda.google.avisoMovido", { hora }) : t("agenda.google.avisoEliminado")}
      </p>
      <div className={g.avisoAcciones}>
        {aviso.tipo === "movido" && permissions.canEdit && (
          <button type="button" className={g.botonAviso} onClick={mover} disabled={enVuelo}>
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
