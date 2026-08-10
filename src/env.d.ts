declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    // The request-scoped Supabase client the middleware already builds. Null when credentials are
    // missing — the documented silent-failure mode (AGENTS.md § Cloudflare traps), not an error.
    supabase: import("@supabase/supabase-js").SupabaseClient<import("@/db/database.types").Database> | null;
  }
}
