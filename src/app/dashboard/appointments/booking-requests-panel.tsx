"use client";
/* ============================================================
   Bandeja de SOLICITUDES por confirmar (agenda del día).

   Son reservas hechas desde la mini-web SIN cuenta: todavía no
   existe ni el expediente ni la cita, y el hueco NO está apartado.
   Aceptar es lo que crea las dos cosas.

   Si alguien se ganó el horario mientras la solicitud esperaba, el
   endpoint responde con los horarios libres de ese día y aquí se
   ofrecen para reagendar de una vez.
   ============================================================ */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronDown, ChevronUp, Loader2, Phone, Stethoscope, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { isAbortError } from "@/lib/fetch-safe";

interface SolicitudDTO {
  id: string;
  status: string;
  date: string;
  time: string;
  doctorId: string | null;
  doctorName: string | null;
  serviceName: string | null;
  serviceDurationMin: number | null;
  patientName: string;
  patientDob: string | null;
  patientWhatsapp: string;
  notes: string | null;
  createdAt: string;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}

function edad(dob: string | null): string | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const hoy = new Date();
  let años = hoy.getFullYear() - y;
  // El cumpleaños de este año todavía no llega → un año menos.
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) años--;
  if (años < 0 || años > 120) return null;
  return `${años} años`;
}

export function BookingRequestsPanel({ initialOpen = false }: { initialOpen?: boolean }) {
  const router = useRouter();
  const [solicitudes, setSolicitudes] = useState<SolicitudDTO[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(initialOpen);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  /** id → horarios libres que ofreció el 409 al chocar el hueco. */
  const [alternativas, setAlternativas] = useState<Record<string, string[]>>({});
  /** id de la solicitud cuyo motivo de rechazo se está escribiendo. */
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/booking-requests?status=PENDIENTE", { signal });
      if (!res.ok) return;
      const data = await res.json();
      setSolicitudes(data.requests ?? []);
    } catch (err) {
      if (!isAbortError(err)) { /* silencio: la bandeja no debe romper la agenda */ }
    } finally {
      if (!signal?.aborted) setCargando(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    cargar(ctrl.signal);
    return () => ctrl.abort();
  }, [cargar]);

  // Con solicitudes pendientes la bandeja se abre sola: una solicitud que
  // nadie ve deja al paciente esperando.
  useEffect(() => {
    if (solicitudes.length > 0) setAbierto(true);
  }, [solicitudes.length]);

  async function aceptar(s: SolicitudDTO, startTime?: string) {
    setTrabajando(s.id);
    try {
      const res = await fetch(`/api/booking-requests/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", ...(startTime ? { startTime } : {}) }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === "SLOT_TAKEN") {
        setAlternativas(a => ({ ...a, [s.id]: data.freeSlots ?? [] }));
        toast.error(
          (data.freeSlots ?? []).length > 0
            ? `${data.error} Elige otro horario abajo.`
            : `${data.error} No quedan horarios libres ese día.`,
        );
        return;
      }
      if (!res.ok) { toast.error(data.error ?? "No pudimos confirmar la cita"); return; }

      toast.success(`Cita creada con ${data.doctorName ?? "el doctor"} · expediente nuevo`);
      setSolicitudes(list => list.filter(x => x.id !== s.id));
      setAlternativas(a => { const c = { ...a }; delete c[s.id]; return c; });
      router.refresh(); // la cita nueva tiene que aparecer en el calendario
    } catch {
      toast.error("No pudimos confirmar la cita");
    } finally {
      setTrabajando(null);
    }
  }

  async function rechazar(s: SolicitudDTO) {
    setTrabajando(s.id);
    try {
      const res = await fetch(`/api/booking-requests/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: motivo.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "No pudimos rechazar la solicitud"); return; }
      toast.success("Solicitud rechazada");
      setSolicitudes(list => list.filter(x => x.id !== s.id));
      setRechazando(null);
      setMotivo("");
    } catch {
      toast.error("No pudimos rechazar la solicitud");
    } finally {
      setTrabajando(null);
    }
  }

  // Sin solicitudes no se pinta nada: la agenda no gana con una caja vacía.
  if (cargando || solicitudes.length === 0) return null;

  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="card__header"
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
        aria-expanded={abierto}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center",
            background: "rgba(251,191,36,0.16)", color: "#fbbf24", flexShrink: 0,
          }}>
            <CalendarClock size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="card__title">Solicitudes por confirmar</div>
            <div className="card__sub">
              {solicitudes.length} {solicitudes.length === 1 ? "persona espera respuesta" : "personas esperan respuesta"}
            </div>
          </div>
        </div>
        {abierto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {abierto && (
        <div className="divide-y divide-border/50 max-h-[420px] overflow-y-auto">
          {solicitudes.map(s => {
            const ocupado = trabajando === s.id;
            const libres = alternativas[s.id];
            const años = edad(s.patientDob);
            return (
              <div key={s.id} style={{ padding: "12px 14px" }}>
                <div className="text-base font-bold truncate">{s.patientName}</div>

                <div className="text-sm text-muted-foreground" style={{ marginTop: 2 }}>
                  <span className="mono">{fechaCorta(s.date)}</span> · <span className="mono">{s.time}</span>
                  {s.serviceDurationMin ? <> · <span className="mono">{s.serviceDurationMin}</span> min</> : null}
                </div>

                <div className="text-sm text-muted-foreground" style={{ marginTop: 2 }}>
                  <Stethoscope size={12} style={{ display: "inline", verticalAlign: "-0.15em", marginRight: 4 }} />
                  {s.doctorName ?? "Cualquier doctor"}
                  {s.serviceName ? ` · ${s.serviceName}` : ""}
                </div>

                <div className="text-sm text-muted-foreground" style={{ marginTop: 2 }}>
                  <Phone size={12} style={{ display: "inline", verticalAlign: "-0.15em", marginRight: 4 }} />
                  <a href={`https://wa.me/${s.patientWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                    className="mono hover:underline">{s.patientWhatsapp}</a>
                  {s.patientDob && (
                    <> · <span className="mono">{s.patientDob}</span>{años ? ` (${años})` : ""}</>
                  )}
                </div>

                {s.notes && (
                  <div className="text-sm text-muted-foreground/70 italic" style={{ marginTop: 4 }}>{s.notes}</div>
                )}

                {/* El hueco pedido ya no está: los que sí quedan ese día */}
                {libres && libres.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-xs text-muted-foreground" style={{ marginBottom: 4 }}>
                      Horarios libres el {fechaCorta(s.date)}:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {libres.slice(0, 12).map(h => (
                        <button key={h} type="button" disabled={ocupado}
                          onClick={() => aceptar(s, h)}
                          className="btn-new btn-new--ghost btn-new--sm mono">
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {rechazando === s.id ? (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      placeholder="Motivo (opcional)"
                      className="input-new"
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" disabled={ocupado} onClick={() => rechazar(s)}
                        className="btn-new btn-new--sm" style={{ flex: 1 }}>
                        {ocupado ? <Loader2 size={13} className="animate-spin" /> : "Confirmar rechazo"}
                      </button>
                      <button type="button" onClick={() => { setRechazando(null); setMotivo(""); }}
                        className="btn-new btn-new--ghost btn-new--sm">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                    <button type="button" disabled={ocupado} onClick={() => aceptar(s)}
                      className="btn-new btn-new--primary btn-new--sm"
                      style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {ocupado
                        ? <><Loader2 size={13} className="animate-spin" /> Creando…</>
                        : <><UserPlus size={13} /> Crear paciente y confirmar</>}
                    </button>
                    <button type="button" disabled={ocupado} onClick={() => { setRechazando(s.id); setMotivo(""); }}
                      className="btn-new btn-new--ghost btn-new--sm" aria-label="Rechazar solicitud">
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 6 }} className="text-xs text-muted-foreground">
            <Check size={12} /> Al confirmar se crea el expediente con folio nuevo.
          </div>
        </div>
      )}
    </div>
  );
}
