"use client";
// Configuración → Anticipos → «Cobro automático con tarjeta» (ws1-t6).
//
// El interruptor por clínica, APAGADO de fábrica (decisión de Rafael: todo
// manual). Solo se pinta con la cuenta de Mercado Pago conectada; sin el SQL
// pegado se calla del todo (no hay nada que encender). Se guarda en cuanto se
// mueve, como el del pago en línea del portal.

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import toast from "react-hot-toast";
import { Aviso, FilaInterruptor, Insignia, Seccion } from "@/components/dashboard/configuracion-rediseno/piezas";
import type { EstadoConfig } from "@/lib/cobro-automatico/servicio.server";
import { useTextosCobroAutomatico } from "./textos";

export function SeccionCobroAutomatico({ cuentaConectada }: { cuentaConectada: boolean }) {
  const t = useTextosCobroAutomatico();
  const [estado, setEstado] = useState<EstadoConfig | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!cuentaConectada) return;
    let vivo = true;
    fetch("/api/cobro-automatico/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EstadoConfig | null) => vivo && setEstado(d))
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, [cuentaConectada]);

  if (!cuentaConectada || !estado || !estado.conectado || !estado.tablas) return null;

  async function cambiar(siguiente: boolean) {
    setGuardando(true);
    try {
      const r = await fetch("/api/cobro-automatico/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: siguiente }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        toast.error(d?.error ?? t.error);
        return;
      }
      setEstado(d);
      toast.success(t.guardado);
    } catch {
      toast.error(t.error);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Seccion
      icono={<Repeat size={18} strokeWidth={1.75} aria-hidden />}
      titulo={t.configTitulo}
      subtitulo={t.configSubtitulo}
      extra={estado.encendido ? <Insignia tono="exito" punto>{t.insigniaEncendido}</Insignia> : <Insignia>{t.insigniaApagado}</Insignia>}
      nota={estado.vivos > 0 ? <Aviso tono="info">{t.vivos(estado.vivos)}</Aviso> : undefined}
    >
      <FilaInterruptor
        titulo={t.interruptor}
        descripcion={
          <>
            {t.interruptorAyuda} {t.avisoWebhook}
          </>
        }
        activo={estado.encendido}
        onCambiar={cambiar}
        disabled={guardando}
      />
    </Seccion>
  );
}
