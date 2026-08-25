import { NextResponse } from "next/server";
import {
  deleteRealtyProperty,
  getRealtyProperty,
  propertyStoragePaths,
  updateRealtyPropertyRelations,
  updateRealtyPropertySection,
  type RealtyPropertyInput,
  type RealtyPropertySection,
} from "@/lib/realty/properties";
import { addRealtyStorageBytes, removeRealtyFiles } from "@/lib/realty/media";
import {
  enumParam,
  gateRealty,
  notFound,
  readJson,
  realtyApiError,
} from "../_helpers";

export const dynamic = "force-dynamic";

const SECTIONS = [
  "basicos",
  "precio",
  "medidas",
  "amenidades",
  "ubicacion",
  "propietario",
  "notas",
  "publicacion",
] as const;

const KINDS = [
  "CASA",
  "DEPARTAMENTO",
  "TERRENO",
  "BODEGA",
  "LOCAL",
  "EDIFICIO",
  "OFICINA",
  "RANCHO",
] as const;
const OPERATIONS = ["VENTA", "RENTA", "AMBAS"] as const;
const STATUSES = ["DISPONIBLE", "APARTADO", "VENDIDO", "RENTADO"] as const;
const CURRENCIES = ["MXN", "USD"] as const;

/** Número del body, o undefined si no vino (≠ vino null, que sí borra). */
function optNum(body: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function optText(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  return typeof v === "string" ? v : null;
}

/** GET — la ficha completa (con fotos, recorridos y documentos ya firmados). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.view");
  if ("response" in gate) return gate.response;
  try {
    const property = await getRealtyProperty(gate.ctx, params.id);
    if (!property) return notFound();
    return NextResponse.json({ property });
  } catch (e) {
    return realtyApiError("properties/[id]:GET", e);
  }
}

/**
 * PATCH — guardado POR SECCIÓN.
 *
 * El cliente manda `section` y SOLO los campos de esa tarjeta. Así dos
 * pestañas abiertas en el mismo inmueble no se pisan lo que la otra no
 * tocó, que es exactamente lo que hace un formulario con un botón único.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const section = enumParam(body.section, SECTIONS) as RealtyPropertySection | null;
    if (!section) {
      return NextResponse.json({ error: "Sección desconocida." }, { status: 400 });
    }

    // La sección de propietario/asesor son RELACIONES: updateMany no sabe
    // de connect/disconnect, así que va por su propia función (que
    // comprueba la pertenencia igual de estricto).
    if (section === "propietario") {
      const result = await updateRealtyPropertyRelations(
        gate.ctx,
        params.id,
        "ownerId" in body ? (typeof body.ownerId === "string" ? body.ownerId : null) : undefined,
        "assignedUserId" in body
          ? typeof body.assignedUserId === "string"
            ? body.assignedUserId
            : null
          : undefined,
      );
      if (!result.ok) {
        if (result.reason === "bad_owner") {
          return NextResponse.json(
            { error: "Ese propietario ya no está en tu libreta.", field: "ownerId" },
            { status: 400 },
          );
        }
        if (result.reason === "bad_agent") {
          return NextResponse.json(
            { error: "Ese asesor ya no está activo en tu equipo.", field: "assignedUserId" },
            { status: 400 },
          );
        }
        return notFound();
      }
      return NextResponse.json({ ok: true });
    }

    const input: RealtyPropertyInput = {};

    if (section === "basicos") {
      const kind = enumParam(body.kind, KINDS);
      if (kind) input.kind = kind;
      const operation = enumParam(body.operation, OPERATIONS);
      if (operation) input.operation = operation;
      const status = enumParam(body.status, STATUSES);
      if (status) input.status = status;
      const title = optText(body, "title");
      if (title !== undefined) {
        if (!title || !title.trim()) {
          return NextResponse.json(
            { error: "Ponle un título al inmueble.", field: "title" },
            { status: 400 },
          );
        }
        input.title = title;
      }
      const description = optText(body, "description");
      if (description !== undefined) input.description = description;
    }

    if (section === "precio") {
      const price = optNum(body, "price");
      if (price !== undefined) input.price = price ?? 0;
      const rent = optNum(body, "rentPrice");
      if (rent !== undefined) input.rentPrice = rent;
      const currency = enumParam(body.currency, CURRENCIES);
      if (currency) input.currency = currency;
      const maint = optNum(body, "maintenanceFee");
      if (maint !== undefined) input.maintenanceFee = maint;
      const comm = optNum(body, "commissionPct");
      // Decimal(5,2) admite hasta 999.99, pero un porcentaje de comisión
      // por encima de 100 es siempre un dedazo: se recorta en vez de
      // guardarlo y que alguien reparta el 400 % de una venta.
      if (comm !== undefined) {
        input.commissionPct = comm === null ? null : Math.min(100, Math.max(0, comm));
      }
    }

    if (section === "medidas") {
      for (const key of [
        "landM2",
        "builtM2",
        "bedrooms",
        "bathrooms",
        "halfBathrooms",
        "parking",
        "ageYears",
        "levels",
      ] as const) {
        const v = optNum(body, key);
        if (v !== undefined) (input as Record<string, unknown>)[key] = v;
      }
    }

    if (section === "amenidades") {
      input.amenities = Array.isArray(body.amenities)
        ? body.amenities.filter((k): k is string => typeof k === "string").slice(0, 80)
        : [];
    }

    if (section === "ubicacion") {
      for (const key of ["address", "colonia", "city", "state", "zip"] as const) {
        const v = optText(body, key);
        if (v !== undefined) (input as Record<string, unknown>)[key] = v;
      }
      const lat = optNum(body, "lat");
      // Fuera de rango no es una coordenada: se guarda null antes que un
      // pin en mitad del vacío.
      if (lat !== undefined) input.lat = lat === null || Math.abs(lat) > 90 ? null : lat;
      const lng = optNum(body, "lng");
      if (lng !== undefined) input.lng = lng === null || Math.abs(lng) > 180 ? null : lng;
      if ("showExactAddress" in body) input.showExactAddress = body.showExactAddress === true;
    }

    if (section === "notas") {
      const notes = optText(body, "internalNotes");
      if (notes !== undefined) input.internalNotes = notes;
    }

    if (section === "publicacion") {
      if ("isPublished" in body) input.isPublished = body.isPublished === true;
    }

    const ok = await updateRealtyPropertySection(gate.ctx, params.id, section, input);
    if (!ok) return notFound();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]:PATCH", e);
  }
}

/**
 * DELETE — borra el inmueble Y sus archivos.
 *
 * 🔴 La fila se va por cascada, pero el objeto en Storage NO: sin este
 * barrido las fotos se quedan ocupando cupo para siempre y el contador de
 * la cuenta deja de cuadrar. Se leen los paths ANTES del delete (después ya
 * no hay filas de dónde sacarlos).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const paths = await propertyStoragePaths(gate.ctx, params.id);
    const result = await deleteRealtyProperty(gate.ctx, params.id);

    if (!result.ok) {
      if (result.reason === "has_exclusive") {
        return NextResponse.json(
          {
            error:
              "No se puede eliminar: el inmueble tiene una exclusiva firmada. Quítala primero.",
            code: "HAS_EXCLUSIVE",
          },
          { status: 409 },
        );
      }
      return notFound();
    }

    await removeRealtyFiles(paths);
    if (result.freedBytes > 0) {
      await addRealtyStorageBytes(gate.ctx.accountId, -result.freedBytes);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]:DELETE", e);
  }
}
