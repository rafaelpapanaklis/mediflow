"use client";
// Ortodoncia — Paciente y WhatsApp (ws1-t2, W2): botón "Enviar recordatorio"
// de mensualidad, montado en la fila L1 (Mensualidad vencida) de Alertas.
// Dentro de la ventana de 24 h manda WhatsApp; fuera de ella (o sin WhatsApp
// conectado) ofrece copiar el texto.

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { sendMensualidadReminder } from "@/app/actions/orthodontics/whatsapp/sendMensualidadReminder";
import { isFailure } from "@/app/actions/orthodontics/result";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export function EnviarRecordatorioButton({
  patientId,
  treatmentPlanId,
}: {
  patientId: string;
  treatmentPlanId: string;
}) {
  const [estado, setEstado] = useState<"idle" | "cargando" | "enviado" | "copiar" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);

  async function enviar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEstado("cargando");
    setMensaje(null);
    const r = await sendMensualidadReminder({ patientId, treatmentPlanId });
    if (isFailure(r)) {
      setEstado("error");
      setMensaje(r.error);
      return;
    }
    setTexto(r.data.texto);
    if (r.data.enviado) {
      setEstado("enviado");
    } else {
      setEstado("copiar");
      setMensaje(r.data.motivoNoEnviado ?? null);
    }
  }

  async function copiar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setMensaje("Copiado.");
    } catch {
      setMensaje("No se pudo copiar. Selecciona el texto a mano.");
    }
  }

  if (estado === "enviado") {
    return (
      <span className={s.notaExito} role="status">
        <Check size={14} strokeWidth={2.2} aria-hidden />
        Recordatorio enviado
      </span>
    );
  }

  return (
    <>
      <ButtonNew
        type="button"
        variant="secondary"
        size="sm"
        icon={
          estado === "copiar" ? (
            <Copy size={14} strokeWidth={1.9} aria-hidden />
          ) : (
            <Send size={14} strokeWidth={1.9} aria-hidden />
          )
        }
        onClick={estado === "copiar" ? copiar : enviar}
        disabled={estado === "cargando"}
      >
        {estado === "cargando" ? "Enviando…" : estado === "copiar" ? "Copiar texto" : "Enviar recordatorio"}
      </ButtonNew>
      {mensaje && (
        <span
          className={estado === "error" ? `${s.nota} ${s.notaPeligro}` : s.nota}
          style={{ maxWidth: 220 }}
          role={estado === "error" ? "alert" : "status"}
        >
          {mensaje}
        </span>
      )}
    </>
  );
}
