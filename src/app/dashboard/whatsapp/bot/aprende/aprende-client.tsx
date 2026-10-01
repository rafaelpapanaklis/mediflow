"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, GraduationCap, Lock, ShieldCheck, Sparkles, X } from "lucide-react";
import type { EjemploTonoDTO, PanelAprendeDTO, RespuestaEquipoDTO, SugerenciaDTO } from "@/lib/whatsapp/bot/aprende/servicio";
import type { GrupoReporte, PreguntaReporte } from "@/lib/whatsapp/bot/aprende/reporte";
import { ETIQUETA_NO_APTO, problemaDeTextoDeFaq, type MotivoNoApto } from "@/lib/whatsapp/bot/aprende/anonimizar";
import { ETIQUETA_TEMA, type ClaveTema } from "@/lib/whatsapp/bot/aprende/temas";
import { ETIQUETA_TONO_NO_APTO } from "@/lib/whatsapp/bot/aprende/tono";
import { RaizWhatsApp } from "@/components/dashboard/whatsapp-rediseno/raiz";
import { Boton, BotonEnlace, Cabecera, Cargando, Etiqueta, Nota, Tarjeta } from "@/components/dashboard/whatsapp-rediseno/piezas";
import { ValorarRespuesta } from "@/components/dashboard/bot-aprende/valorar-respuesta";
import w from "@/components/dashboard/whatsapp-rediseno/whatsapp-rediseno.module.css";
import s from "@/components/dashboard/bot-aprende/bot-aprende.module.css";

/**
 * «Bot → Aprende de tu equipo» (ws1-t11). El bot aprende SUPERVISADO: aquí la
 * clínica aprueba (o descarta) lo que el bot debería contestar, califica sus
 * respuestas y elige ejemplos de tono. Nada de esto cambia al bot sin que una
 * persona con permiso lo apruebe.
 */

const fechaCorta = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function cuando(iso: string): string {
  try {
    return fechaCorta.format(new Date(iso));
  } catch {
    return "";
  }
}

async function enviar(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Sin conexión. Intenta de nuevo." } };
  }
}

function textoError(data: Record<string, unknown>): string {
  return typeof data.error === "string" ? data.error : "No se pudo guardar.";
}

export function AprendeClient({ canEdit }: { canEdit: boolean }) {
  const [panel, setPanel] = useState<PanelAprendeDTO | null>(null);
  const [cargando, setCargando] = useState(true);
  const [falloCarga, setFalloCarga] = useState(false);

  const cargar = useCallback(async () => {
    setFalloCarga(false);
    try {
      const res = await fetch("/api/whatsapp/bot/aprende", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setPanel((await res.json()) as PanelAprendeDTO);
    } catch {
      setFalloCarga(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const volver = (
    <BotonEnlace href="/dashboard/whatsapp/bot" icono={<ArrowLeft size={15} />}>
      Volver al bot
    </BotonEnlace>
  );

  if (cargando) {
    return (
      <RaizWhatsApp>
        <Cargando>Cargando…</Cargando>
      </RaizWhatsApp>
    );
  }

  if (falloCarga || !panel) {
    return (
      <RaizWhatsApp>
        <Tarjeta titulo="No se pudo cargar" sub="Vuelve a intentarlo en unos momentos.">
          <Boton variante="principal" onClick={() => void cargar()}>
            Reintentar
          </Boton>
        </Tarjeta>
      </RaizWhatsApp>
    );
  }

  return (
    <RaizWhatsApp>
      <Cabecera
        icono={<GraduationCap size={20} />}
        titulo="Aprende de tu equipo"
        sub="El bot mejora con lo que contesta tu equipo, pero solo cambia cuando tú lo apruebas."
        acciones={volver}
      />

      <div className={w.apilado}>
        <Nota icono={<ShieldCheck size={16} />} titulo="Privacidad">
          <p className={w.notaCuerpo}>
            Antes de mostrarte o guardar un texto le quitamos nombres, teléfonos, correos, fechas y montos del paciente
            (verás <strong>[nombre]</strong>, <strong>[teléfono]</strong>…). Lo que habla de la salud de un paciente
            nunca se vuelve respuesta automática. Nada de esto sale de tu clínica.
          </p>
        </Nota>

        {!canEdit && (
          <Nota icono={<Lock size={16} />} titulo="Solo lectura">
            <p className={w.notaCuerpo}>
              Puedes ver lo que el bot está aprendiendo, pero aprobar o corregir pide el permiso{" "}
              <strong>Enviar WhatsApp</strong>.
            </p>
          </Nota>
        )}

        {!panel.disponible && (
          <Nota icono={<Sparkles size={16} />} titulo="Pronto: sugerencias, 👍/👎 y ejemplos de tono">
            <p className={w.notaCuerpo}>
              Esas partes se encienden en cuanto se termine de instalar esta función. Mientras, ya puedes ver lo que el
              bot no supo contestar y agregarle respuestas.
            </p>
          </Nota>
        )}

        {panel.disponible && (
          <SeccionSugerencias
            sugerencias={panel.sugerencias}
            apartadas={panel.apartadas}
            canEdit={canEdit}
            onCambio={cargar}
          />
        )}

        <SeccionReporte grupos={panel.reporte} canEdit={canEdit} onCambio={cargar} />

        {panel.disponible && <SeccionCalificar panel={panel} canEdit={canEdit} />}

        {panel.disponible && (
          <SeccionTono
            ejemplos={panel.ejemplosTono}
            candidatas={panel.respuestasEquipo}
            max={panel.maxEjemplosTono}
            canEdit={canEdit}
            onCambio={cargar}
          />
        )}
      </div>
    </RaizWhatsApp>
  );
}

// ── 1. Sugerencias ────────────────────────────────────────────────────────────

function SeccionSugerencias({
  sugerencias,
  apartadas,
  canEdit,
  onCambio,
}: {
  sugerencias: SugerenciaDTO[];
  apartadas: Partial<Record<MotivoNoApto, number>>;
  canEdit: boolean;
  onCambio: () => Promise<void>;
}) {
  const totalApartadas = Object.values(apartadas).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <Tarjeta
      titulo="Sugerencias para el bot"
      sub="Preguntas que el bot no supo contestar y que tu equipo sí contestó. ¿Quieres que el bot conteste así la próxima vez?"
      accion={sugerencias.length > 0 ? <span className={s.conteo}>{sugerencias.length}</span> : undefined}
    >
      {sugerencias.length === 0 ? (
        <p className={w.vacio}>
          No hay sugerencias pendientes. Aparecen cuando el bot pasa una conversación al equipo y alguien contesta desde el
          Inbox.
        </p>
      ) : (
        <div className={s.grupo}>
          {sugerencias.map((sg) => (
            <TarjetaSugerencia key={sg.id} sugerencia={sg} canEdit={canEdit} onCambio={onCambio} />
          ))}
        </div>
      )}
      {totalApartadas > 0 && (
        <p className={`${w.textoSuaveMedio} ${s.pie}`}>
          {totalApartadas} {totalApartadas === 1 ? "respuesta se apartó sola" : "respuestas se apartaron solas"} en los
          últimos 30 días y no se guardó su texto:{" "}
          {(Object.entries(apartadas) as Array<[MotivoNoApto, number]>)
            .map(([m, n]) => `${n} · ${ETIQUETA_NO_APTO[m].toLowerCase()}`)
            .join("; ")}
          .
        </p>
      )}
    </Tarjeta>
  );
}

function TarjetaSugerencia({
  sugerencia,
  canEdit,
  onCambio,
}: {
  sugerencia: SugerenciaDTO;
  canEdit: boolean;
  onCambio: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [pregunta, setPregunta] = useState(sugerencia.pregunta);
  const [respuesta, setRespuesta] = useState(sugerencia.respuesta);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problema = problemaDeTextoDeFaq(pregunta, respuesta);

  async function decidir(accion: "aprobar" | "descartar") {
    if (accion === "aprobar" && problema) {
      setEditando(true);
      setError(problema.mensaje);
      return;
    }
    setOcupado(true);
    setError(null);
    const r = await enviar(`/api/whatsapp/bot/aprende/sugerencias/${encodeURIComponent(sugerencia.id)}`, {
      method: "POST",
      body: JSON.stringify(accion === "aprobar" ? { accion, pregunta, respuesta } : { accion }),
    });
    setOcupado(false);
    if (!r.ok) {
      setError(textoError(r.data));
      return;
    }
    await onCambio();
  }

  const tema = sugerencia.tema && sugerencia.tema in ETIQUETA_TEMA ? ETIQUETA_TEMA[sugerencia.tema as ClaveTema] : null;

  return (
    <div className={s.item}>
      <div className={w.filaCabeza}>
        <Etiqueta tono={sugerencia.origen === "correccion" ? "warning" : "brand"}>
          {sugerencia.origen === "correccion" ? "Corrección 👎" : "Respuesta del equipo"}
        </Etiqueta>
        {tema && <Etiqueta tono="neutral">{tema}</Etiqueta>}
        <span className={s.cuando}>{cuando(sugerencia.createdAt)}</span>
      </div>

      {editando ? (
        <>
          <label className={s.rotulo} htmlFor={`p-${sugerencia.id}`}>Pregunta del paciente</label>
          <textarea id={`p-${sugerencia.id}`} className={s.area} maxLength={1000} value={pregunta} onChange={(e) => setPregunta(e.target.value)} />
          <label className={s.rotulo} htmlFor={`r-${sugerencia.id}`}>Lo que contestará el bot</label>
          <textarea id={`r-${sugerencia.id}`} className={s.area} maxLength={1000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        </>
      ) : (
        <>
          <span className={s.rotulo}>El paciente preguntó</span>
          <p className={s.pregunta}>{pregunta || "—"}</p>
          <span className={s.rotulo}>El bot contestará</span>
          <p className={s.respuesta}>{respuesta || "—"}</p>
        </>
      )}

      {error && <p className={s.error} role="alert">{error}</p>}

      {canEdit && (
        <div className={s.itemAcciones}>
          <Boton variante="principal" peq icono={<Check size={14} />} disabled={ocupado} onClick={() => void decidir("aprobar")}>
            Sí, que conteste así
          </Boton>
          {!editando && (
            <Boton peq disabled={ocupado} onClick={() => setEditando(true)}>
              Editar
            </Boton>
          )}
          <Boton variante="suave" peq icono={<X size={14} />} disabled={ocupado} onClick={() => void decidir("descartar")}>
            Descartar
          </Boton>
        </div>
      )}
    </div>
  );
}

// ── 2. Reporte de la semana ───────────────────────────────────────────────────

function SeccionReporte({ grupos, canEdit, onCambio }: { grupos: GrupoReporte[]; canEdit: boolean; onCambio: () => Promise<void> }) {
  const total = grupos.reduce((a, g) => a + g.total, 0);
  return (
    <Tarjeta
      titulo="Lo que el bot no supo contestar esta semana"
      sub="Agrupado por tema. Agrega una respuesta y la próxima vez el bot contesta solo."
      accion={total > 0 ? <span className={s.conteo}>{total}</span> : undefined}
    >
      {grupos.length === 0 ? (
        <p className={w.vacio}>Esta semana el bot contestó todo lo que le preguntaron (o todavía no ha pasado ninguna conversación al equipo).</p>
      ) : (
        grupos.map((g) => (
          <div key={g.tema} className={s.grupo}>
            <div className={s.grupoCabeza}>
              <h3 className={s.grupoTitulo}>{g.etiqueta}</h3>
              <span className={s.conteo}>{g.total}</span>
            </div>
            {g.tema === "clinico" ? (
              <p className={w.textoSuaveMedio}>
                Preguntas sobre la salud de un paciente: no se muestran ni se automatizan. Las contesta siempre una persona.
              </p>
            ) : (
              g.preguntas.map((p) => <FilaReporte key={p.id} pregunta={p} canEdit={canEdit} onCambio={onCambio} />)
            )}
            {g.tema !== "clinico" && g.total > g.preguntas.length && (
              <p className={w.textoSuave}>y {g.total - g.preguntas.length} más parecidas o repetidas.</p>
            )}
          </div>
        ))
      )}
    </Tarjeta>
  );
}

function FilaReporte({ pregunta, canEdit, onCambio }: { pregunta: PreguntaReporte; canEdit: boolean; onCambio: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const [p, setP] = useState(pregunta.pregunta);
  const [r, setR] = useState(pregunta.respuestaEquipo ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const problema = problemaDeTextoDeFaq(p, r);
    if (problema) {
      setError(problema.mensaje);
      return;
    }
    setOcupado(true);
    setError(null);
    const res = await enviar("/api/whatsapp/bot/aprende/faq", { method: "POST", body: JSON.stringify({ pregunta: p, respuesta: r }) });
    setOcupado(false);
    if (!res.ok) {
      setError(textoError(res.data));
      return;
    }
    await onCambio();
  }

  return (
    <div className={s.item}>
      <div className={s.itemFila}>
        <div className={s.itemTextos}>
          <p className={s.pregunta}>{pregunta.pregunta}</p>
          <span className={s.cuando}>{cuando(pregunta.at)}</span>
        </div>
        {canEdit && !abierto && (
          <div className={s.itemAcciones}>
            <Boton peq onClick={() => setAbierto(true)}>
              Agregar respuesta
            </Boton>
          </div>
        )}
      </div>
      {abierto && (
        <>
          <label className={s.rotulo} htmlFor={`rp-${pregunta.id}`}>Pregunta</label>
          <textarea id={`rp-${pregunta.id}`} className={s.area} maxLength={1000} value={p} onChange={(e) => setP(e.target.value)} />
          <label className={s.rotulo} htmlFor={`rr-${pregunta.id}`}>
            Respuesta del bot{pregunta.respuestaEquipo ? " (partimos de lo que contestó tu equipo)" : ""}
          </label>
          <textarea
            id={`rr-${pregunta.id}`}
            className={s.area}
            maxLength={1000}
            placeholder="Escribe la respuesta que debe dar el bot"
            value={r}
            onChange={(e) => setR(e.target.value)}
          />
          {error && <p className={s.error} role="alert">{error}</p>}
          <div className={s.itemAcciones}>
            <Boton variante="principal" peq icono={<Check size={14} />} disabled={ocupado} onClick={() => void guardar()}>
              {ocupado ? "Guardando…" : "Guardar respuesta"}
            </Boton>
            <Boton variante="suave" peq disabled={ocupado} onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
          </div>
        </>
      )}
    </div>
  );
}

// ── 3. 👍 / 👎 ────────────────────────────────────────────────────────────────

function SeccionCalificar({ panel, canEdit }: { panel: PanelAprendeDTO; canEdit: boolean }) {
  return (
    <Tarjeta
      titulo="Califica las respuestas del bot"
      sub="Las últimas respuestas automáticas. Con 👎 escribe cómo debió ser: queda como sugerencia."
    >
      {panel.respuestasBot.length === 0 ? (
        <p className={w.vacio}>El bot no ha contestado nada en las últimas dos semanas.</p>
      ) : (
        <div className={s.grupo}>
          {panel.respuestasBot.map((r) => (
            <div key={r.id} className={s.item}>
              <div className={s.itemFila}>
                <div className={s.itemTextos}>
                  {r.pregunta && (
                    <>
                      <span className={s.rotulo}>Paciente</span>
                      <p className={s.pregunta}>{r.pregunta}</p>
                    </>
                  )}
                  <span className={s.rotulo}>
                    Bot <span className={s.cuando}>· {cuando(r.at)}</span>
                  </span>
                  <p className={s.respuesta}>{r.respuesta}</p>
                </div>
                <div className={s.itemAcciones}>
                  <ValorarRespuesta
                    messageId={r.id}
                    valorInicial={r.valor}
                    correccionInicial={r.correccion}
                    puedeEditar={canEdit}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Tarjeta>
  );
}

// ── 4. Ejemplos de tono ───────────────────────────────────────────────────────

function SeccionTono({
  ejemplos,
  candidatas,
  max,
  canEdit,
  onCambio,
}: {
  ejemplos: EjemploTonoDTO[];
  candidatas: RespuestaEquipoDTO[];
  max: number;
  canEdit: boolean;
  onCambio: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lleno = ejemplos.length >= max;

  async function marcar(messageId: string) {
    setOcupado(messageId);
    setError(null);
    const r = await enviar("/api/whatsapp/bot/aprende/tono", { method: "POST", body: JSON.stringify({ messageId }) });
    setOcupado(null);
    if (!r.ok) {
      setError(textoError(r.data));
      return;
    }
    await onCambio();
  }

  async function quitar(id: string) {
    setOcupado(id);
    setError(null);
    const r = await enviar(`/api/whatsapp/bot/aprende/tono/${encodeURIComponent(id)}`, { method: "DELETE" });
    setOcupado(null);
    if (!r.ok) {
      setError(textoError(r.data));
      return;
    }
    await onCambio();
  }

  return (
    <Tarjeta
      titulo="Así hablamos"
      sub={`Elige hasta ${max} respuestas cortas de tu equipo. El bot imita su estilo (saludo, trato, emojis), no su contenido.`}
      accion={<span className={s.contador}>{ejemplos.length} de {max}</span>}
    >
      {error && <p className={s.error} role="alert">{error}</p>}

      {ejemplos.length > 0 && (
        <div className={s.grupo}>
          {ejemplos.map((e) => (
            <div key={e.id} className={s.item}>
              <div className={s.itemFila}>
                <div className={s.itemTextos}>
                  <p className={s.pregunta}>«{e.texto}»</p>
                </div>
                {canEdit && (
                  <div className={s.itemAcciones}>
                    <Boton variante="suave" peq disabled={ocupado === e.id} onClick={() => void quitar(e.id)}>
                      Quitar
                    </Boton>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={s.grupo}>
        <div className={s.grupoCabeza}>
          <h3 className={s.grupoTitulo}>Respuestas recientes de tu equipo</h3>
        </div>
        {candidatas.length === 0 ? (
          <p className={w.vacio}>Todavía no hay respuestas del equipo desde el Inbox en los últimos 30 días.</p>
        ) : (
          candidatas.map((c) => (
            <div key={c.id} className={s.item}>
              <div className={s.itemFila}>
                <div className={s.itemTextos}>
                  <p className={s.respuesta}>{c.texto}</p>
                  <span className={s.cuando}>{cuando(c.at)}</span>
                </div>
                <div className={s.itemAcciones}>
                  {c.noApto ? (
                    <Etiqueta tono="neutral" larga>
                      {ETIQUETA_TONO_NO_APTO[c.noApto]}
                    </Etiqueta>
                  ) : (
                    canEdit && (
                      <Boton peq disabled={lleno || ocupado === c.id} onClick={() => void marcar(c.id)} title={lleno ? `Ya tienes ${max}: quita uno` : undefined}>
                        Así hablamos
                      </Boton>
                    )
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Tarjeta>
  );
}
