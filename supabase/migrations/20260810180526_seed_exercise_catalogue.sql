-- Purpose : the 38 exercises the owner settled on, as shared catalogue rows (user_id is null),
--           readable by every authenticated account and writable by none.
-- Affected: data only — inserts into public.exercises. No schema object is altered.
--           Destructive operations: none.
--
-- The list, the muscle groups and the bodyweight flags are taken VERBATIM from
-- context/foundation/prd.md § Open Questions #1. Do not re-derive them here; that table is the
-- record of an owner decision, and five of the assignments look wrong until you read why.
--
-- Idempotent on purpose (`on conflict do nothing` against the partial unique index over
-- lower(name) where user_id is null): this migration is pushed to two databases in separate
-- invocations and must survive a re-run after a failure without duplicating a single row.

insert into public.exercises (user_id, name, muscle_group, is_bodyweight) values
  -- legs (9). Romanian Deadlift is `legs` while the conventional Deadlift below is `back`. That
  -- pair looks inconsistent and is the clearest demonstration of the assignment rule: the
  -- conventional pull is programmed on pull day, the Romanian variant on leg day for the
  -- hamstrings. Hip Thrust is `legs` because no `glutes` group exists — declined deliberately.
  (null, 'Back Squat',                 'legs',      false),
  (null, 'Front Squat',                'legs',      false),
  (null, 'Leg Press',                  'legs',      false),
  (null, 'Romanian Deadlift',          'legs',      false),
  (null, 'Dumbbell Lunge',             'legs',      false),
  (null, 'Hip Thrust',                 'legs',      false),
  (null, 'Leg Extension',              'legs',      false),
  (null, 'Leg Curl',                   'legs',      false),
  (null, 'Calf Raise',                 'legs',      false),

  -- back (7)
  (null, 'Deadlift',                   'back',      false),
  (null, 'Pull-Up',                    'back',      true),
  (null, 'Chin-Up',                    'back',      true),
  (null, 'Lat Pulldown',               'back',      false),
  (null, 'Barbell Row',                'back',      false),
  (null, 'Dumbbell Row',               'back',      false),
  (null, 'Seated Cable Row',           'back',      false),

  -- chest (7). Dip is `chest` per the rule; the forward-leaning variant is mostly triceps, and a
  -- lifter who programmes it that way re-tags their own copy. Push-Up carries the bodyweight flag
  -- although nobody assists it — the flag is what permits a zero load.
  (null, 'Bench Press',                'chest',     false),
  (null, 'Incline Bench Press',        'chest',     false),
  (null, 'Dumbbell Bench Press',       'chest',     false),
  (null, 'Dumbbell Fly',               'chest',     false),
  (null, 'Cable Crossover',            'chest',     false),
  (null, 'Dip',                        'chest',     true),
  (null, 'Push-Up',                    'chest',     true),

  -- shoulders (5). Face Pull is `shoulders`, not `back`: usually done on pull day, but it targets
  -- the rear delts and that is how lifters think of it.
  (null, 'Overhead Press',             'shoulders', false),
  (null, 'Dumbbell Shoulder Press',    'shoulders', false),
  (null, 'Lateral Raise',              'shoulders', false),
  (null, 'Rear Delt Fly',              'shoulders', false),
  (null, 'Face Pull',                  'shoulders', false),

  -- arms (6)
  (null, 'Barbell Curl',               'arms',      false),
  (null, 'Dumbbell Curl',              'arms',      false),
  (null, 'Hammer Curl',                'arms',      false),
  (null, 'Skull Crusher',              'arms',      false),
  (null, 'Triceps Pushdown',           'arms',      false),
  (null, 'Overhead Triceps Extension', 'arms',      false),

  -- core (4). Plank is bodyweight for the same reason as Push-Up: a plank logged at weight 0 must
  -- be a valid set, not a validation error.
  (null, 'Plank',                      'core',      true),
  (null, 'Hanging Leg Raise',          'core',      true),
  (null, 'Cable Crunch',               'core',      false),
  (null, 'Ab Wheel Rollout',           'core',      true)
on conflict do nothing;
