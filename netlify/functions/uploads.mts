/*
 * Product photo uploads stored in Netlify Blobs.
 *   POST /api/admin/upload  { image: "data:image/...;base64,..." } -> { ok, url }
 *   GET  /uploads/:id       -> the stored image bytes
 * Admin access is checked by asking the store API whether the caller's
 * session cookie belongs to an admin.
 */
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const IMAGE_LIMIT = 4_000_000;
const ID_RE = /^[0-9a-f-]{36}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

function decodeImage(dataUri: unknown) {
  const match = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUri || ""));
  if (!match) throw Object.assign(new Error("Send a JPEG, PNG, WebP or GIF image."), { status: 400 });
  const declared = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const bytes = new Uint8Array(Buffer.from(match[2].replace(/\s/g, ""), "base64"));
  if (!bytes.length) throw Object.assign(new Error("The image is empty."), { status: 400 });
  if (bytes.length > IMAGE_LIMIT) throw Object.assign(new Error("Image is too large. Choose a smaller photo (under 4 MB)."), { status: 413 });
  const head = (n: number) => String.fromCharCode(...bytes.slice(0, n));
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  const webp = bytes.length > 12 && head(4) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const gif = head(4) === "GIF8";
  const detected = jpg ? "jpeg" : png ? "png" : webp ? "webp" : gif ? "gif" : null;
  if (!detected || detected !== declared) throw Object.assign(new Error("The image content does not match its file type."), { status: 400 });
  return { bytes, mime: `image/${detected}` };
}

async function isAdmin(req: Request) {
  const cookie = req.headers.get("cookie");
  if (!cookie) return false;
  const res = await fetch(new URL("/api/auth/me", req.url), { headers: { cookie } });
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  return body?.user?.role === "ADMIN";
}

export default async (req: Request) => {
  const store = getStore("product-uploads");
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (path === "/api/admin/upload") {
      if (req.method !== "POST") return fail("Method not allowed.", 405);
      if (!(await isAdmin(req))) return fail("Admin access required.", 403);
      const body = await req.json().catch(() => ({}));
      const { bytes, mime } = decodeImage(body.image);
      const id = crypto.randomUUID();
      await store.set(id, bytes.buffer as ArrayBuffer, { metadata: { mime } });
      return json({ ok: true, url: `/uploads/${id}` }, 201);
    }

    const id = path.match(/^\/uploads\/([^/]+)$/)?.[1];
    if (id && ID_RE.test(id) && (req.method === "GET" || req.method === "HEAD")) {
      const entry = await store.getWithMetadata(id, { type: "arrayBuffer" });
      if (!entry) return fail("Image not found.", 404);
      return new Response(req.method === "HEAD" ? null : entry.data, {
        headers: {
          "Content-Type": String(entry.metadata?.mime || "application/octet-stream"),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    }
    return fail("Not found.", 404);
  } catch (e: any) {
    if (!e?.status) console.error("[uploads]", e);
    return fail(e?.status ? e.message : "Could not process the image.", e?.status || 500);
  }
};

export const config: Config = { path: ["/api/admin/upload", "/uploads/*"] };
