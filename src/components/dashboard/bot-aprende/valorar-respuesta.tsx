"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import s from "./bot-aprende.module.css";

export type ValorBot = "bien" | "mal";

/**
 * 👍 / 👎 sobre UNA respuesta del bot (ws1-t11). Con 👎 se abre «¿cómo debió
 * contestar?»: lo que se escriba queda como sugerencia para el bot (la clínica
 * la aprueba después en Bot → Aprende de tu equipo).
 *
 * Autónomo a propósito: hace su propia llamada a
 * POST /api/whatsapp/bot/aprende/valoraciones, así que puede montarse en el
 * Inbox junto a cada respuesta del bot sin tocar el estado del Inbox. Si el
 * SQL de ws1-t11 no está pegado la API responde 503 y aquí se dice tal cual.
 */
export function ValorarRespuesta({
  messageId,
  valorInicial = null,
  correccionInicial = null,
  puedeEditar,
  onGuardado,
}: {
  messageId: string;
  valorInicial?: ValorBot | null;
  correccionInicial?: string | null;
  puedeEditar: boolean;
  onGuardado?: (r: { valor: ValorBot; correccion: string | null }) => void;
}) {
  const [valor, setValor] = useState<ValorBot | null>(valorInicial);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(correccionInicial ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function guardar(nuevo: ValorBot, correccion: string | null) {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/whatsapp/bot/aprende/valoraciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, valor: nuevo, correccion }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; aviso?: string | null; sugerencia?: string | null };
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setValor(nuevo);
      setAbierto(false);
      if (data.aviso) setAviso(data.aviso);
      else if (data.sugerencia === "creada" || data.sugerencia === "actualizada") {
        setAviso("Gracias. Tu corrección quedó como sugerencia en Bot → Aprende de tu equipo.");
      }
      onGuardado?.({ valor: nuevo, correccion });
    } catch {
      setError("Sin conexión. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className={s.valorar}>
      <div className={s.pulgares}>
        <button
          type="button"
          className={[s.pulgar, valor === "bien" ? s.pulgarBien : ""].filter(Boolean).join(" ")}
          aria-pressed={valor === "bien"}
          aria-label="Buena respuesta"
          title="Buena respuesta"
          disabled={!puedeEditar || guardando}
          onClick={() => guardar("bien", null)}
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          className={[s.pulgar, valor === "mal" ? s.pulgarMal : ""].filter(Boolean).join(" ")}
          aria-pressed={valor === "mal"}
          aria-expanded={abierto}
          aria-label="Mala respuesta: escribir cómo debió ser"
          title="Mala respuesta"
          disabled={!puedeEditar || guardando}
          onClick={() => setAbierto((a) => !a)}
        >
          <ThumbsDown size={14} />
        </button>
      </div>

      {abierto && (
        <div className={s.correccion}>
          <label className={s.rotulo} htmlFor={`correccion-${messageId}`}>
            ¿Cómo debió contestar?
          </label>
          <textarea
            id={`correccion-${messageId}`}
            className={s.area}
            maxLength={1000}
            placeholder="Escribe la respuesta correcta. Sin datos del paciente: sirve para todos."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className={s.correccionAcciones}>
            <button
              type="button"
              className={[s.pulgar, s.pulgarTexto, s.pulgarMal].join(" ")}
              disabled={guardando}
              onClick={() => guardar("mal", texto.trim() || null)}
            >
              {guardando ? "Guardando…" : texto.trim() ? "Guardar corrección" : "Marcar 👎 sin corrección"}
            </button>
            <button
              type="button"
              className={[s.pulgar, s.pulgarTexto].join(" ")}
              disabled={guardando}
              onClick={() => setAbierto(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className={s.error} role="alert">{error}</p>}
      {aviso && <p className={s.aviso}>{aviso}</p>}
    </div>
  );
}
