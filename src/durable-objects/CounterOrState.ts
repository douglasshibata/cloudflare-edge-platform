import { DurableObjectState } from "@cloudflare/workers-types";

export class CounterOrState {
  state: DurableObjectState;
  env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/increment") {
      let value: number = (await this.state.storage.get("value")) || 0;
      value++;
      await this.state.storage.put("value", value);
      return new Response(JSON.stringify({ count: value }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/decrement") {
      let value: number = (await this.state.storage.get("value")) || 0;
      value--;
      await this.state.storage.put("value", value);
      return new Response(JSON.stringify({ count: value }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/get") {
      const value: number = (await this.state.storage.get("value")) || 0;
      const customState: any = (await this.state.storage.get("custom_state")) || {};
      return new Response(JSON.stringify({ count: value, state: customState }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/set-state" && request.method === "POST") {
      const body: any = await request.json();
      await this.state.storage.put("custom_state", body);
      return new Response(JSON.stringify({ success: true, state: body }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}
