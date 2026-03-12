import type { Metadata } from "next";
import { LoginForm } from "@/components/public/login-form";

export const metadata: Metadata = { title: "Iniciar sesión — MediFlow" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 mb-8">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white text-xs font-extrabold">M</div>
            MediFlow
          </div>
          <h1 className="text-2xl font-extrabold text-foreground mb-1">Bienvenido de vuelta</h1>
          <p className="text-sm text-muted-foreground mb-7">Ingresa a tu panel de control</p>
          <LoginForm />
        </div>
      </div>
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 px-12">
        <div className="text-white max-w-xs text-center">
          <div className="text-5xl mb-6">🏥</div>
          <h2 className="text-2xl font-extrabold mb-3">+2,400 clínicas confían en MediFlow</h2>
          <p className="text-white/70 text-sm leading-relaxed">Gestiona todo tu consultorio desde un solo panel. Citas, pacientes, expedientes y cobros.</p>
        </div>
      </div>
    </div>
  );
}
