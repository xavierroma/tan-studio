-- Green coffee left becomes derived instead of maintained by hand:
--   remaining = max(0, purchased - roasted green + green_correction_mg)
-- Roasted green is the green input of every roast that ran on the coffee:
-- completed roasts and interrupted roasts (aborted or faulted beans were used),
-- archived or not. Planned roasts and discarded plans consumed nothing. The
-- application computes roasted green on every read; this migration only adds
-- the discard marker and chooses each coffee's starting correction.

-- 1. Discarded plans. From now on "Discard plan" sets this explicitly.
ALTER TABLE roasts ADD COLUMN discarded_at_ms INTEGER;

-- Older discards were stored exactly like an interruption (interrupted/aborted)
-- and cannot be told apart from a manually recorded interruption by status.
-- Classify conservatively: a past roast counts as discarded only when it has
-- the old discard signature (interrupted, result aborted) and shows no sign of
-- having run: no imported log or sample stream, no user roast time, yield,
-- duration, cooldown, end temperature, development, end reason or user first
-- crack. Faulted or unknown interruptions, and anything with a measurement,
-- keep consuming green. An aborted interruption recorded with no evidence at
-- all is indistinguishable from a discard; it stays discarded until edited.
UPDATE roasts
SET discarded_at_ms = updated_at_ms
WHERE status = 'interrupted'
  AND result = 'aborted'
  AND source_file_id IS NULL
  AND user_roasted_at_ms IS NULL
  AND roasted_yield_mass_mg IS NULL
  AND duration_ms IS NULL
  AND cooldown_end_ms IS NULL
  AND end_temperature_milli_c IS NULL
  AND development_basis_points IS NULL
  AND trim(coalesce(end_reason, '')) = ''
  AND NOT EXISTS (SELECT 1 FROM roast_sample_streams s WHERE s.roast_id = roasts.id)
  AND NOT EXISTS (
    SELECT 1 FROM roast_events e
    WHERE e.roast_id = roasts.id AND e.event_kind = 'first_crack' AND e.source = 'user'
  );

-- 2. Starting corrections. Compatibility assumption, not proof: a stored
-- remaining equal to the purchased mass is treated as never adjusted, so its
-- roast history is now subtracted (correction 0). Any other stored remaining is
-- treated as a manual balance that may already include past roasts and is kept
-- as displayed today, so only later roasts subtract. A balance manually set
-- back to exactly the purchased mass cannot be distinguished from an untouched
-- one; correct it again in the coffee editor if needed.
ALTER TABLE coffees ADD COLUMN green_correction_mg INTEGER NOT NULL DEFAULT 0;
UPDATE coffees
SET green_correction_mg = remaining_mass_mg - purchased_mass_mg + (
  SELECT coalesce(sum(r.green_input_mass_mg), 0) FROM roasts r
  WHERE r.coffee_id = coffees.id
    AND (r.status = 'completed' OR (r.status = 'interrupted' AND r.discarded_at_ms IS NULL))
)
WHERE remaining_mass_mg <> purchased_mass_mg;

UPDATE app_metadata SET schema_version = 18 WHERE id = 1;
