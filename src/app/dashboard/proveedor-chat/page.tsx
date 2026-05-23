import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/suppliers/chat/chat-workspace";

export const metadata: Metadata = { title: "Mensajes con proveedores" };

// Inbox de chat de la clínica: lista todas las conversaciones con proveedores
// (entrada desde el sidebar). Sin initialSupplierId el workspace solo muestra
// la bandeja; cada hilo se abre al hacer click. El deep-link por proveedor
// (abrir/crear hilo al entrar) vive en la ruta hermana [supplierId].
export default function ProveedorChatInboxPage() {
  return <ChatWorkspace side="CLINIC" />;
}
