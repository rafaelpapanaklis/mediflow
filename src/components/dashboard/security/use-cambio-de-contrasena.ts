"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

/**
 * Cambio VOLUNTARIO de la contraseña propia: el de Configuración → Seguridad y
 * el de Mi perfil (repaso iPad ws1-t1, m7). Una sola lógica para las dos
 * pantallas; cada una pone su marcado.
 *
 * Pide la contraseña ACTUAL y va por el servidor (revisión ws1-t9, m1):
 * POST /api/auth/change-password la comprueba, exige la sede desbloqueada y el
 * 2FA superado, y cambia la contraseña con la sesión de quien está dentro.
 * El navegador ya no cambia la contraseña por su cuenta en Supabase: así no la
 * cambia cualquiera que encuentre una sesión abierta. Los mensajes llegan del
 * servidor, en español.
 */
export function useCambioDeContrasena(origen: string) {
  const t = useT();
  const [form, setForm] = useState({ actual: "", next: "", confirm: "" });
  const [guardando, setGuardando] = useState(false);

  async function cambiar() {
    if (!form.actual) { toast.error(t("settings.client.pwCurrentMissingToast")); return; }
    if (form.next !== form.confirm) { toast.error(t("settings.client.pwMismatchToast")); return; }
    if (form.next.length < 8) { toast.error(t("settings.client.pwMinLengthToast")); return; }
    setGuardando(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.actual, password: form.next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data?.error === "string" && data.error ? data.error : t("settings.client.pwError.otro"));
        // Sin sesión no hay nada que reintentar: a entrar otra vez.
        if (res.status === 401 && data?.code === "sin_sesion") window.location.href = "/login";
        return;
      }
      toast.success(t("settings.client.pwUpdatedToast"));
      setForm({ actual: "", next: "", confirm: "" });
    } catch (e: unknown) {
      console.error(`[${origen}] cambio de contraseña falló:`, e);
      toast.error(t("settings.client.pwError.otro"));
    } finally { setGuardando(false); }
  }

  return { form, setForm, guardando, cambiar };
}
