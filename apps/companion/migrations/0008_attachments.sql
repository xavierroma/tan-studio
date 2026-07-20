-- Attachments are generic, durable resources. Their bytes live in the local
-- content-addressed attachment store; SQLite owns metadata and relationships.

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
  filename TEXT NOT NULL CHECK(length(trim(filename)) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK(length(trim(media_type)) BETWEEN 1 AND 200),
  byte_length INTEGER CHECK(byte_length IS NULL OR byte_length > 0),
  sha256 TEXT CHECK(sha256 IS NULL OR length(sha256) = 64),
  source_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  captured_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

CREATE INDEX attachments_hash ON attachments(sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX attachments_created ON attachments(created_at_ms DESC, id DESC);

CREATE TABLE attachment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  coffee_id INTEGER REFERENCES coffees(id) ON DELETE CASCADE,
  roast_id INTEGER REFERENCES roasts(id) ON DELETE CASCADE,
  brew_id INTEGER REFERENCES brews(id) ON DELETE CASCADE,
  CHECK((profile_id IS NOT NULL) + (coffee_id IS NOT NULL) + (roast_id IS NOT NULL) + (brew_id IS NOT NULL) = 1)
) STRICT;

CREATE UNIQUE INDEX attachment_links_profile ON attachment_links(attachment_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX attachment_links_coffee ON attachment_links(attachment_id, coffee_id) WHERE coffee_id IS NOT NULL;
CREATE UNIQUE INDEX attachment_links_roast ON attachment_links(attachment_id, roast_id) WHERE roast_id IS NOT NULL;
CREATE UNIQUE INDEX attachment_links_brew ON attachment_links(attachment_id, brew_id) WHERE brew_id IS NOT NULL;
CREATE INDEX attachment_links_profile_lookup ON attachment_links(profile_id, attachment_id DESC) WHERE profile_id IS NOT NULL;
CREATE INDEX attachment_links_coffee_lookup ON attachment_links(coffee_id, attachment_id DESC) WHERE coffee_id IS NOT NULL;
CREATE INDEX attachment_links_roast_lookup ON attachment_links(roast_id, attachment_id DESC) WHERE roast_id IS NOT NULL;
CREATE INDEX attachment_links_brew_lookup ON attachment_links(brew_id, attachment_id DESC) WHERE brew_id IS NOT NULL;

UPDATE app_metadata SET schema_version = 8 WHERE id = 1;
