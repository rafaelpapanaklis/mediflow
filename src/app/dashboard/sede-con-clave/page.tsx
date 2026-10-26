import { redirect } from "next/navigation";
import { getCurrentUserSinClaveDeSede, getUserClinics } from "@/lib/auth";
import { sedeCerradaPara } from "@/lib/sede-clave/gate.server";
import { destinoSeguro } from "@/lib/sede-clave/core";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { RaizCuenta } from "@/components/dashboard/cuenta-rediseno/raiz";
import { PantallaSedeConClave } from "@/components/dashboard/sede-clave/pantalla-sede-con-clave";

export const dynamic = "force-dynamic";

/**
 * «Esta sede tiene clave» (ws1-t4).
 *
 * Llega aquí:
 *   · el layout, cuando la sede ACTIVA tiene clave y este navegador no la ha
 *     tecleado (tras el login, al caducar las 72 h o si la cambiaron): se
 *     pinta con el layout mínimo, sin el panel de la sede detrás;
 *   · el selector de sedes, con `?sede=<id>`, cuando /api/switch-clinic dice
 *     423: la sede activa sigue siendo la de antes (y su panel se ve alrededor).
 *
 * Usa getCurrentUserSinClaveDeSede: con el 2FA exigido, sin el gate de la clave
 * (esta pantalla ES la clave). `?sede=` solo vale si la persona tiene ficha
 * activa en esa sede (getUserClinics, de la sesión); si no, se ignora.
 */
export default async function SedeConClavePage(props: { searchParams: Promise<{ sede?: string; next?: string }> }) {
  const sp = await props.searchParams;
  const user = await getCurrentUserSinClaveDeSede();
  const sedes = await getUserClinics();

  const pedida = typeof sp?.sede === "string" ? sedes.find((s) => s.clinicId === sp.sede) : undefined;
  const sede = pedida ?? sedes.find((s) => s.clinicId === user.clinicId);
  const clinicId = sede?.clinicId ?? user.clinicId;
  const nombre = sede?.clinicName ?? (user.clinic as { name?: string } | null)?.name ?? "";
  const next = destinoSeguro(sp?.next);

  const cerrada = await sedeCerradaPara({ supabaseId: user.supabaseId, clinicId });
  const esLaActiva = clinicId === user.clinicId;
  // Nada que pedir: la activa ya está abierta → al panel. Una hermana abierta
  // (desbloqueo vigente, o le quitaron la clave) se ofrece con un botón que
  // cambia de sede como el selector.
  if (!cerrada && esLaActiva) redirect(next);

  const otras = sedes
    .filter((s) => s.clinicId !== clinicId)
    .map((s) => ({ clinicId: s.clinicId, clinicName: s.clinicName }));

  const pantalla = (
    <PantallaSedeConClave
      clinicId={clinicId}
      nombre={nombre}
      esLaActiva={esLaActiva}
      abierta={!cerrada}
      otras={otras}
      next={next}
    />
  );

  // Mismo interruptor que el resto de barreras (2FA, contraseña): con el
  // rediseño encendido, la raíz la viste con los tokens del menú.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return rediseno ? <RaizCuenta barrera>{pantalla}</RaizCuenta> : pantalla;
}
