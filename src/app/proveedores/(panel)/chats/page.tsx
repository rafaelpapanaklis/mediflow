import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/suppliers/chat/chat-workspace";

export const metadata: Metadata = { title: "Chats" };

// Bandeja de chats del proveedor (panel). El layout (panel) ya valida la
// sesión de proveedor y que esté APPROVED; aquí solo montamos el workspace
// en modo proveedor. Lista los hilos que las clínicas iniciaron y responde.
export default function SupplierChatsPage() {
  return <ChatWorkspace side="SUPPLIER" />;
}
