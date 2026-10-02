"use client";

import { useState, useEffect } from "react";
import { Plus, X, Clock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { FilaEspera, horaLlegada } from "@/components/dashboard/piezas-rediseno/fila-espera";
import {
  MAX_SUGERENCIAS, MIN_LETRAS_BUSQUEDA, cuerpoAlAgregar, decidirAlAgregar, type PacienteEncontrado,
} from "@/lib/walk-in/paciente-de-la-fila";

interface QueueItem {
  id: string;
  patientName: string;
  service: string;
  priority: number;
  status: string;
  assignedTo: string | null;
  joinedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  WAITING: "pages.walkIn.statusWaiting",
  ASSIGNED: "pages.walkIn.statusAssigned",
  IN_PROGRESS: "pages.walkIn.statusInProgress",
  COMPLETED: "pages.walkIn.statusCompleted",
  CANCELLED: "pages.walkIn.statusCancelled",
};

const STATUS_COLORS: Record<string, string> = {
  WAITING: "bg-amber-100 text-amber-700 border-amber-300",
  ASSIGNED: "bg-blue-100 text-blue-700 border-blue-300",
  IN_PROGRESS: "bg-brand-500/15 text-brand-700 border-brand-300",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    function update() {
      const diff = Date.now() - new Date(since).getTime();
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      setElapsed(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
    }
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [since]);

  return <span className="text-xs font-medium">{elapsed}</span>;
}

export function WalkInClient({ initialQueue, profesionales = [], rediseno = false, puedeAgregar = true, puedeEditar = true, timezone }: {
  initialQueue: QueueItem[];
  /** Quién puede recibir citas (regla única de la Agenda): la lista de «Asignar». La resuelve page.tsx. */
  profesionales?: { id: string; name: string }[];
  /** Interruptor `menu-dos-niveles` de la clínica (lo resuelve page.tsx):
   *  encendido pinta la fila vestida con el lenguaje del menú nuevo;
   *  apagado, todo lo de abajo, tal cual. La lógica es la misma en los dos. */
  rediseno?: boolean;
  /** agenda.create / agenda.edit: la API los exige igual; aquí solo se esconde el botón. */
  puedeAgregar?: boolean;
  puedeEditar?: boolean;
  /** Zona de la clínica: «Llegó» se pinta en ella, no en la del navegador. */
  timezone?: string;
}) {
  const t = useT();
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [showAdd, setShowAdd] = useState(false);
  // `patientId`: el paciente del expediente que recepción eligió en el buscador; null = nadie elegido todavía.
  const [form, setForm] = useState<{ patientName: string; service: string; patientId: string | null }>({ patientName: "", service: "", patientId: null });
  // Pacientes de la clínica que se parecen a lo escrito (nombre o teléfono), para no duplicar expedientes.
  const [encontrados, setEncontrados] = useState<PacienteEncontrado[]>([]);
  // «Agregar» con alguien del mismo nombre y sin elegir: se pregunta si es esa persona o es otra.
  const [preguntarSiEsNuevo, setPreguntarSiEsNuevo] = useState(false);
  // Fila a la que se le está eligiendo profesional (el «Asignar» abre el selector en esa fila).
  const [asignandoId, setAsignandoId] = useState<string | null>(null);
  // «Iniciar» sin profesional asignado abre el selector; al elegir, la misma elección inicia la consulta.
  const [iniciarAlElegir, setIniciarAlElegir] = useState<string | null>(null);
  const nombreDe = (id: string | null) => (id ? profesionales.find(p => p.id === id)?.name ?? null : null);

  const statusLabel = (status: string) =>
    STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status;

  // Auto-refresh cada 30s con pausa cuando la pestaña no está visible.
  useEffect(() => {
    const ctrl = new AbortController();
    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/walk-in", { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && !ctrl.signal.aborted) setQueue(data);
        }
      } catch { /* ignore */ }
    };
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (intervalId === null) intervalId = setInterval(fetchQueue, 30_000); };
    const stop = () => { if (intervalId !== null) { clearInterval(intervalId); intervalId = null; } };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchQueue(); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  async function buscarPacientes(q: string, signal?: AbortSignal): Promise<PacienteEncontrado[]> {
    if (q.length < MIN_LETRAS_BUSQUEDA) return [];
    try {
      const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`, { signal });
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j?.hits) ? j.hits.slice(0, MAX_SUGERENCIAS) : [];
    } catch {
      return []; // abortada o sin red: sin sugerencias
    }
  }

  // Busca en los pacientes de la clínica mientras se escribe el nombre (o el teléfono), con una pausa de 300 ms.
  // Con un paciente ya elegido no se busca: el nombre es el suyo.
  useEffect(() => {
    const q = form.patientName.trim();
    if (!puedeAgregar || form.patientId || q.length < MIN_LETRAS_BUSQUEDA) { setEncontrados([]); return; }
    const ctrl = new AbortController();
    const temporizador = setTimeout(async () => {
      const lista = await buscarPacientes(q, ctrl.signal);
      if (!ctrl.signal.aborted) setEncontrados(lista);
    }, 300);
    return () => { clearTimeout(temporizador); ctrl.abort(); };
  }, [form.patientName, form.patientId, puedeAgregar]);

  function cambiarNombre(patientName: string) {
    // Escribir otra cosa suelta al paciente elegido: ya no es él.
    setForm(f => ({ ...f, patientName, patientId: null }));
    setPreguntarSiEsNuevo(false);
  }

  function elegirPaciente(p: PacienteEncontrado) {
    setForm(f => ({ ...f, patientName: p.name, patientId: p.id }));
    setEncontrados([]);
    setPreguntarSiEsNuevo(false);
  }

  function soltarPaciente() {
    setForm(f => ({ ...f, patientId: null }));
  }

  async function handleAdd(opciones?: { comoNuevo?: boolean }) {
    if (!form.patientName.trim() || !form.service.trim()) {
      toast.error(t("pages.walkIn.nameServiceRequired"));
      return;
    }
    // Ya hay un paciente con ese nombre y no se eligió: puede ser la misma persona. Se pregunta antes. Se busca
    // otra vez aquí: con Enter rápido la búsqueda de la pausa aún no ha vuelto.
    let lista = encontrados;
    if (!form.patientId && !opciones?.comoNuevo) {
      lista = await buscarPacientes(form.patientName.trim());
      setEncontrados(lista);
    }
    if (decidirAlAgregar({ ...form, encontrados: lista, comoNuevo: opciones?.comoNuevo }) === "preguntar") {
      setPreguntarSiEsNuevo(true);
      return;
    }
    try {
      const res = await fetch("/api/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoAlAgregar(form)),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setQueue(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ patientName: "", service: "", patientId: null });
      setEncontrados([]);
      setPreguntarSiEsNuevo(false);
      toast.success(t("pages.walkIn.patientAdded"));
    } catch {
      toast.error(t("pages.walkIn.addError"));
    }
  }

  const paciente = {
    encontrados,
    elegido: form.patientId,
    preguntarSiEsNuevo,
    cambiarNombre,
    elegir: elegirPaciente,
    soltar: soltarPaciente,
    agregarComoNuevo: () => handleAdd({ comoNuevo: true }),
  };

  async function handleAction(id: string, action: string, assignedTo?: string) {
    // «Iniciar» crea la cita del momento y necesita profesional: si la fila no lo trae, se le pide elegir uno.
    if (action === "start" && !assignedTo && !queue.find(q => q.id === id)?.assignedTo) {
      if (profesionales.length === 0) { toast.error(t("pages.walkIn.noProfessionals")); return; }
      setIniciarAlElegir(id);
      setAsignandoId(id);
      toast(t("pages.walkIn.chooseToStart"));
      return;
    }
    // Elegido el profesional de una fila que se quería iniciar: ya no es «Asignar», es «Iniciar».
    if (action === "assign" && assignedTo && iniciarAlElegir === id) {
      setIniciarAlElegir(null);
      action = "start";
    }
    // «Asignar» sin profesional todavía: abre el selector de la fila; la petición sale al elegir.
    if (action === "assign" && !assignedTo) {
      if (profesionales.length === 0) { toast.error(t("pages.walkIn.noProfessionals")); return; }
      setAsignandoId(id);
      return;
    }
    try {
      const res = await fetch(`/api/walk-in/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(assignedTo ? { assignedTo } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(typeof err?.reason === "string" ? err.reason : t("pages.walkIn.updateError"));
        if (res.status === 409) {
          // Otra pantalla ya movió el turno: se trae la fila al día en vez de dejarla con el estado viejo.
          const r = await fetch("/api/walk-in");
          if (r.ok) { const data = await r.json(); if (Array.isArray(data)) setQueue(data); }
        }
        return;
      }
      const updated = await res.json();
      setQueue(prev => prev.map(q => q.id === id ? updated : q));
      setAsignandoId(null);
      setIniciarAlElegir(null);
      toast.success(t("pages.walkIn.statusUpdatedToast", { status: statusLabel(updated.status) }));
    } catch {
      toast.error(t("pages.walkIn.updateError"));
    }
  }

  const activeQueue = queue.filter(q => q.status !== "COMPLETED" && q.status !== "CANCELLED");
  // «Atendidos hoy» = solo los completados; los cancelados van aparte y «en atención» no es «en espera».
  const doneQueue = queue.filter(q => q.status === "COMPLETED");
  const cancelledQueue = queue.filter(q => q.status === "CANCELLED");
  const waitingCount = activeQueue.filter(q => q.status !== "IN_PROGRESS").length;

  // REDISEÑO — mismo estado, mismos handlers, mismo refresco cada 30 s y el
  // mismo temporizador (llega como función para no duplicar su intervalo).
  // Con la bandera apagada no se llega aquí y lo de abajo se pinta como hoy.
  if (rediseno) {
    return (
      <FilaEspera
        activeQueue={activeQueue}
        doneQueue={doneQueue}
        cancelledQueue={cancelledQueue}
        waitingCount={waitingCount}
        timezone={timezone}
        form={form}
        setForm={setForm}
        paciente={paciente}
        handleAdd={handleAdd}
        handleAction={handleAction}
        profesionales={profesionales}
        asignandoId={asignandoId}
        cancelarAsignar={() => { setAsignandoId(null); setIniciarAlElegir(null); }}
        nombreDe={nombreDe}
        statusLabel={statusLabel}
        pintarEspera={(since) => <ElapsedTimer since={since} />}
        puedeAgregar={puedeAgregar}
        puedeEditar={puedeEditar}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{t("pages.walkIn.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("pages.walkIn.waitingCount", { count: waitingCount })}</p>
        </div>
        {puedeAgregar && (
          <Button onClick={() => setShowAdd(true)}>
            <UserPlus className="w-5 h-5 mr-2" /> {t("pages.walkIn.addPatient")}
          </Button>
        )}
      </div>

      {/* Active queue */}
      <div className="space-y-3 mb-8">
        {activeQueue.map(item => (
          <div key={item.id} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-base font-bold">{item.patientName}</p>
                <p className="text-sm text-muted-foreground">{item.service}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${STATUS_COLORS[item.status] || ""}`}>
                {statusLabel(item.status)}
              </span>
            </div>
            <div className="flex items-center gap-4 text-muted-foreground mb-3">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{t("pages.walkIn.arrived")} {horaLlegada(item.joinedAt, timezone)}</span>
              </div>
              {item.status !== "IN_PROGRESS" && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs">{t("pages.walkIn.waitingLabel")} </span>
                  <ElapsedTimer since={item.joinedAt} />
                </div>
              )}
            </div>
            {nombreDe(item.assignedTo) && (
              <p className="text-xs text-muted-foreground mb-3">{t("pages.walkIn.assignedTo", { name: nombreDe(item.assignedTo) ?? "" })}</p>
            )}
            {puedeEditar && asignandoId === item.id && (
              <div className="flex gap-2 mb-3">
                <select
                  autoFocus
                  aria-label={t("pages.walkIn.chooseProfessional")}
                  className="h-9 flex-1 rounded-lg border border-border bg-card px-3 text-sm"
                  defaultValue=""
                  onChange={e => { if (e.target.value) void handleAction(item.id, "assign", e.target.value); }}
                >
                  <option value="" disabled>{t("pages.walkIn.chooseProfessional")}</option>
                  {profesionales.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={() => { setAsignandoId(null); setIniciarAlElegir(null); }}>{t("common.cancel")}</Button>
              </div>
            )}
            {puedeEditar && <div className="flex gap-2">
              {(item.status === "WAITING" || item.status === "ASSIGNED") && (
                <Button size="sm" variant="outline" onClick={() => handleAction(item.id, "assign")}>{t("pages.walkIn.assign")}</Button>
              )}
              {(item.status === "WAITING" || item.status === "ASSIGNED") && (
                <Button size="sm" onClick={() => handleAction(item.id, "start")}>{t("pages.walkIn.start")}</Button>
              )}
              {item.status === "IN_PROGRESS" && (
                <Button size="sm" onClick={() => handleAction(item.id, "complete")}>{t("pages.walkIn.complete")}</Button>
              )}
              {asignandoId !== item.id && item.status !== "COMPLETED" && item.status !== "CANCELLED" && (
                <Button size="sm" variant="outline" className="text-rose-500 border-rose-300 hover:bg-rose-50" onClick={() => handleAction(item.id, "cancel")}>{t("common.cancel")}</Button>
              )}
            </div>}
          </div>
        ))}
        {activeQueue.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <UserPlus className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-base font-semibold">{t("pages.walkIn.emptyActive")}</p>
          </div>
        )}
      </div>

      {/* Done queue */}
      {doneQueue.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3 text-muted-foreground">{t("pages.walkIn.attendedToday")}</h2>
          <div className="space-y-2">
            {doneQueue.map(item => (
              <div key={item.id} className="bg-muted/50 border border-border/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.patientName}</p>
                  <p className="text-xs text-muted-foreground">{item.service}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${STATUS_COLORS[item.status] || ""}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancelled queue */}
      {cancelledQueue.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold mb-3 text-muted-foreground">{t("pages.walkIn.cancelledToday")}</h2>
          <div className="space-y-2">
            {cancelledQueue.map(item => (
              <div key={item.id} className="bg-muted/50 border border-border/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.patientName}</p>
                  <p className="text-xs text-muted-foreground">{item.service}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${STATUS_COLORS[item.status] || ""}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && puedeAgregar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">{t("pages.walkIn.addToQueue")}</h2>
              <button onClick={() => setShowAdd(false)} aria-label={t("common.close")} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.walkIn.patientNameLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.walkIn.fullNamePlaceholder")}
                  value={form.patientName} onChange={e => cambiarNombre(e.target.value)} autoComplete="off" />
                <SugerenciasPacienteSimple paciente={paciente} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.walkIn.serviceLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.walkIn.servicePlaceholder")}
                  value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 py-4 flex gap-3 shrink-0 border-t border-border">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={() => handleAdd()} className="flex-1 h-11 text-base">{t("common.add")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pacientes de la clínica que se parecen a lo escrito, en la pantalla de siempre (sin el rediseño). */
function SugerenciasPacienteSimple({ paciente }: { paciente: {
  encontrados: PacienteEncontrado[];
  elegido: string | null;
  preguntarSiEsNuevo: boolean;
  elegir: (p: PacienteEncontrado) => void;
  soltar: () => void;
  agregarComoNuevo: () => void;
} }) {
  const t = useT();
  if (paciente.elegido) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        {t("pages.walkIn.patientLinked")}
        <button type="button" className="underline" onClick={paciente.soltar}>{t("pages.walkIn.patientUnlink")}</button>
      </p>
    );
  }
  if (paciente.encontrados.length === 0) return null;
  return (
    <div className="rounded-xl border border-border p-2 space-y-1">
      <p className="text-xs font-semibold text-muted-foreground px-1">
        {paciente.preguntarSiEsNuevo ? t("pages.walkIn.sameNameQuestion") : t("pages.walkIn.existingPatients")}
      </p>
      {paciente.encontrados.map(p => (
        <button key={p.id} type="button" onClick={() => paciente.elegir(p)}
          className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-muted text-sm">
          <span className="font-medium">{p.name}</span>
          {p.phone && <span className="text-muted-foreground"> · {p.phone}</span>}
        </button>
      ))}
      {paciente.preguntarSiEsNuevo && (
        <Button size="sm" variant="outline" onClick={paciente.agregarComoNuevo}>{t("pages.walkIn.addAsNew")}</Button>
      )}
    </div>
  );
}
