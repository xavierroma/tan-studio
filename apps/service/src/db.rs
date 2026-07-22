use std::{fs, path::Path, sync::Arc, time::Duration};

use parking_lot::{Mutex, MutexGuard};
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        include_str!("../../companion/migrations/0001_initial.sql"),
    ),
    (
        2,
        include_str!("../../companion/migrations/0002_roast_brew_workflow.sql"),
    ),
    (
        3,
        include_str!("../../companion/migrations/0003_klog_ingestion_safety.sql"),
    ),
    (
        4,
        include_str!("../../companion/migrations/0004_profile_ingestion.sql"),
    ),
    (
        5,
        include_str!("../../companion/migrations/0005_profile_projection_safety.sql"),
    ),
    (
        6,
        include_str!("../../companion/migrations/0006_roast_date_reliability.sql"),
    ),
    (
        7,
        include_str!("../../companion/migrations/0007_simplified_core_model.sql"),
    ),
    (
        8,
        include_str!("../../companion/migrations/0008_attachments.sql"),
    ),
    (
        9,
        include_str!("../../companion/migrations/0009_tan_bridge.sql"),
    ),
];

#[derive(Clone)]
pub struct Database(Arc<Mutex<Connection>>);

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("database path has no parent directory")]
    MissingParent,
    #[error("database directory could not be created")]
    CreateDirectory(#[source] std::io::Error),
    #[error("database migration backup failed")]
    Backup(#[source] std::io::Error),
    #[error("database operation failed")]
    Sqlite(#[from] rusqlite::Error),
    #[error("applied migration {0} differs from this application build")]
    MigrationDrift(i64),
    #[error("database was created by a newer Tan Studio version")]
    FutureMigration,
    #[error("database uses an unsupported migration ledger")]
    UnsupportedMigrationLedger,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DatabaseError> {
        let parent = path.parent().ok_or(DatabaseError::MissingParent)?;
        fs::create_dir_all(parent).map_err(DatabaseError::CreateDirectory)?;
        let mut connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.busy_timeout(Duration::from_secs(5))?;
        migrate(&mut connection, path)?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    pub fn connection(&self) -> MutexGuard<'_, Connection> {
        self.0.lock()
    }

    pub fn quick_check(&self) -> Result<bool, rusqlite::Error> {
        let connection = self.connection();
        let result: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        Ok(result == "ok")
    }

    pub fn schema_versions(&self) -> Result<(i64, i64), rusqlite::Error> {
        let connection = self.connection();
        connection.query_row(
            "SELECT schema_version, projection_version FROM app_metadata WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }
}

fn migrate(connection: &mut Connection, path: &Path) -> Result<(), DatabaseError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
           applied_at_ms INTEGER NOT NULL
         ) STRICT;",
    )?;

    let hash_column = migration_hash_column(connection)?;
    let maximum: Option<i64> = connection
        .query_row("SELECT max(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .optional()?
        .flatten();
    if maximum.unwrap_or(0) > MIGRATIONS.last().map(|entry| entry.0).unwrap_or(0) {
        return Err(DatabaseError::FutureMigration);
    }

    let applied: Vec<(i64, String)> = {
        let mut statement = connection.prepare(&format!(
            "SELECT version, {hash_column} FROM schema_migrations ORDER BY version"
        ))?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };
    for (version, hash) in &applied {
        let sql = MIGRATIONS
            .iter()
            .find(|entry| entry.0 == *version)
            .map(|entry| entry.1)
            .ok_or(DatabaseError::FutureMigration)?;
        if &sha256(sql.as_bytes()) != hash {
            return Err(DatabaseError::MigrationDrift(*version));
        }
    }

    if hash_column == "sql_sha256" {
        backup_before_migration(connection, path, "ledger")?;
        normalize_legacy_migration_ledger(connection)?;
    }

    let next = maximum.unwrap_or(0) + 1;
    if next <= MIGRATIONS.last().map(|entry| entry.0).unwrap_or(0)
        && path.exists()
        && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
    {
        backup_before_migration(connection, path, &next.to_string())?;
    }

    for (version, sql) in MIGRATIONS.iter().filter(|entry| entry.0 >= next) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version, sha256, applied_at_ms) VALUES (?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))",
            rusqlite::params![version, sha256(sql.as_bytes())],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn migration_hash_column(connection: &Connection) -> Result<&'static str, DatabaseError> {
    let mut statement = connection.prepare("PRAGMA table_info(schema_migrations)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if columns.iter().any(|column| column == "sha256") {
        Ok("sha256")
    } else if columns.iter().any(|column| column == "sql_sha256") {
        Ok("sql_sha256")
    } else {
        Err(DatabaseError::UnsupportedMigrationLedger)
    }
}

fn normalize_legacy_migration_ledger(connection: &mut Connection) -> Result<(), DatabaseError> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "CREATE TABLE schema_migrations_canonical (
           version INTEGER PRIMARY KEY,
           sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
           applied_at_ms INTEGER NOT NULL
         ) STRICT;
         INSERT INTO schema_migrations_canonical(version, sha256, applied_at_ms)
           SELECT version, sql_sha256, applied_at_ms FROM schema_migrations;
         DROP TABLE schema_migrations;
         ALTER TABLE schema_migrations_canonical RENAME TO schema_migrations;",
    )?;
    transaction.commit()?;
    Ok(())
}

fn backup_before_migration(
    connection: &Connection,
    path: &Path,
    suffix: &str,
) -> Result<(), DatabaseError> {
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    let backup = path.with_extension(format!("sqlite.pre-migration-{suffix}.backup"));
    fs::copy(path, backup).map_err(DatabaseError::Backup)?;
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_the_existing_forward_migrations() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("tan-studio.sqlite")).unwrap();
        assert_eq!(database.schema_versions().unwrap(), (9, 4));
        assert!(database.quick_check().unwrap());
    }

    #[test]
    fn upgrades_the_typescript_companion_migration_ledger() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tan-studio.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   name TEXT NOT NULL,
                   sql_sha256 TEXT NOT NULL,
                   applied_at_ms INTEGER NOT NULL,
                   application_version TEXT NOT NULL
                 ) STRICT;",
            )
            .unwrap();
        for (version, sql) in MIGRATIONS {
            connection.execute_batch(sql).unwrap();
            connection
                .execute(
                    "INSERT INTO schema_migrations(version, name, sql_sha256, applied_at_ms, application_version)
                     VALUES (?, ?, ?, 1, '0.1.0')",
                    rusqlite::params![version, format!("migration-{version}"), sha256(sql.as_bytes())],
                )
                .unwrap();
        }
        drop(connection);

        let database = Database::open(&path).unwrap();

        assert_eq!(database.schema_versions().unwrap(), (9, 4));
        let connection = database.connection();
        assert_eq!(migration_hash_column(&connection).unwrap(), "sha256");
        let applied: i64 = connection
            .query_row("SELECT count(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(applied, 9);
        assert!(path
            .with_extension("sqlite.pre-migration-ledger.backup")
            .is_file());
    }
}
