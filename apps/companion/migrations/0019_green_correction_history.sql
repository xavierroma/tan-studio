-- Internal history of explicit green balance writes (weighed corrections).
-- Roast consumption is never recorded here; it stays derived from roasts.
-- Corrections that existed before this migration have no recorded events and
-- none are invented: their current offset remains in coffees.green_correction_mg.
CREATE TABLE coffee_green_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coffee_id INTEGER NOT NULL REFERENCES coffees(id),
  previous_remaining_mg INTEGER,
  remaining_mg INTEGER NOT NULL,
  previous_correction_mg INTEGER,
  correction_mg INTEGER NOT NULL,
  recorded_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX coffee_green_corrections_coffee ON coffee_green_corrections(coffee_id, id);
UPDATE app_metadata SET schema_version = 19 WHERE id = 1;
