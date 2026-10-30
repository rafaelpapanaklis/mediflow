"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { leerErrorContrasena } from "@/lib/auth/errores-contrasena";

/**
 * Cambio VOLUNTARIO de la contraseña propia: el de Configuración → Seguridad y
 * el de Mi perfil (repaso iPad ws1-t1, m7: un rol sin `settings.view` —
 * recepción, solo lectura— no tenía dónde cambiarla). Una sola lógica para las
 * dos pantallas; cada una pone su marcado.
 *
 * Va directo a Supabase con la sesión del navegador (`updateUser`): solo puede
 * tocar la cuenta de quien está dentro, y las dos pantallas viven tras el
 * layout de /dashboard, así que el 2FA y la clave de la sede ya se pasaron.
 */
export function useCambioDeContrasena(origen: string) {
  const t = useT();
  const [form, setForm] = useState({ next: "", confirm: "" });
  const [guardando, setGuardando] = useState(false);

  async function cambiar() {
    if (form.next !== form.confirm) { toast.error(t("settings.client.pwMismatchToast")); return; }
    if (form.next.length < 8) { toast.error(t("settings.client.pwMinLengthToast")); return; }
    setGuardando(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: form.next });
      if (error) throw error;
      toast.success(t("settings.client.pwUpdatedToast"));
      setForm({ next: "", confirm: "" });
    } catch (e: unknown) {
      // Supabase contesta en inglés; su message nunca se enseña. El motivo se
      // traduce con el diccionario para que salga en el idioma del panel.
      const deContrasena = leerErrorContrasena(e);
      if (!deContrasena) console.error(`[${origen}] cambio de contraseña falló:`, e);
      toast.error(
        deContrasena
          ? t(`settings.client.pwError.${deContrasena.motivo}`, { min: deContrasena.minimo ?? 8 })
          : t("settings.client.pwError.otro"),
      );
    } finally { setGuardando(false); }
  }

  return { form, setForm, guardando, cambiar };
}
