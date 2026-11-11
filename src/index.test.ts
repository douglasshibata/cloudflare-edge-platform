import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Cloudflare Edge Platform Integration Tests", () => {

  // 1. Teste da Rota de Healthcheck
  it("should respond to /api/health with status healthy", async () => {
    const res = await SELF.fetch("https://edge.platform.local/api/health");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe("healthy");
    expect(data.timestamp).toBeDefined();
  });

  // 2. Teste de Geração de Token JWT
  it("should generate a JWT token on /api/auth/token", async () => {
    const res = await SELF.fetch("https://edge.platform.local/api/auth/token");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.token).toBeDefined();

    // Validar estrutura do token JWT (Header.Payload.Signature)
    const parts = data.token.split(".");
    expect(parts.length).toBe(3);
  });

  // 3. Teste de Rota Protegida (Retorna 401 sem token)
  it("should return 401 on /api/users POST without a valid Authorization header", async () => {
    const res = await SELF.fetch("https://edge.platform.local/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user_test", name: "Test User", email: "test@example.com" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json() as any;
    expect(data.error).toContain("Unauthorized");
  });

  // 4. Testes de Cache KV (Chave-Valor)
  it("should put and get values from Cloudflare KV_CACHE", async () => {
    const key = "test_cache_key";
    const value = "Hello Edge Cache";

    // Gravar no KV Cache
    const putRes = await SELF.fetch("https://edge.platform.local/api/cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    expect(putRes.status).toBe(200);
    const putData = await putRes.json() as any;
    expect(putData.success).toBe(true);

    // Recuperar do KV Cache
    const getRes = await SELF.fetch(`https://edge.platform.local/api/cache/${key}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as any;
    expect(getData.key).toBe(key);
    expect(getData.value).toBe(value);
  });

  // 5. Testes de R2 Storage (Armazenamento de Objetos)
  it("should upload and download files from Cloudflare R2_STORAGE", async () => {
    const key = "documents/hello.txt";
    const content = "Hello from Cloudflare R2 Storage!";

    // Upload via JSON Payload
    const uploadRes = await SELF.fetch("https://edge.platform.local/api/storage/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, content }),
    });
    expect(uploadRes.status).toBe(200);
    const uploadData = await uploadRes.json() as any;
    expect(uploadData.success).toBe(true);
    expect(uploadData.key).toBe(key);

    // Download do R2
    const downloadRes = await SELF.fetch(`https://edge.platform.local/api/storage/download/${encodeURIComponent(key)}`);
    expect(downloadRes.status).toBe(200);
    const downloadText = await downloadRes.text();
    expect(downloadText).toBe(content);
  });

  // 6. Testes do Durable Object (Estado Forte e Concorrência)
  it("should manage consistent state using Durable Object stub calls", async () => {
    // Obter estado inicial do Durable Object
    const getRes = await SELF.fetch("https://edge.platform.local/api/state");
    expect(getRes.status).toBe(200);
    const stateData = await getRes.json() as any;
    expect(stateData.count).toBeDefined();

    const initialCount = stateData.count;

    // Incrementar contador do Durable Object
    const incRes = await SELF.fetch("https://edge.platform.local/api/state/increment", { method: "POST" });
    expect(incRes.status).toBe(200);
    const incData = await incRes.json() as any;
    expect(incData.count).toBe(initialCount + 1);

    // Definir estado personalizado no Durable Object
    const customState = { appName: "EnterpriseEdge", active: true };
    const setRes = await SELF.fetch("https://edge.platform.local/api/state/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customState),
    });
    expect(setRes.status).toBe(200);
    const setData = await setRes.json() as any;
    expect(setData.success).toBe(true);

    // Buscar estado completo e garantir persistência
    const finalRes = await SELF.fetch("https://edge.platform.local/api/state");
    expect(finalRes.status).toBe(200);
    const finalData = await finalRes.json() as any;
    expect(finalData.count).toBe(initialCount + 1);
    expect(finalData.state).toEqual(customState);
  });
});
