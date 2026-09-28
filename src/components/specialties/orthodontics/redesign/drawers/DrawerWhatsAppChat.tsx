"use client";
// DrawerWhatsAppChat — vista read-only del thread WhatsApp del paciente.
// El input de envío está disabled · explica que Twilio es necesario para
// envío real. Lectura/historial NO requiere servicio externo.

import { Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import orto from "../orto.module.css";

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  preview: string;
  at: string;
  patientName?: string;
}

export interface DrawerWhatsAppChatProps {
  patientName: string;
  messages: ChatMessage[];
  onClose: () => void;
}

export function DrawerWhatsAppChat(props: DrawerWhatsAppChatProps) {
  const ordered = [...props.messages].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside className={`${orto.cajon} ${orto.cajonEstrecho}`} role="dialog" aria-modal="true">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>WhatsApp</div>
            <h3 className={orto.cajonTitulo}>Chat con {props.patientName}</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[color:var(--pr-tarjeta-2)]">
          {ordered.length === 0 ? (
            <div className="text-center text-[13px] text-[color:var(--pr-texto-3)] italic py-6">Sin mensajes en este thread.</div>
          ) : null}
          {ordered.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-[10px] text-[13px] ${m.direction === "out" ? "bg-[color:var(--pr-exito-suave)] text-[color:var(--pr-exito)]" : "bg-[color:var(--pr-tarjeta)] border border-[color:var(--pr-borde)] text-[color:var(--pr-texto)]"}`}>
                <div className="text-[11px] uppercase tracking-wider opacity-60 mb-0.5">
                  {m.direction === "out" ? "DaleControl → paciente" : (m.patientName ?? "Paciente")} · {m.at}
                </div>
                <div className="leading-relaxed">{m.preview}</div>
              </div>
            </div>
          ))}
        </div>
        <footer className="px-4 py-3 border-t border-[color:var(--pr-borde-suave)]">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              disabled
              placeholder="Envío de mensajes · WhatsApp con Twilio · contratar para activar"
              className={`${orto.entrada} flex-1`}
            />
            <Btn variant="emerald" size="md" icon={<Send className="w-3.5 h-3.5" aria-hidden />} disabled>
              Enviar
            </Btn>
          </div>
          <div className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1">
            <Shield className="w-3 h-3" aria-hidden />
            Lectura del historial activa · envío bidireccional requiere Twilio API
          </div>
        </footer>
      </aside>
    </>
  );
}
