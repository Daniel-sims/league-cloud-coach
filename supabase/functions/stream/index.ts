import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { createStreamHandler } from './handler.ts'

Deno.serve(
  createStreamHandler({
    env: (key) => Deno.env.get(key),
    createClient,
    fetch: globalThis.fetch,
  }),
)
