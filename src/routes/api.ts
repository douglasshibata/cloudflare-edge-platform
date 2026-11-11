import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

// Interfaces de Tipo para os Bindings da Cloudflare
export interface Env {
  KV_CACHE: KVNamespace;
  R2_STORAGE: R2Bucket;
  DB: D1Database;
  COUNTER_OR_STATE: DurableObjectNamespace;
}

// Interface de Variáveis para o Contexto do Hono
export interface Variables {
  user: any;
}

export const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// -------------------------------------------------------------
// MIDDLEWARE DE AUTENTICAÇÃO JWT ENCAPSULADO (Sem dependências circulares ESM)
// -------------------------------------------------------------
export const jwtAuthMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);
  }

  const token = authHeader.substring(7);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return c.json({ error: "Unauthorized: Invalid token structure" }, 401);
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((char) => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);

    c.set("user", payload);
    await next();
  } catch (err) {
    return c.json({ error: "Unauthorized: Token verification failed" }, 401);
  }
});

// -------------------------------------------------------------
// ROTAS DE AUTENTICAÇÃO E METRICS
// -------------------------------------------------------------

// Helper endpoint para gerar token JWT mock para testes
api.get("/api/auth/token", (c) => {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub: "user-123", name: "Jules Arquiteto", role: "admin" }));
  const signature = btoa("mock-signature");
  const token = `${header}.${payload}.${signature}`;
  return c.json({ token });
});

// Endpoint de integridade física
api.get("/api/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// -------------------------------------------------------------
// ROTAS DE CLOUDFLARE D1 (SQL DATABASE)
// -------------------------------------------------------------

// Buscar usuários do banco SQL Serverless D1
api.get("/api/users", async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT * FROM users").all();
    return c.json({ users: results });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Criar usuário no banco D1 (Protegido por Autenticação JWT)
api.post("/api/users", jwtAuthMiddleware, async (c) => {
  try {
    const { id, name, email } = await c.req.json();
    if (!id || !name || !email) {
      return c.json({ error: "Missing required fields: id, name, email" }, 400);
    }

    // Inserção no banco SQLite D1
    await c.env.DB.prepare(
      "INSERT INTO users (id, name, email) VALUES (?, ?, ?)"
    ).bind(id, name, email).run();

    // Inserção as síncronas de logs de rastreabilidade
    await c.env.DB.prepare(
      "INSERT INTO logs (action, details) VALUES (?, ?)"
    ).bind("CREATE_USER", `User ${name} (${id}) created`).run();

    return c.json({ success: true, user: { id, name, email } }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// -------------------------------------------------------------
// ROTAS DE CLOUDFLARE KV (CHAVE-VALOR CACHING)
// -------------------------------------------------------------

// Adicionar item ao KV Cache
api.post("/api/cache", async (c) => {
  try {
    const { key, value, ttl } = await c.req.json();
    if (!key || !value) {
      return c.json({ error: "Missing key or value" }, 400);
    }
    await c.env.KV_CACHE.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
    return c.json({ success: true, key, value });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Buscar item do KV Cache
api.get("/api/cache/:key", async (c) => {
  try {
    const key = c.req.param("key");
    const value = await c.env.KV_CACHE.get(key);
    if (!value) {
      return c.json({ error: "Key not found in KV Cache" }, 404);
    }
    return c.json({ key, value });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// -------------------------------------------------------------
// ROTAS DE CLOUDFLARE R2 (OBJECT STORAGE)
// -------------------------------------------------------------

// Upload de arquivo para o R2 Storage
api.post("/api/storage/upload", async (c) => {
  try {
    const contentType = c.req.header("Content-Type") || "";
    let fileData: any;
    let key: string;

    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      const file = body["file"];
      key = body["key"] as string;

      if (!file || !key) {
        return c.json({ error: "Missing file or key in multipart form" }, 400);
      }

      if (file instanceof File) {
        fileData = await file.arrayBuffer();
      } else {
        fileData = file;
      }
    } else {
      const { key: jsonKey, content } = await c.req.json();
      if (!jsonKey || !content) {
        return c.json({ error: "Missing key or content in JSON body" }, 400);
      }
      key = jsonKey;
      fileData = content;
    }

    await c.env.R2_STORAGE.put(key, fileData);
    return c.json({ success: true, key, message: "File uploaded successfully to R2" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Download de arquivo do R2 Storage
api.get("/api/storage/download/:key", async (c) => {
  try {
    const key = c.req.param("key");
    const object = await c.env.R2_STORAGE.get(key);

    if (!object) {
      return c.json({ error: "File not found in R2" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    return new Response(object.body, { headers });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// -------------------------------------------------------------
// ROTAS DE DURABLE OBJECTS (CONCORRÊNCIA E ESTADO FORTE)
// -------------------------------------------------------------

// Obter estado atual do Durable Object
api.get("/api/state", async (c) => {
  try {
    const id = c.env.COUNTER_OR_STATE.idFromName("global_state");
    const stub = c.env.COUNTER_OR_STATE.get(id);
    const response = await stub.fetch(new URL("/get", c.req.url).toString());
    return c.json(await response.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Incrementar contador do Durable Object
api.post("/api/state/increment", async (c) => {
  try {
    const id = c.env.COUNTER_OR_STATE.idFromName("global_state");
    const stub = c.env.COUNTER_OR_STATE.get(id);
    const response = await stub.fetch(new URL("/increment", c.req.url).toString());
    return c.json(await response.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Decrementar contador do Durable Object
api.post("/api/state/decrement", async (c) => {
  try {
    const id = c.env.COUNTER_OR_STATE.idFromName("global_state");
    const stub = c.env.COUNTER_OR_STATE.get(id);
    const response = await stub.fetch(new URL("/decrement", c.req.url).toString());
    return c.json(await response.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Atualizar o estado personalizado do Durable Object
api.post("/api/state/set", async (c) => {
  try {
    const id = c.env.COUNTER_OR_STATE.idFromName("global_state");
    const stub = c.env.COUNTER_OR_STATE.get(id);
    const body = await c.req.json();
    const response = await stub.fetch(new URL("/set-state", c.req.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return c.json(await response.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
