import "server-only";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { destinoModuloVencidoSegun, seOcultaMarketplace } from "./destino";

// El MISMO interruptor por clínica que el resto del rediseño. No añade un viaje
// a la base: la respuesta vive 60 s en memoria y el layout ya la pidió en esta
// misma carga. El `clinicId` viene de la sesión de quien llama, nunca del cliente.

/** ¿Esta clínica ya no debe ser mandada a Marketplace? */
export async function marketplaceOcultoPara(clinicId: string): Promise<boolean> {
  return seOcultaMarketplace(await menuDosNivelesEncendido(clinicId));
}

/** A dónde redirigir cuando el módulo de especialidad `moduleKey` venció. */
export async function destinoModuloVencido(clinicId: string, moduleKey: string): Promise<string> {
  return destinoModuloVencidoSegun(await menuDosNivelesEncendido(clinicId), moduleKey);
}
