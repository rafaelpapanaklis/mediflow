import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/laboratorios/chat/chat-workspace";

export const metadata: Metadata = { title: "Chats" };

// Bandeja de chats del laboratorio (panel). El layout (panel) ya valida la
// sesión de laboratorio y que esté APPROVED; aquí solo montamos el workspace
// en modo laboratorio. Lista los hilos que las clínicas iniciaron y responde.
export default function LabChatsPage() {
  return <ChatWorkspace side="LAB" />;
}
