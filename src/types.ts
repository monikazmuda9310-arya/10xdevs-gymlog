// Shared entity and DTO types.
//
// Everything here is *derived* from the generated schema types in `@/db/database.types` — never
// restated by hand. A hand-copied field list that drifts from the schema is worse than no type at
// all: it type-checks while describing a table that no longer exists in that shape.

import type { Database } from "@/db/database.types";
import type { EstimationFormula as ServiceEstimationFormula } from "@/lib/services/one-rep-max";

/** One row per authenticated account, holding the preferences every derived number depends on. */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/** Unit weights are entered and displayed in. Storage is canonical; see S-03. */
export type WeightUnit = Database["public"]["Enums"]["weight_unit"];

/** Which formula estimates a one-rep max. Both are valid for 1–12 repetitions only. */
export type EstimationFormula = Database["public"]["Enums"]["estimation_formula"];

// `src/lib/services/one-rep-max.ts` declares the same union by hand, and must keep doing so:
// AGENTS.md requires the calculation module stay dependency-free so it remains directly
// unit-testable. The duplication is therefore deliberate — but nothing else would keep the two in
// step. Add a formula to the Postgres enum without teaching the estimator about it and this
// assertion stops compiling, instead of the new formula silently falling through to an existing
// branch and producing a number the user would believe.
// `false`, not `never`, on mismatch — and passed through a constraint. A bare alias resolving to
// `never` is not an error, only an unused declaration, so the first version of this check silently
// passed the very mutation it was written to catch.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type _EstimationFormulaUnionsAgree = Assert<MutuallyAssignable<EstimationFormula, ServiceEstimationFormula>>;
