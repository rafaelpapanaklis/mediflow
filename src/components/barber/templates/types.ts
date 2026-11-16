/* ═══════════════════════════════════════════════════════════════════════
   LO QUE RECIBE UNA PLANTILLA.

   Esta forma es el CONTRATO entre la página pública y las ocho plantillas.
   La arma dos veces:
     · el servidor, en /b/[slug] (src/app/b/[slug]/_shared/shop-data.ts), y
     · el editor, en el navegador, para la vista previa en vivo.
   Las dos tienen que producir exactamente la misma forma; por eso está
   escrita aquí y no dentro de ninguna de las dos.

   🛡️ SUPERFICIE PÚBLICA — lo que entre aquí se sirve SIN sesión, cacheado
   por ISR y legible con "ver código fuente". Solo campos públicos:
   nombre, slug, teléfono, dirección y logo de la barbería; nombre, foto y
   bio de cada barbero; nombre, duración y precio de cada servicio. NADA
   de tokens, ids de Stripe, correos, plan ni estado de suscripción. Un
   campo nuevo se agrega aquí Y en el `select` del cargador — nunca al
   revés, y nunca con `include`.

   Sin "use client": lo leen el editor y la página pública.
   ═══════════════════════════════════════════════════════════════════════ */

import type { BarberWebConfig, BarberWebManifest } from "@/lib/barber/landing";

/** La barbería, SOLO con lo que se enseña en su página. */
export interface BarberWebShop {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
}

/** Un servicio del catálogo (BarberService). El precio SIEMPRE de la tabla. */
export interface BarberWebServicio {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  /** Pesos, ya convertido desde el Decimal de Prisma. */
  precio: number;
  categoria: string;
}

/** Un barbero (Barber). `bio` es lo que la barbería escribió de él. */
export interface BarberWebBarbero {
  id: string;
  nombre: string;
  apodo: string | null;
  fotoUrl: string | null;
  bio: string | null;
  /** true = activo pero sin un solo turno: sale en el equipo sin «Reservar». */
  sinHorario?: boolean;
}

/** Un producto destacado en la página (solo lo público: sin costo ni existencias exactas). */
export interface BarberWebProducto {
  id: string;
  nombre: string;
  precio: number;
  fotoUrl: string | null;
  categoria: string | null;
  url: string;
  agotado: boolean;
}

export interface BarberWebData {
  shop: BarberWebShop;
  config: BarberWebConfig;
  manifest: BarberWebManifest;
  servicios: BarberWebServicio[];
  barberos: BarberWebBarbero[];
  /**
   * La sección «Tienda» (ws6-t1): productos marcados «Mostrar en mi
   * página», hasta 4. Vacío o ausente = ni sección ni «Tienda» en el menú.
   * Los carga la página pública y, para la vista previa, Mi web.
   */
  productos?: BarberWebProducto[];
  /** Liga a /b/<slug>/tienda (solo si hay productos). */
  tiendaUrl?: string | null;
  /**
   * Liga a /b/<slug>/mi-cuenta (sus citas y estrellas). Solo con WhatsApp
   * conectado: la entrada es con un código por WhatsApp.
   */
  cuentaUrl?: string | null;
  /**
   * Liga a /b/<slug>/mi-tarjeta («Mi tarjeta» de estrellas, ws6-t2). Solo si
   * la barbería usa estrellas. Es una liga fija: no lleva ningún dato del
   * cliente (la tarjeta se pide con el teléfono y llega por WhatsApp).
   */
  tarjetaUrl?: string | null;
  /**
   * true = se está pintando dentro del editor.
   *
   * Lo usan las plantillas para NO ocultar una sección vacía: la barbería
   * que todavía no sube fotos necesita ver dónde van a caer. En público es
   * siempre false y la sección vacía no se pinta.
   */
  editando?: boolean;
}

export type BarberWebTemplateComponent = (props: { data: BarberWebData }) => React.JSX.Element;
