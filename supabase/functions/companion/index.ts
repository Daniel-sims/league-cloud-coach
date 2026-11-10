import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createCompanionHandler } from "./handler.ts";

Deno.serve(
  createCompanionHandler({
    env: (key) => Deno.env.get(key),
    createClient,
    fetch: globalThis.fetch,
  }),
);
