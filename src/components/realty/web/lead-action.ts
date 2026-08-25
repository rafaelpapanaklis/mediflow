"use server";

/* ═══════════════════════════════════════════════════════════════════════
   EL PROSPECTO QUE ENTRA POR LA WEB PÚBLICA.

   Este archivo es el ÚNICO camino por el que un desconocido escribe en la
   base del vertical, así que todo lo de aquí es defensivo.

   ── DE DÓNDE SALE EL accountId ────────────────────────────────────
   🔴 DEL SLUG DE LA URL, resuelto contra la base. JAMÁS del formulario.
   El contrato del vertical lo dice con todas sus letras: "lo público jamás
   recibe un accountId del request". Si el cliente pudiera mandarlo, el
   formulario de una inmobiliaria metería prospectos en el CRM de otra.

   ── QUÉ SE CREA ──────────────────────────────────────────────────
   Un RealtyContact (la persona) + un RealtyLead (su paso por el embudo) +
   una RealtyLeadActivity con el mensaje. `source` vive en el CONTACTO, no
   en el lead: el lead tiene `portal`, que es otra cosa (de qué portal vino
   el anuncio). Los dos valores que usa la web son "web" y "letrero" — el
   segundo es el del QR del letrero de la reja, que es el canal número uno
   en México y del que nadie mide nada.

   ── LO QUE NO HACE ───────────────────────────────────────────────
   No manda WhatsApp (eso es de otra terminal), no asigna round-robin y no
   toca firstResponseAt: ese reloj lo arranca quien CONTESTA, no quien
   recibe.

   Un archivo "use server" completo: solo server actions, nada más
   exportado. Lo importa un componente cliente y por eso no puede exportar
   constantes ni tipos (Next lo prohíbe en un módulo de acciones).
   ═══════════════════════════════════════════════════════════════════════ */

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { rateLimitKey } from "@/lib/rate-limit";

interface EntradaProspecto {
  /** Slug de la cuenta, de la URL pública. NUNCA un accountId. */
  slug: string;
  nombre: string;
  telefono: string;
  correo?: string;
  mensaje?: string;
  /** publicUrlSlug o id del inmueble que estaba viendo. */
  inmueble?: string;
  /** publicSlug del asesor cuya página lo trajo (atribución del lead). */
  agente?: string;
  /** "web" (el formulario) o "letrero" (llegó escaneando el QR de la reja). */
  fuente?: string;
}

/**
 * Un solo objeto y NO una unión discriminada `{ok:true} | {ok:false,error}`:
 * el tsconfig del repo tiene `strict: false`, y sin strictNullChecks TypeScript
 * no estrecha la unión en la rama `else` — el componente cliente vería
 * "Property 'error' does not exist" y habría que castear.
 */
type Resultado = { ok: boolean; error?: string };

const ERROR_GENERICO = "No pudimos enviar tu mensaje. Inténtalo de nuevo en un momento.";

/** ¿La tabla del vertical todavía no existe en Supabase? */
function tablaSinCrear(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2010";
}

function limpiar(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

/**
 * Recibe el formulario público y crea el prospecto en el CRM.
 *
 * Devuelve `{ ok:false, error }` con un texto ya escrito para el visitante:
 * nunca el mensaje de Prisma, que diría el nombre de la tabla y la columna.
 */
export async function enviarProspectoWeb(entrada: EntradaProspecto): Promise<Resultado> {
  const slug = limpiar(entrada?.slug, 120).toLowerCase();
  const nombre = limpiar(entrada?.nombre, 80);
  const telefono = mxTenDigits(entrada?.telefono);
  const correo = limpiar(entrada?.correo, 120).toLowerCase();
  const mensaje = limpiar(entrada?.mensaje, 900);
  const inmuebleRef = limpiar(entrada?.inmueble, 120);
  const agenteRef = limpiar(entrada?.agente, 120);
  // Cualquier otra cosa cae a "web": `source` es texto libre en la base y
  // es lo que después se cruza en los reportes. Dejar pasar lo que mande el
  // navegador convertiría esa columna en un basurero.
  const fuente = entrada?.fuente === "letrero" ? "letrero" : "web";

  if (!slug) return { ok: false, error: ERROR_GENERICO };
  if (nombre.length < 2) return { ok: false, error: "Escribe tu nombre." };
  if (!telefono) return { ok: false, error: "Escribe tu WhatsApp a 10 dígitos." };

  // Freno de spam por IP. En memoria y por instancia: no es una muralla,
  // pero corta el envío repetido de un formulario abierto a la calle.
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (!rateLimitKey(`realty-lead:${ip}`, 6, 60_000)) {
    return { ok: false, error: "Espera un minuto antes de volver a enviar." };
  }
  // Y un segundo freno por TELÉFONO: el mismo número no puede sembrar
  // veinte prospectos en veinte fichas distintas en un minuto.
  if (!rateLimitKey(`realty-lead-tel:${telefono}`, 4, 60_000)) {
    return { ok: false, error: "Ya recibimos tu mensaje. Te contactamos en breve." };
  }

  try {
    const cuenta = await prisma.realtyAccount.findUnique({
      where: { slug },
      select: {
        id: true,
        isActive: true,
        landingConfig: { select: { published: true } },
      },
    });
    if (!cuenta || !cuenta.isActive) return { ok: false, error: ERROR_GENERICO };
    // El formulario no se pinta si la web está apagada, pero una server
    // action se puede invocar directamente: sin esto, alguien sembraría
    // prospectos en el CRM de una cuenta que apagó su página a propósito.
    // Sin fila = publicada (la promesa del plan más barato).
    if (cuenta.landingConfig && !cuenta.landingConfig.published) {
      return { ok: false, error: ERROR_GENERICO };
    }
    const accountId = cuenta.id;

    // El inmueble: se acepta el slug público O el id, porque un letrero
    // impreso con el id sigue funcionando después de ponerle slug. Y SIEMPRE
    // recortado a esta cuenta: sin ese filtro, el id de un inmueble ajeno
    // ligaría el prospecto al CRM equivocado.
    let propertyId: string | null = null;
    if (inmuebleRef) {
      const inm = await prisma.realtyProperty.findFirst({
        where: {
          accountId,
          isPublished: true,
          OR: [{ publicUrlSlug: inmuebleRef }, { id: inmuebleRef }],
        },
        select: { id: true },
      });
      propertyId = inm?.id ?? null;
    }

    // El asesor: la atribución del lead a la página que lo trajo. El AND de
    // los dos interruptores es el mismo que decide si su ficha se pinta.
    let assignedUserId: string | null = null;
    if (agenteRef) {
      const perfil = await prisma.realtyAgentProfile.findFirst({
        where: {
          accountId,
          publicSlug: agenteRef,
          active: true,
          realtyUser: { active: true, publicProfileEnabled: true },
        },
        select: { realtyUserId: true },
      });
      assignedUserId = perfil?.realtyUserId ?? null;
    }

    // El contacto se REUSA si ya existe con ese teléfono en la cuenta: si no,
    // el mismo interesado preguntando por tres casas sale tres veces en la
    // libreta y el asesor no ve que es la misma persona.
    const existente = await prisma.realtyContact.findFirst({
      where: { accountId, phone: telefono },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    const contactId =
      existente?.id ??
      (
        await prisma.realtyContact.create({
          data: {
            accountId,
            name: nombre,
            phone: telefono,
            email: correo || null,
            kind: "PROSPECTO",
            source: fuente,
            assignedUserId,
          },
          select: { id: true },
        })
      ).id;

    const lead = await prisma.realtyLead.create({
      data: {
        accountId,
        contactId,
        propertyId,
        portal: "propio",
        stage: "NUEVO",
        assignedUserId,
        // assignedAt solo si de verdad hay a quién: un sello de asignación
        // sin asesor deja el embudo diciendo que alguien lo está trabajando.
        assignedAt: assignedUserId ? new Date() : null,
      },
      select: { id: true },
    });

    if (mensaje) {
      await prisma.realtyLeadActivity.create({
        data: { accountId, leadId: lead.id, kind: "NOTA", note: mensaje },
      });
    }

    return { ok: true };
  } catch (e) {
    if (tablaSinCrear(e)) {
      return { ok: false, error: "El formulario todavía no está disponible. Escríbenos por WhatsApp." };
    }
    console.error("[realty-web] no se pudo crear el prospecto:", e);
    return { ok: false, error: ERROR_GENERICO };
  }
}
