// Shared entity and DTO types.
//
// Everything here is *derived* from the generated schema types in `@/db/database.types` — never
// restated by hand. A hand-copied field list that drifts from the schema is worse than no type at
// all: it type-checks while describing a table that no longer exists in that shape.

import type { Database } from "@/db/database.types";

/** One row per authenticated account, holding the preferences every derived number depends on. */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/** Unit weights are entered and displayed in. Storage is canonical; see S-03. */
export type WeightUnit = Database["public"]["Enums"]["weight_unit"];

/** Which formula estimates a one-rep max. Both are valid for 1–12 repetitions only. */
export type EstimationFormula = Database["public"]["Enums"]["estimation_formula"];
