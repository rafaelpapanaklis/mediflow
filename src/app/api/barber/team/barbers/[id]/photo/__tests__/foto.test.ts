/* ═══════════════════════════════════════════════════════════════════════
   FOTO DEL BARBERO DESDE EL TELÉFONO — la ruta ENTERA, con dobles.

     cd "src/app/api/barber/team/barbers/[id]/photo/__tests__" && npx tsx --test foto.test.ts

   (Hay que lanzarla desde su carpeta: node trata los corchetes de `[id]`
   como un comodín de glob y desde la raíz no encuentra el archivo.)

   Se carga el route handler real. Los dobles son: la sesión y los permisos,
   la suscripción, el freno de subidas, Prisma (en memoria, con el `where`
   de verdad) y Supabase Storage (apunta qué se sube y qué se borra). Corren
   SIN cambios los validadores reales: tipo por bytes, sharp, 4 MB.

   Lo que se exige:
     · permiso `barbers.manage`, suscripción activa y freno de subidas;
     · el barbero es de una sede que la sesión alcanza (si no, 404 y NADA se sube);
     · la carpeta sale de la FILA del barbero, no del body;
     · al subir otra, se borra la anterior de ESE barbero y solo esa;
     · archivos falsos (texto con nombre .png, GIF, demasiado pesado) rechazados.
   ═══════════════════════════════════════════════════════════════════════ */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { objetoFotoAnterior, carpetaFotoBarbero } from "@/lib/barber/barber-photo";

// ── Estado de los dobles (lo reinicia beforeEach) ────────────────────────
const st = {
  session: true as boolean,
  allowed: true as boolean,
  paid: true as boolean,
  limited: false as boolean,
  dbFails: false as boolean,
  accessible: ["shopA", "shopB"] as string[],
  barbers: [] as Array<{ id: string; barbershopId: string; photoUrl: string | null; barbershop: { slug: string } }>,
  uploads: [] as string[],
  removed: [] as string[][],
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
};

class ForbiddenError extends Error {
  permission = "barbers.manage";
}
class GateError extends Error {
  status = 402;
  code = "SUBSCRIPTION_INACTIVE";
}

const PUBLIC_BASE = "https://x.supabase.co/storage/v1/object/public/clinic-public/";

const fakeStorage = {
  from: () => ({
    upload: async (objeto: string) => {
      st.uploads.push(objeto);
      return { error: null };
    },
    getPublicUrl: (objeto: string) => ({ data: { publicUrl: PUBLIC_BASE + objeto } }),
    remove: async (objetos: string[]) => {
      st.removed.push(objetos);
      return { error: null };
    },
  }),
};

// La raíz del repo sale de la ubicación de ESTE archivo (nueve carpetas arriba),
// no del cwd: `[id]` en la ruta obliga a lanzar la prueba desde su carpeta.
const root = path.resolve(__dirname, "../".repeat(9));
const dobles = new Map<string, unknown>([
  [
    path.join(root, "src/lib/barber-auth.ts"),
    {
      BarberForbiddenError: ForbiddenError,
      getBarberContext: async () =>
        st.session ? { barbershopId: "shopA", barberUserId: "u1", role: "OWNER", barbershop: { parentId: null }, user: {} } : null,
      assertBarberPermission: () => {
        if (!st.allowed) throw new ForbiddenError("sin permiso");
      },
      getAccessibleBranchIds: async () => st.accessible,
    },
  ],
  [
    path.join(root, "src/lib/barber/gating.ts"),
    {
      assertBarberSubscriptionActive: async () => {
        if (!st.paid) throw new GateError("Tu suscripción no está activa.");
      },
      barberGateErrorPayload: (e: unknown) =>
        e instanceof GateError ? { status: e.status, body: { error: e.message, code: e.code } } : null,
    },
  ],
  [
    path.join(root, "src/lib/barber/branches.ts"),
    {
      barberUnauthorized: () => Response.json({ error: "No autorizado" }, { status: 401 }),
      barberApiError: (err: unknown) => Response.json({ error: "Error interno", detalle: String(err) }, { status: 500 }),
    },
  ],
  [
    path.join(root, "src/lib/failban.ts"),
    { persistentRateLimit: async () => (st.limited ? Response.json({ error: "Demasiadas" }, { status: 429 }) : null) },
  ],
  [path.join(root, "src/lib/storage.ts"), { BUCKETS: { CLINIC_PUBLIC: "clinic-public" } }],
  [
    path.join(root, "src/lib/prisma.ts"),
    {
      prisma: {
        barber: {
          findFirst: async ({ where }: { where: { id: string; barbershopId: { in: string[] } } }) =>
            st.barbers.find((b) => b.id === where.id && where.barbershopId.in.includes(b.barbershopId)) ?? null,
          updateMany: async (arg: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (st.dbFails) throw new Error("base caída");
            st.updates.push(arg);
            return { count: 1 };
          },
        },
      },
    },
  ],
]);

type Mod = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const M = Module as Mod;
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "@supabase/supabase-js") return { createClient: () => ({ storage: fakeStorage }) };
  if (request === "next/cache") return { revalidatePath: () => undefined };
  let file: string | null = null;
  try {
    file = M._resolveFilename.call(this, request, parent, isMain);
  } catch {
    file = null;
  }
  if (file && dobles.has(file)) return dobles.get(file);
  return originalLoad.call(this, request, parent, isMain);
};

let POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let png: Buffer;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-mentira";
  ({ POST } = await import("../route"));
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#b0733f" } }).png().toBuffer();
});

beforeEach(() => {
  st.session = true;
  st.allowed = true;
  st.paid = true;
  st.limited = false;
  st.dbFails = false;
  st.accessible = ["shopA", "shopB"];
  st.uploads = [];
  st.removed = [];
  st.updates = [];
  st.barbers = [
    {
      id: "b1",
      barbershopId: "shopA",
      photoUrl: `${PUBLIC_BASE}barber/shopA/barberos/b1/vieja.jpg`,
      barbershop: { slug: "mi-barber" },
    },
    { id: "b2", barbershopId: "shopB", photoUrl: "https://ejemplo.test/mi-foto.jpg", barbershop: { slug: "sede-b" } },
    { id: "b9", barbershopId: "shopZ", photoUrl: null, barbershop: { slug: "ajena" } },
  ];
});

function pedido(id: string, partes: Record<string, string | File | Blob> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(partes)) form.append(k, v);
  const req = new NextRequest(`http://localhost/api/barber/team/barbers/${id}/photo`, { method: "POST", body: form });
  return POST(req, { params: Promise.resolve({ id }) });
}
const imagen = (nombre = "foto.png", tipo = "image/png") => new File([new Uint8Array(png)], nombre, { type: tipo });

// ── El camino feliz ───────────────────────────────────────────────────────

test("sube, guarda photoUrl y borra la foto anterior de ESE barbero", async () => {
  const res = await pedido("b1", { file: imagen() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { photoUrl: string };
  assert.equal(st.uploads.length, 1);
  assert.match(st.uploads[0], /^barber\/shopA\/barberos\/b1\/\d+-[a-z0-9]+\.png$/);
  assert.equal(body.photoUrl, PUBLIC_BASE + st.uploads[0]);
  assert.deepEqual(st.updates, [
    { where: { id: "b1", barbershopId: "shopA" }, data: { photoUrl: PUBLIC_BASE + st.uploads[0] } },
  ]);
  assert.deepEqual(st.removed, [["barber/shopA/barberos/b1/vieja.jpg"]]);
});

test("una liga pegada a mano NO se borra de ningún bucket al subir foto nueva", async () => {
  const res = await pedido("b2", { file: imagen() });
  assert.equal(res.status, 200);
  assert.match(st.uploads[0], /^barber\/shopB\/barberos\/b2\//);
  assert.deepEqual(st.removed, []);
});

test("la carpeta sale de la fila del barbero, no del body", async () => {
  const res = await pedido("b1", { file: imagen(), barbershopId: "shopZ", barberId: "b9", carpeta: "../../logo" });
  assert.equal(res.status, 200);
  assert.match(st.uploads[0], /^barber\/shopA\/barberos\/b1\//);
  assert.equal(st.updates[0].where.barbershopId, "shopA");
});

// ── Las puertas ──────────────────────────────────────────────────────────

test("sin sesión → 401 y nada se sube", async () => {
  st.session = false;
  assert.equal((await pedido("b1", { file: imagen() })).status, 401);
  assert.equal(st.uploads.length, 0);
});

test("sin barbers.manage → 403 y nada se sube", async () => {
  st.allowed = false;
  assert.equal((await pedido("b1", { file: imagen() })).status, 403);
  assert.equal(st.uploads.length, 0);
});

test("suscripción sin pagar → 402 y nada se sube", async () => {
  st.paid = false;
  const res = await pedido("b1", { file: imagen() });
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as { code: string }).code, "SUBSCRIPTION_INACTIVE");
  assert.equal(st.uploads.length, 0);
});

test("freno de subidas → 429 y nada se sube", async () => {
  st.limited = true;
  assert.equal((await pedido("b1", { file: imagen() })).status, 429);
  assert.equal(st.uploads.length, 0);
});

test("un barbero de otra cadena → 404 y nada se sube ni se actualiza", async () => {
  const res = await pedido("b9", { file: imagen() });
  assert.equal(res.status, 404);
  assert.equal(st.uploads.length, 0);
  assert.equal(st.updates.length, 0);
});

test("un barbero de una sede que la sesión NO alcanza → 404", async () => {
  st.accessible = ["shopA"]; // un encargado de la sede A no toca la sede B
  assert.equal((await pedido("b2", { file: imagen() })).status, 404);
  assert.equal(st.uploads.length, 0);
});

// ── El archivo ───────────────────────────────────────────────────────────

test("sin archivo → 400", async () => {
  assert.equal((await pedido("b1", {})).status, 400);
});

test("texto disfrazado de PNG (tipo declarado image/png) → 400", async () => {
  const falso = new File([Buffer.from("hola, esto no es una imagen")], "foto.png", { type: "image/png" });
  assert.equal((await pedido("b1", { file: falso })).status, 400);
  assert.equal(st.uploads.length, 0);
});

test("un script con extensión doble → 400", async () => {
  const f = new File([new Uint8Array(png)], "foto.php.png", { type: "image/png" });
  assert.equal((await pedido("b1", { file: f })).status, 400);
  assert.equal(st.uploads.length, 0);
});

test("GIF → 400 (solo JPG, PNG y WebP)", async () => {
  const gif = new File([new Uint8Array(png)], "foto.gif", { type: "image/gif" });
  const res = await pedido("b1", { file: gif });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /JPG, PNG o WebP/);
});

test("más de 4 MB → 400 con el tamaño", async () => {
  const grande = new File([new Uint8Array(4 * 1024 * 1024 + 10)], "grande.png", { type: "image/png" });
  const res = await pedido("b1", { file: grande });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /4 MB/);
});

test("una imagen corrupta con firma válida → 400", async () => {
  const roto = Buffer.concat([png.subarray(0, 40), Buffer.from("basura".repeat(20))]);
  const f = new File([new Uint8Array(roto)], "roto.png", { type: "image/png" });
  assert.equal((await pedido("b1", { file: f })).status, 400);
  assert.equal(st.uploads.length, 0);
});

test("si la base falla, el objeto recién subido no se queda huérfano", async () => {
  st.dbFails = true;
  const res = await pedido("b1", { file: imagen() });
  assert.equal(res.status, 500);
  assert.equal(st.uploads.length, 1);
  assert.deepEqual(st.removed, [[st.uploads[0]]]);
});

// ── La pieza pura: qué objeto se puede borrar ─────────────────────────────

test("objetoFotoAnterior solo devuelve objetos de la carpeta de ese barbero", () => {
  const carpeta = carpetaFotoBarbero("shopA", "b1");
  const url = (o: string) => `${PUBLIC_BASE}${o}`;
  assert.equal(objetoFotoAnterior(url("barber/shopA/barberos/b1/x.jpg?t=1"), "clinic-public", carpeta), "barber/shopA/barberos/b1/x.jpg");
  assert.equal(objetoFotoAnterior(url("barber/shopA/barberos/b2/x.jpg"), "clinic-public", carpeta), null, "otro barbero");
  assert.equal(objetoFotoAnterior(url("barber/shopA/logo/x.jpg"), "clinic-public", carpeta), null, "el logo");
  assert.equal(objetoFotoAnterior(url("barber/shopB/barberos/b1/x.jpg"), "clinic-public", carpeta), null, "otra sede");
  assert.equal(objetoFotoAnterior(url("barber/shopA/barberos/b1/../b2/x.jpg"), "clinic-public", carpeta), null, "con ..");
  assert.equal(objetoFotoAnterior(url("barber/shopA/barberos/b1/"), "clinic-public", carpeta), null, "la carpeta sola");
  assert.equal(objetoFotoAnterior("https://ejemplo.test/mi-foto.jpg", "clinic-public", carpeta), null, "liga ajena");
  assert.equal(objetoFotoAnterior(null, "clinic-public", carpeta), null);
});
