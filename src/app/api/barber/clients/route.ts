import { NextResponse } from "next/server";
import {
  createOrLinkBarberClient,
  listBarberClients,
  toBarberClientDTO,
  type BarberClientListFilter,
} from "@/lib/barber/clients";
import { gateBarberClients, readJson, serverError } from "./_helpers";

export const dynamic = "force-dynamic";

const FILTERS: BarberClientListFilter[] = ["all", "birthday", "inactive", "blocked", "reward"];

/** GET /api/barber/clients?q=&filter=&page=&month= — lista de la barbería. */
export async function GET(req: Request) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const rawFilter = url.searchParams.get("filter") ?? "all";
    const filter = (FILTERS as string[]).includes(rawFilter)
      ? (rawFilter as BarberClientListFilter)
      : "all";
    const page = Number(url.searchParams.get("page") ?? "1");
    const month = Number(url.searchParams.get("month") ?? "0");

    const result = await listBarberClients(gate.ctx, {
      search: url.searchParams.get("q") ?? "",
      filter,
      page: Number.isFinite(page) ? page : 1,
      month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return serverError("list", e);
  }
}

/**
 * POST /api/barber/clients — alta de cliente.
 * El teléfono es único por barbería: si ya existe, VINCULA (created:false)
 * en vez de duplicar. Es lo correcto en un mostrador.
 */
export async function POST(req: Request) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const result = await createOrLinkBarberClient(gate.ctx, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
    }
    return NextResponse.json(
      { client: toBarberClientDTO(result.client), created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (e) {
    return serverError("create", e);
  }
}
