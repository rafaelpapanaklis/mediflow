"use client";
// DrawerWhatsAppChat — vista read-only del thread WhatsApp del paciente.
// El input de envío está disabled · explica que Twilio es necesario para
// envío real. Lectura/historial NO requiere servicio externo.

import { Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

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
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800" role="dialog" aria-modal="true">
        <header className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-emerald-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-300">WhatsApp · M5</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">Chat con {props.patientName}</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50 dark:bg-slate-950/30">
          {ordered.length === 0 ? (
            <div className="text-center text-sm text-slate-500 italic py-6 dark:text-slate-400">Sin mensajes en este thread.</div>
          ) : null}
          {ordered.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${m.direction === "out" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-white border border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"}`}>
                <div className="text-[10px] uppercase tracking-wider opacity-60 mb-0.5">
                  {m.direction === "out" ? "MediFlow → paciente" : (m.patientName ?? "Paciente")} · {m.at}
                </div>
                <div className="leading-relaxed">{m.preview}</div>
              </div>
            </div>
          ))}
        </div>
        <footer className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              disabled
              placeholder="Envío de mensajes · WhatsApp con Twilio · contratar para activar"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500"
            />
            <Btn variant="emerald" size="md" icon={<Send className="w-3.5 h-3.5" aria-hidden />} disabled>
              Enviar
            </Btn>
          </div>
          <div className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400">
            <Shield className="w-3 h-3" aria-hidden />
            Lectura del historial activa · envío bidireccional requiere Twilio API
          </div>
        </footer>
      </aside>
    </>
  );
}
