import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/suppliers/chat/chat-workspace";

export const metadata: Metadata = { title: "Chat con proveedor" };

// Chat clínica ↔ proveedor (dentro de /dashboard). El layout del dashboard
// ya valida la sesión de clínica. El [supplierId] de la URL es el proveedor
// con el que se abre/crea el hilo al entrar (deep-link desde el browse/ficha
// de proveedores de T2); el workspace también lista el resto de los hilos.
export default function ProveedorChatPage({ params }: { params: { supplierId: string } }) {
  return <ChatWorkspace side="CLINIC" initialSupplierId={params.supplierId} />;
}
