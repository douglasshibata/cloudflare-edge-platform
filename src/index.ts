import { Hono } from "hono";
import { api, Env } from "./routes/api";
import { CounterOrState } from "./durable-objects/CounterOrState";

const app = new Hono<{ Bindings: Env }>();

// Roteamento Global para a API principal
app.route("/", api);

// Rota padrão 404
app.all("*", (c) => {
  return c.json({ error: "Endpoint Not Found" }, 404);
});

// Exportar app padrão e classe Durable Object para registro no runtime do Worker
export default app;
export { CounterOrState };
