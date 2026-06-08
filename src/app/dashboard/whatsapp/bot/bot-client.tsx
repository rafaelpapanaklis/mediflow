"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, MessageSquare, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { BotConfigDTO, BotFaqDTO, BotBusinessHours } from "@/lib/whatsapp/bot/types";
import { PERSONA_TEMPLATES } from "./persona-templates";

// Índice 0 = Lunes … 6 = Domingo (igual que ClinicSchedule / settings horarios).
const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// Estado editable del horario: claves "0".."6".
type ScheduleState = Record<string, { enabled: boolean; open: string; close: string }>;

// Parte de la config que es editable desde el formulario (todo menos id/clinicId).
type EditableConfig = {
  enabled: boolean;
  botName: string;
  persona: string;
  greeting: string;
  afterHoursMsg: string;
  canAnswerFaq: boolean;
  canBookAppointments: boolean;
  fallbackToHuman: boolean;
};

function emptySchedule(): ScheduleState {
  const s: ScheduleState = {};
  for (let i = 0; i < 7; i++) s[String(i)] = { enabled: false, open: "09:00", close: "18:00" };
  return s;
}

function scheduleFromConfig(bh: BotBusinessHours | null): ScheduleState {
  const base = emptySchedule();
  if (!bh) return base;
  for (let i = 0; i < 7; i++) {
    const day = bh[String(i)];
    if (day) {
      base[String(i)] = {
        enabled: !!day.enabled,
        open: day.open || "09:00",
        close: day.close || "18:00",
      };
    }
  }
  return base;
}

function editableFromConfig(c: BotConfigDTO): EditableConfig {
  return {
    enabled: c.enabled,
    botName: c.botName ?? "",
    persona: c.persona ?? "",
    greeting: c.greeting ?? "",
    afterHoursMsg: c.afterHoursMsg ?? "",
    canAnswerFaq: c.canAnswerFaq,
    canBookAppointments: c.canBookAppointments,
    fallbackToHuman: c.fallbackToHuman,
  };
}

// Switch con estilos propios (inline) para que el estado OFF sea SIEMPRE
// claramente visible (track gris + perilla a la izquierda) sin depender del
// color de fondo de la tarjeta. La clase global .switch dejaba el OFF en
// rgba(255,255,255,0.1), invisible sobre tarjetas claras.
function Switch({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: "relative",
        flexShrink: 0,
        width: 36,
        height: 20,
        padding: 0,
        border: "none",
        borderRadius: 10,
        // OFF: gris sólido visible en tema claro y oscuro. ON: morado de marca.
        background: on ? "var(--brand)" : "#94a3b8",
        boxShadow: on
          ? "0 0 12px rgba(124,58,237,0.35)"
          : "inset 0 0 0 1px rgba(15,10,30,0.18)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background .15s, box-shadow .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          // OFF: perilla a la izquierda. ON: perilla a la derecha.
          transform: on ? "translateX(16px)" : "translateX(0)",
          transition: "transform .2s",
        }}
      />
    </button>
  );
}

// Fila de toggle con texto descriptivo (mismo look que whatsapp-client).
function ToggleRow({
  on,
  onToggle,
  title,
  desc,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  desc?: string;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${on ? "rgba(16,185,129,0.25)" : "var(--border-soft)"}`,
        background: on ? "var(--success-soft)" : "transparent",
        transition: "all .15s",
      }}
    >
      <Switch on={on} onClick={onToggle} label={title} disabled={disabled} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{title}</div>
        {desc && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{desc}</div>}
      </div>
    </div>
  );
}

export function BotClient() {
  const askConfirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Guardamos el DTO original para no perder id/clinicId al hacer PATCH parcial.
  const [config, setConfig] = useState<BotConfigDTO | null>(null);
  const [form, setForm] = useState<EditableConfig>({
    enabled: false,
    botName: "",
    persona: "",
    greeting: "",
    afterHoursMsg: "",
    canAnswerFaq: true,
    canBookAppointments: true,
    fallbackToHuman: true,
  });
  const [schedule, setSchedule] = useState<ScheduleState>(emptySchedule());

  const [faqs, setFaqs] = useState<BotFaqDTO[]>([]);

  // Alta de FAQ.
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [addingFaq, setAddingFaq] = useState(false);

  // ── Carga inicial ───────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/bot");
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
        const data: { config: BotConfigDTO; faqs: BotFaqDTO[] } = await res.json();
        if (!alive) return;
        setConfig(data.config);
        setForm(editableFromConfig(data.config));
        setSchedule(scheduleFromConfig(data.config.businessHours));
        setFaqs(Array.isArray(data.faqs) ? data.faqs : []);
      } catch (err: unknown) {
        if (!alive) return;
        setLoadError(true);
        toast.error(err instanceof Error && err.message ? err.message : "No se pudo cargar el bot");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Guardar config + horario ──────────────────────────────────────────────
  function buildBusinessHours(): BotBusinessHours {
    const bh: BotBusinessHours = {};
    for (let i = 0; i < 7; i++) {
      const d = schedule[String(i)] ?? { enabled: false, open: "09:00", close: "18:00" };
      bh[String(i)] = { enabled: d.enabled, open: d.open, close: d.close };
    }
    return bh;
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const body = {
        enabled: form.enabled,
        botName: form.botName,
        persona: form.persona,
        greeting: form.greeting,
        afterHoursMsg: form.afterHoursMsg,
        canAnswerFaq: form.canAnswerFaq,
        canBookAppointments: form.canBookAppointments,
        fallbackToHuman: form.fallbackToHuman,
        businessHours: buildBusinessHours(),
      };
      const res = await fetch("/api/whatsapp/bot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
      const data: { config: BotConfigDTO } = await res.json();
      setConfig(data.config);
      setForm(editableFromConfig(data.config));
      setSchedule(scheduleFromConfig(data.config.businessHours));
      toast.success("Configuración guardada");
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── FAQs ──────────────────────────────────────────────────────────────────
  async function addFaq() {
    const question = newQuestion.trim();
    const answer = newAnswer.trim();
    if (!question || !answer) {
      toast.error("Escribe la pregunta y la respuesta");
      return;
    }
    setAddingFaq(true);
    const order = faqs.length ? Math.max(...faqs.map((f) => f.order)) + 1 : 0;
    // Optimistic: añadimos un placeholder con id temporal.
    const tempId = `temp-${Date.now()}`;
    const optimistic: BotFaqDTO = { id: tempId, question, answer, enabled: true, order };
    setFaqs((prev) => [...prev, optimistic]);
    setNewQuestion("");
    setNewAnswer("");
    try {
      const res = await fetch("/api/whatsapp/bot/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, enabled: true, order }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
      const data: { faq: BotFaqDTO } = await res.json();
      // Reemplazamos el placeholder por el FAQ real del servidor.
      setFaqs((prev) => prev.map((f) => (f.id === tempId ? data.faq : f)));
      toast.success("FAQ agregada");
    } catch (err: unknown) {
      // Revertir: quitamos el placeholder y restauramos los inputs.
      setFaqs((prev) => prev.filter((f) => f.id !== tempId));
      setNewQuestion(question);
      setNewAnswer(answer);
      toast.error(err instanceof Error && err.message ? err.message : "No se pudo agregar");
    } finally {
      setAddingFaq(false);
    }
  }

  async function patchFaq(id: string, patch: Partial<Pick<BotFaqDTO, "question" | "answer" | "enabled" | "order">>) {
    const before = faqs;
    // Optimistic.
    setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    try {
      const res = await fetch(`/api/whatsapp/bot/faqs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
      const data: { faq: BotFaqDTO } = await res.json();
      setFaqs((prev) => prev.map((f) => (f.id === id ? data.faq : f)));
    } catch (err: unknown) {
      setFaqs(before); // revertir
      toast.error(err instanceof Error && err.message ? err.message : "No se pudo actualizar");
    }
  }

  async function deleteFaq(id: string) {
    const ok = await askConfirm({
      title: "Eliminar FAQ",
      description: "¿Seguro que quieres eliminar esta pregunta frecuente?",
      variant: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    const before = faqs;
    // Optimistic.
    setFaqs((prev) => prev.filter((f) => f.id !== id));
    try {
      const res = await fetch(`/api/whatsapp/bot/faqs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
      toast.success("FAQ eliminada");
    } catch (err: unknown) {
      setFaqs(before); // revertir
      toast.error(err instanceof Error && err.message ? err.message : "No se pudo eliminar");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const rootStyle = { padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1100, margin: "0 auto" } as const;

  if (loading) {
    return (
      <div style={rootStyle}>
        <div style={{ color: "var(--text-3)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          Cargando…
        </div>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div style={rootStyle}>
        <CardNew title="No se pudo cargar el bot" sub="Vuelve a intentarlo en unos momentos.">
          <ButtonNew variant="primary" onClick={() => window.location.reload()}>
            Reintentar
          </ButtonNew>
        </CardNew>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "var(--success-soft)",
              border: "1px solid rgba(16,185,129,0.2)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Bot size={20} style={{ color: "#6ee7b7" }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: "clamp(16px, 1.4vw, 22px)",
                letterSpacing: "-0.02em",
                color: "var(--text-1)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              Bot de WhatsApp
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
              Configura el asistente automático que responde a tus pacientes por WhatsApp.
            </p>
          </div>
        </div>
        <BadgeNew tone={form.enabled ? "success" : "neutral"} dot>
          {form.enabled ? "Activado" : "Desactivado"}
        </BadgeNew>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ── GENERAL ── */}
        <CardNew title="General" sub="Identidad y comportamiento del asistente.">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ToggleRow
              on={form.enabled}
              onToggle={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
              title="Bot activado"
              desc="Cuando está activo, el bot responde automáticamente los mensajes entrantes."
              disabled={saving}
            />

            <div className="field-new">
              <label className="field-new__label">Nombre del bot</label>
              <input
                className="input-new"
                placeholder="Asistente de la clínica"
                value={form.botName}
                onChange={(e) => setForm((f) => ({ ...f, botName: e.target.value }))}
              />
            </div>

            <div className="field-new">
              <label className="field-new__label">Persona / instrucciones</label>

              {/* Estilos sugeridos: al elegir uno se rellena el textarea de
                  persona (editable después). No hay ninguno por defecto. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
                  Estilos sugeridos
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PERSONA_TEMPLATES.map((tpl) => {
                    const selected = form.persona.trim() === tpl.text.trim();
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setForm((f) => ({ ...f, persona: tpl.text }))}
                        style={{
                          flex: "1 1 180px",
                          minWidth: 160,
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 10,
                          cursor: "pointer",
                          border: `1px solid ${selected ? "var(--brand)" : "var(--border-soft)"}`,
                          background: selected ? "var(--brand-soft)" : "var(--bg-elev-2)",
                          transition: "all .15s",
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                          {tpl.label}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                          {tpl.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <textarea
                className="input-new"
                style={{ height: 90, resize: "vertical" }}
                placeholder="Tono, estilo y reglas que debe seguir el bot al responder."
                value={form.persona}
                onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
              />
            </div>

            <div className="field-new">
              <label className="field-new__label">Saludo</label>
              <textarea
                className="input-new"
                style={{ height: 90, resize: "vertical" }}
                placeholder="Hola 👋, soy el asistente de la clínica. ¿En qué puedo ayudarte?"
                value={form.greeting}
                onChange={(e) => setForm((f) => ({ ...f, greeting: e.target.value }))}
              />
            </div>

            <div className="field-new">
              <label className="field-new__label">Mensaje fuera de horario</label>
              <textarea
                className="input-new"
                style={{ height: 90, resize: "vertical" }}
                placeholder="Gracias por tu mensaje. Te responderemos en nuestro horario de atención."
                value={form.afterHoursMsg}
                onChange={(e) => setForm((f) => ({ ...f, afterHoursMsg: e.target.value }))}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ToggleRow
                on={form.canAnswerFaq}
                onToggle={() => setForm((f) => ({ ...f, canAnswerFaq: !f.canAnswerFaq }))}
                title="Responder preguntas frecuentes"
                desc="El bot usa tu lista de FAQ para contestar dudas comunes."
                disabled={saving}
              />
              <ToggleRow
                on={form.canBookAppointments}
                onToggle={() => setForm((f) => ({ ...f, canBookAppointments: !f.canBookAppointments }))}
                title="Agendar citas"
                desc="Permite que el bot proponga horarios y agende citas."
                disabled={saving}
              />
              <ToggleRow
                on={form.fallbackToHuman}
                onToggle={() => setForm((f) => ({ ...f, fallbackToHuman: !f.fallbackToHuman }))}
                title="Derivar a un humano"
                desc="Si el bot no puede resolver, pasa la conversación a tu equipo."
                disabled={saving}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <ButtonNew variant="primary" onClick={saveConfig} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </ButtonNew>
            </div>
          </div>
        </CardNew>

        {/* ── HORARIO ── */}
        <CardNew
          title="Horario de atención"
          sub="Define cuándo el bot responde como activo. Fuera de estos horarios envía el mensaje de fuera de horario."
          action={<Clock size={16} style={{ color: "var(--text-3)" }} />}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {DAY_LABELS.map((label, i) => {
              const key = String(i);
              const s = schedule[key] ?? { enabled: false, open: "09:00", close: "18:00" };
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${s.enabled ? "rgba(16,185,129,0.25)" : "var(--border-soft)"}`,
                    background: s.enabled ? "var(--success-soft)" : "transparent",
                    transition: "all .15s",
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) =>
                      setSchedule((sc) => ({ ...sc, [key]: { ...s, enabled: e.target.checked } }))
                    }
                    style={{ width: 16, height: 16, accentColor: "var(--brand)", flexShrink: 0, cursor: "pointer" }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      width: 96,
                      color: s.enabled ? "var(--text-1)" : "var(--text-3)",
                    }}
                  >
                    {label}
                  </span>
                  {s.enabled ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="time"
                        className="input-new mono"
                        style={{ width: 120 }}
                        value={s.open}
                        onChange={(e) =>
                          setSchedule((sc) => ({ ...sc, [key]: { ...s, open: e.target.value } }))
                        }
                      />
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>a</span>
                      <input
                        type="time"
                        className="input-new mono"
                        style={{ width: 120 }}
                        value={s.close}
                        onChange={(e) =>
                          setSchedule((sc) => ({ ...sc, [key]: { ...s, close: e.target.value } }))
                        }
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--text-3)" }}>Cerrado</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <ButtonNew variant="primary" onClick={saveConfig} disabled={saving}>
              {saving ? "Guardando…" : "Guardar horario"}
            </ButtonNew>
          </div>
        </CardNew>

        {/* ── FAQ ── */}
        <CardNew
          title="Preguntas frecuentes"
          sub="El bot usa estas preguntas y respuestas para contestar a tus pacientes."
          action={<MessageSquare size={16} style={{ color: "var(--text-3)" }} />}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Alta */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 14,
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev-2)",
              }}
            >
              <div className="field-new">
                <label className="field-new__label">Pregunta</label>
                <input
                  className="input-new"
                  placeholder="¿Cuál es el costo de una consulta?"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Respuesta</label>
                <textarea
                  className="input-new"
                  style={{ height: 90, resize: "vertical" }}
                  placeholder="La primera consulta tiene un costo de…"
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                />
              </div>
              <div>
                <ButtonNew
                  variant="primary"
                  icon={<Plus size={14} />}
                  onClick={addFaq}
                  disabled={addingFaq}
                >
                  {addingFaq ? "Agregando…" : "Agregar"}
                </ButtonNew>
              </div>
            </div>

            {/* Lista */}
            {faqs.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 2px" }}>
                Aún no tienes preguntas frecuentes. Agrega la primera arriba.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {faqs.map((faq) => (
                  <div
                    key={faq.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: 14,
                      borderRadius: 10,
                      border: "1px solid var(--border-soft)",
                      background: faq.enabled ? "transparent" : "var(--bg-elev-2)",
                      opacity: faq.enabled ? 1 : 0.7,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Switch
                          on={faq.enabled}
                          onClick={() => patchFaq(faq.id, { enabled: !faq.enabled })}
                          label="Activa"
                        />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {faq.enabled ? "Activa" : "Inactiva"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                        <span style={{ fontSize: 11, color: "var(--text-4)" }}>Orden</span>
                        <input
                          type="number"
                          className="input-new mono"
                          style={{ width: 72 }}
                          value={faq.order}
                          onChange={(e) => {
                            const order = Number(e.target.value);
                            setFaqs((prev) =>
                              prev.map((f) => (f.id === faq.id ? { ...f, order: Number.isNaN(order) ? 0 : order } : f)),
                            );
                          }}
                          onBlur={(e) => {
                            const order = Number(e.target.value);
                            patchFaq(faq.id, { order: Number.isNaN(order) ? 0 : order });
                          }}
                        />
                        <ButtonNew
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => deleteFaq(faq.id)}
                        >
                          Borrar
                        </ButtonNew>
                      </div>
                    </div>

                    <div className="field-new">
                      <label className="field-new__label">Pregunta</label>
                      <input
                        className="input-new"
                        value={faq.question}
                        onChange={(e) =>
                          setFaqs((prev) =>
                            prev.map((f) => (f.id === faq.id ? { ...f, question: e.target.value } : f)),
                          )
                        }
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== "") patchFaq(faq.id, { question: v });
                        }}
                      />
                    </div>

                    <div className="field-new">
                      <label className="field-new__label">Respuesta</label>
                      <textarea
                        className="input-new"
                        style={{ height: 90, resize: "vertical" }}
                        value={faq.answer}
                        onChange={(e) =>
                          setFaqs((prev) =>
                            prev.map((f) => (f.id === faq.id ? { ...f, answer: e.target.value } : f)),
                          )
                        }
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== "") patchFaq(faq.id, { answer: v });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardNew>
      </div>
    </div>
  );
}
