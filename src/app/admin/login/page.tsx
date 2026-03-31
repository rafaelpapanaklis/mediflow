import type { Metadata } from "next";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { title: "Admin — MediFlow" };

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center text-white font-extrabold text-xl mx-auto mb-4">M</div>
          <h1 className="text-xl font-extrabold text-white">Panel de Administración</h1>
          <p className="text-slate-400 text-sm mt-1">Acceso restringido</p>
        </div>
        <AdminLoginForm />
      </div>
    </div>
  );
}
