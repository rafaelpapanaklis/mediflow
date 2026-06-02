import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/laboratorios/chat/chat-workspace";

export const metadata: Metadata = { title: "Chat con laboratorio" };

// Chat clínica ↔ laboratorio (dentro de /dashboard). El layout del dashboard
// ya valida la sesión de clínica. El [labId] de la URL es el laboratorio con
// el que se abre/crea el hilo al entrar (deep-link desde el browse/ficha de
// laboratorios de la clínica); el workspace también lista el resto de los hilos.
export default function LabChatPage({ params }: { params: { labId: string } }) {
  return <ChatWorkspace side="CLINIC" initialLabId={params.labId} />;
}
