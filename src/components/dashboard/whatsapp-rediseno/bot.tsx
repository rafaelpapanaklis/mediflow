"use client";

import type { Dispatch, SetStateAction } from "react";
import { Bot, Plus, Trash2, MessageSquare, Clock, Wallet, Lock } from "lucide-react";
import type { BotConfigDTO, BotFaqDTO } from "@/lib/whatsapp/bot/types";
import type { EditableConfig, ScheduleState } from "@/app/dashboard/whatsapp/bot/bot-client";
import { PERSONA_TEMPLATES } from "@/app/dashboard/whatsapp/bot/persona-templates";
import { RaizWhatsApp } from "./raiz";
import { Boton, BotonEnlace, Cabecera, Campo, Cargando, Etiqueta, FilaInterruptor, Interruptor, Nota, Tarjeta } from "./piezas";
import s from "./whatsapp-rediseno.module.css";

// Índice 0 = Lunes … 6 = Domingo (igual que ClinicSchedule / settings horarios).
const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Todo lo que la vista necesita, tal cual lo tiene `BotClient`: el estado y
 * los manejadores (carga, guardado, autosave del interruptor principal, alta,
 * edición y borrado de FAQ) viven allí y aquí solo se pintan. El camino viejo
 * y el nuevo hacen EXACTAMENTE las mismas llamadas a la API del bot.
 */
export type BotVM = {
  canEdit: boolean;
  loading: boolean;
  loadError: boolean;
  config: BotConfigDTO | null;
  form: EditableConfig;
  setForm: Dispatch<SetStateAction<EditableConfig>>;
  schedule: ScheduleState;
  setSchedule: Dispatch<SetStateAction<ScheduleState>>;
  faqs: BotFaqDTO[];
  setFaqs: Dispatch<SetStateAction<BotFaqDTO[]>>;
  newQuestion: string;
  setNewQuestion: (v: string) => void;
  newAnswer: string;
  setNewAnswer: (v: string) => void;
  addingFaq: boolean;
  saving: boolean;
  savingEnabled: boolean;
  // `unknown` y no `void`: sin permiso, los manejadores de BotClient devuelven
  // el id del toast («No tienes permiso…»); aquí no se usa el valor.
  saveConfig: () => Promise<unknown>;
  toggleEnabled: () => Promise<unknown>;
  addFaq: () => Promise<unknown>;
  patchFaq: (id: string, patch: Partial<Pick<BotFaqDTO, "question" | "answer" | "enabled" | "order">>) => Promise<unknown>;
  deleteFaq: (id: string) => Promise<unknown>;
};

export function BotRediseno({ vm }: { vm: BotVM }) {
  const {
    canEdit, loading, loadError, config, form, setForm, schedule, setSchedule, faqs, setFaqs,
    newQuestion, setNewQuestion, newAnswer, setNewAnswer, addingFaq, saving, savingEnabled,
    saveConfig, toggleEnabled, addFaq, patchFaq, deleteFaq,
  } = vm;

  if (loading) {
    return (
      <RaizWhatsApp>
        <Cargando>Cargando…</Cargando>
      </RaizWhatsApp>
    );
  }

  if (loadError || !config) {
    return (
      <RaizWhatsApp>
        <Tarjeta titulo="No se pudo cargar el bot" sub="Vuelve a intentarlo en unos momentos.">
          <Boton variante="principal" onClick={() => window.location.reload()}>
            Reintentar
          </Boton>
        </Tarjeta>
      </RaizWhatsApp>
    );
  }

  return (
    <RaizWhatsApp>
      <Cabecera
        icono={<Bot size={20} />}
        titulo="Bot de WhatsApp"
        sub="Configura el asistente automático que responde a tus pacientes por WhatsApp."
        acciones={
          <>
            <BotonEnlace href="/dashboard/whatsapp/bot/saldo" icono={<Wallet size={15} />}>
              Saldo de IA
            </BotonEnlace>
            <Etiqueta tono={form.enabled ? "success" : "neutral"} punto>
              {form.enabled ? "Activado" : "Desactivado"}
            </Etiqueta>
          </>
        }
      />

      <div className={s.apilado}>
        {!canEdit && (
          <Nota icono={<Lock size={16} />} titulo="Solo lectura">
            <p className={s.notaCuerpo}>
              Puedes ver cómo está configurado el bot, pero no cambiarlo. Lo que se guarda aquí es
              el texto que el asistente le manda a los pacientes desde el número de la clínica: pide
              a un administrador el permiso <strong>Enviar WhatsApp</strong> si necesitas editarlo.
            </p>
          </Nota>
        )}

        {/* Dos columnas en iMac (General a la izquierda; Horario y FAQ a la
            derecha), una debajo de otra en iPad. Nada se esconde. */}
        <div className={s.rejillaPar}>
          <div className={s.columna}>
            {/* ── GENERAL ── */}
            <Tarjeta titulo="General" sub="Identidad y comportamiento del asistente.">
              <div className={s.campos} style={{ gap: 16 }}>
                <FilaInterruptor
                  on={form.enabled}
                  onToggle={toggleEnabled}
                  titulo="Bot activado"
                  desc="Se guarda solo al tocarlo. Cuando está activo, el bot responde automáticamente los mensajes entrantes."
                  disabled={saving || savingEnabled || !canEdit}
                />

                <Campo etiqueta="Nombre del bot">
                  <input
                    className={s.entrada}
                    readOnly={!canEdit}
                    placeholder="Asistente de la clínica"
                    value={form.botName}
                    onChange={(e) => setForm((f) => ({ ...f, botName: e.target.value }))}
                  />
                </Campo>

                <Campo etiqueta="Persona / instrucciones">
                  {/* Estilos sugeridos: al elegir uno se rellena el textarea de
                      persona (editable después). No hay ninguno por defecto. */}
                  <div>
                    <div className={s.textoSuave} style={{ marginBottom: 6 }}>
                      Estilos sugeridos
                    </div>
                    <div className={s.opciones}>
                      {PERSONA_TEMPLATES.map((tpl) => {
                        const selected = form.persona.trim() === tpl.text.trim();
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            aria-pressed={selected}
                            disabled={!canEdit}
                            onClick={() => setForm((f) => ({ ...f, persona: tpl.text }))}
                            className={[s.opcion, selected ? s.opcionActiva : ""].filter(Boolean).join(" ")}
                          >
                            <div className={s.opcionTitulo}>{tpl.label}</div>
                            <div className={s.opcionDesc}>{tpl.hint}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <textarea
                    className={`${s.entrada} ${s.entradaArea}`}
                    readOnly={!canEdit}
                    style={{ height: 90 }}
                    placeholder="Tono, estilo y reglas que debe seguir el bot al responder."
                    value={form.persona}
                    onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                  />
                </Campo>

                <Campo etiqueta="Saludo">
                  <textarea
                    className={`${s.entrada} ${s.entradaArea}`}
                    readOnly={!canEdit}
                    style={{ height: 90 }}
                    placeholder="Hola 👋, soy el asistente de la clínica. ¿En qué puedo ayudarte?"
                    value={form.greeting}
                    onChange={(e) => setForm((f) => ({ ...f, greeting: e.target.value }))}
                  />
                </Campo>

                <Campo etiqueta="Mensaje fuera de horario">
                  <textarea
                    className={`${s.entrada} ${s.entradaArea}`}
                    readOnly={!canEdit}
                    style={{ height: 90 }}
                    placeholder="Gracias por tu mensaje. Te responderemos en nuestro horario de atención."
                    value={form.afterHoursMsg}
                    onChange={(e) => setForm((f) => ({ ...f, afterHoursMsg: e.target.value }))}
                  />
                </Campo>

                <div className={s.apilado} style={{ gap: 10 }}>
                  <FilaInterruptor
                    on={form.canAnswerFaq}
                    onToggle={() => setForm((f) => ({ ...f, canAnswerFaq: !f.canAnswerFaq }))}
                    titulo="Responder preguntas frecuentes"
                    desc="El bot usa tu lista de FAQ para contestar dudas comunes."
                    disabled={saving || !canEdit}
                  />
                  <FilaInterruptor
                    on={form.canBookAppointments}
                    onToggle={() => setForm((f) => ({ ...f, canBookAppointments: !f.canBookAppointments }))}
                    titulo="Agendar citas"
                    desc="Permite que el bot proponga horarios y agende citas."
                    disabled={saving || !canEdit}
                  />
                  <FilaInterruptor
                    on={form.fallbackToHuman}
                    onToggle={() => setForm((f) => ({ ...f, fallbackToHuman: !f.fallbackToHuman }))}
                    titulo="Derivar a un humano"
                    desc="Si el bot no puede resolver, pasa la conversación a tu equipo."
                    disabled={saving || !canEdit}
                  />
                </div>

                <div className={s.accionesFormulario}>
                  <Boton variante="principal" onClick={saveConfig} disabled={saving || !canEdit}>
                    {saving ? "Guardando…" : "Guardar"}
                  </Boton>
                </div>
              </div>
            </Tarjeta>
          </div>

          <div className={s.columna}>
            {/* ── HORARIO ── */}
            <Tarjeta
              titulo="Horario de atención"
              sub="Define cuándo el bot responde como activo. Fuera de estos horarios envía el mensaje de fuera de horario."
              accion={<Clock size={16} />}
            >
              <div className={s.apilado} style={{ gap: 8 }}>
                {DIAS.map((label, i) => {
                  const key = String(i);
                  const d = schedule[key] ?? { enabled: false, open: "09:00", close: "18:00" };
                  return (
                    <div key={key} className={[s.dia, d.enabled ? s.diaActivo : ""].filter(Boolean).join(" ")}>
                      <input
                        type="checkbox"
                        className={s.casilla}
                        checked={d.enabled}
                        // readOnly no aplica a checkbox: aquí hace falta disabled.
                        disabled={!canEdit}
                        aria-label={label}
                        onChange={(e) =>
                          setSchedule((sc) => ({ ...sc, [key]: { ...d, enabled: e.target.checked } }))
                        }
                      />
                      <span className={s.diaNombre}>{label}</span>
                      {d.enabled ? (
                        <div className={s.diaHoras}>
                          <input
                            type="time"
                            className={`${s.entrada} ${s.entradaCorta}`}
                            readOnly={!canEdit}
                            aria-label={`${label}: abre`}
                            value={d.open}
                            onChange={(e) =>
                              setSchedule((sc) => ({ ...sc, [key]: { ...d, open: e.target.value } }))
                            }
                          />
                          <span>a</span>
                          <input
                            type="time"
                            className={`${s.entrada} ${s.entradaCorta}`}
                            readOnly={!canEdit}
                            aria-label={`${label}: cierra`}
                            value={d.close}
                            onChange={(e) =>
                              setSchedule((sc) => ({ ...sc, [key]: { ...d, close: e.target.value } }))
                            }
                          />
                        </div>
                      ) : (
                        <span className={s.diaCerrado}>Cerrado</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`${s.accionesFormulario} ${s.arribaMas}`}>
                <Boton variante="principal" onClick={saveConfig} disabled={saving || !canEdit}>
                  {saving ? "Guardando…" : "Guardar horario"}
                </Boton>
              </div>
            </Tarjeta>

            {/* ── FAQ ── */}
            <Tarjeta
              titulo="Preguntas frecuentes"
              sub="El bot usa estas preguntas y respuestas para contestar a tus pacientes."
              accion={<MessageSquare size={16} />}
            >
              <div className={s.apilado} style={{ gap: 16 }}>
                {/* Alta */}
                <div className={s.bloque}>
                  <Campo etiqueta="Pregunta">
                    <input
                      className={s.entrada}
                      readOnly={!canEdit}
                      placeholder="¿Cuál es el costo de una consulta?"
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                    />
                  </Campo>
                  <Campo etiqueta="Respuesta">
                    <textarea
                      className={`${s.entrada} ${s.entradaArea}`}
                      readOnly={!canEdit}
                      style={{ height: 90 }}
                      placeholder="La primera consulta tiene un costo de…"
                      value={newAnswer}
                      onChange={(e) => setNewAnswer(e.target.value)}
                    />
                  </Campo>
                  <div>
                    <Boton variante="principal" icono={<Plus size={14} />} onClick={addFaq} disabled={addingFaq || !canEdit}>
                      {addingFaq ? "Agregando…" : "Agregar"}
                    </Boton>
                  </div>
                </div>

                {/* Lista */}
                {faqs.length === 0 ? (
                  <p className={s.vacio}>Aún no tienes preguntas frecuentes. Agrega la primera arriba.</p>
                ) : (
                  <div className={s.apilado} style={{ gap: 12 }}>
                    {faqs.map((faq) => (
                      <div
                        key={faq.id}
                        className={[s.bloque, faq.enabled ? "" : s.bloqueInactivo].filter(Boolean).join(" ")}
                      >
                        <div className={s.bloqueCabeza}>
                          <div className={s.bloqueDerecha} style={{ marginLeft: 0, gap: 8 }}>
                            <Interruptor
                              on={faq.enabled}
                              onClick={() => patchFaq(faq.id, { enabled: !faq.enabled })}
                              label="Activa"
                              disabled={!canEdit}
                            />
                            <span className={s.textoSuave}>{faq.enabled ? "Activa" : "Inactiva"}</span>
                          </div>
                          <div className={s.bloqueDerecha}>
                            <span className={s.textoSuave}>Orden</span>
                            <input
                              type="number"
                              className={`${s.entrada} ${s.entradaMini}`}
                              aria-label="Orden"
                              value={faq.order}
                              readOnly={!canEdit}
                              onChange={(e) => {
                                const order = Number(e.target.value);
                                setFaqs((prev) =>
                                  prev.map((f) => (f.id === faq.id ? { ...f, order: Number.isNaN(order) ? 0 : order } : f)),
                                );
                              }}
                              onBlur={(e) => {
                                // Sin permiso ni se intenta: readOnly no impide el
                                // foco, y tabular por la lista soltaría un toast
                                // rojo por campo sin que nadie haya editado nada.
                                if (!canEdit) return;
                                const order = Number(e.target.value);
                                patchFaq(faq.id, { order: Number.isNaN(order) ? 0 : order });
                              }}
                            />
                            <Boton variante="peligro" peq icono={<Trash2 size={14} />} onClick={() => deleteFaq(faq.id)} disabled={!canEdit}>
                              Borrar
                            </Boton>
                          </div>
                        </div>

                        <Campo etiqueta="Pregunta">
                          <input
                            className={s.entrada}
                            readOnly={!canEdit}
                            value={faq.question}
                            onChange={(e) =>
                              setFaqs((prev) =>
                                prev.map((f) => (f.id === faq.id ? { ...f, question: e.target.value } : f)),
                              )
                            }
                            onBlur={(e) => {
                              if (!canEdit) return;
                              const v = e.target.value;
                              if (v !== "") patchFaq(faq.id, { question: v });
                            }}
                          />
                        </Campo>

                        <Campo etiqueta="Respuesta">
                          <textarea
                            className={`${s.entrada} ${s.entradaArea}`}
                            readOnly={!canEdit}
                            style={{ height: 90 }}
                            value={faq.answer}
                            onChange={(e) =>
                              setFaqs((prev) =>
                                prev.map((f) => (f.id === faq.id ? { ...f, answer: e.target.value } : f)),
                              )
                            }
                            onBlur={(e) => {
                              if (!canEdit) return;
                              const v = e.target.value;
                              if (v !== "") patchFaq(faq.id, { answer: v });
                            }}
                          />
                        </Campo>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Tarjeta>
          </div>
        </div>
      </div>
    </RaizWhatsApp>
  );
}
