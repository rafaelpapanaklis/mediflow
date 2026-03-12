import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard — MediFlow" };

export default function SubPage() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center">
        <div className="text-4xl mb-4">🚧</div>
        <h1 className="text-xl font-bold mb-2">Módulo del dashboard</h1>
        <p className="text-sm text-gray-500">Implementado completamente en Parte 2.</p>
      </div>
    </div>
  );
}
