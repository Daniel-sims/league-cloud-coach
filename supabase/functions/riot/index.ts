import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createRiotHandler } from "./handler.ts";
Deno.serve(
  createRiotHandler({
    env: (key) => Deno.env.get(key),
    createClient,
    fetch: globalThis.fetch,
  }),
);
