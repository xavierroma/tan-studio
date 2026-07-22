ALTER TABLE roasts ADD COLUMN user_roasted_at_ms INTEGER;

CREATE INDEX roasts_user_date ON roasts(user_roasted_at_ms DESC)
  WHERE user_roasted_at_ms IS NOT NULL;
