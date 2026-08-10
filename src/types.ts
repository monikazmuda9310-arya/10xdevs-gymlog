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

/**
 * A catalogue entry. `user_id === null` marks a seeded row every account reads and none may write;
 * a non-null `user_id` marks a custom exercise private to that account.
 */
export type Exercise = Database["public"]["Tables"]["exercises"]["Row"];
export type ExerciseInsert = Database["public"]["Tables"]["exercises"]["Insert"];
export type ExerciseUpdate = Database["public"]["Tables"]["exercises"]["Update"];

/** The one primary muscle group every exercise carries (FR-013). Exactly six, closed set. */
export type MuscleGroup = Database["public"]["Enums"]["muscle_group"];

/**
 * The same six, as a value — the UI needs to iterate them for a filter and a select, and a
 * hand-written list in a component is how a seventh group ships to the database and never reaches
 * the screen. Order matches the enum's declaration order, which is what any `order by` will use.
 */
export const MUSCLE_GROUPS = ["legs", "back", "chest", "shoulders", "arms", "core"] as const;

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

// The same guard for the muscle-group tuple above. Add a seventh value to the Postgres enum without
// adding it to MUSCLE_GROUPS and this stops compiling — instead of the new group existing in the
// database, being assignable to exercises through the API, and silently missing from every filter
// and select on screen. `false`, not `never`, for the reason spelled out above.
export type _MuscleGroupTupleCoversEnum = Assert<MutuallyAssignable<MuscleGroup, (typeof MUSCLE_GROUPS)[number]>>;
