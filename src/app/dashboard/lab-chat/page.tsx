import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/laboratorios/chat/chat-workspace";

export const metadata: Metadata = { title: "Mensajes con laboratorios" };

// Inbox de chat de la clínica: lista todas las conversaciones con laboratorios
// (entrada desde el sidebar). Sin initialLabId el workspace solo muestra la
// bandeja; cada hilo se abre al hacer click. El deep-link por laboratorio
// (abrir/crear hilo al entrar) vive en la ruta hermana [labId].
export default function LabChatInboxPage() {
  return <ChatWorkspace side="CLINIC" />;
}
