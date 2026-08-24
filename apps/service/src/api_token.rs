//! Hosted API tokens.
//!
//! The operator signs in with Google; an MCP client or a plain HTTP client cannot.
//! An API token is the credential those clients present to the studio origin instead
//! of the browser session cookie. Each token belongs to one client, is stored only as
//! a SHA-256 digest, and can be revoked on its own without disturbing the others.
//!
//! The plaintext secret exists exactly once, in the response to the mint request the
//! operator makes from behind their own session. Nothing here can recover it later.

use rand::random;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::db::Database;

/// A minted secret is 32 random bytes rendered as hex: unguessable, and plain enough
/// to paste into an environment variable or a token file.
const SECRET_BYTES: usize = 32;
const SECRET_LENGTH: usize = SECRET_BYTES * 2;
pub const MAX_LABEL_LENGTH: usize = 64;

/// One token as the operator sees it. The secret is deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenRecord {
    pub id: i64,
    pub label: String,
    pub created_at_ms: i64,
    pub last_used_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

/// The one moment the secret is knowable.
#[derive(Debug, Clone)]
pub struct MintedApiToken {
    pub secret: String,
    pub record: ApiTokenRecord,
}

/// Whether a label is one this notebook will store. Labels are attribution, not
/// prose: they name the client that holds the token.
pub fn valid_label(label: &str) -> bool {
    let trimmed = label.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= MAX_LABEL_LENGTH
        && !trimmed.chars().any(char::is_control)
}

pub fn mint(database: &Database, label: &str) -> Result<MintedApiToken, rusqlite::Error> {
    let secret = hex::encode(random::<[u8; SECRET_BYTES]>());
    let label = label.trim().to_owned();
    let created_at_ms = now_ms();
    let connection = database.connection();
    connection.execute(
        "INSERT INTO api_tokens(label, token_sha256, created_at_ms)
         VALUES (?, ?, ?)",
        params![label, sha256_hex(&secret), created_at_ms],
    )?;
    Ok(MintedApiToken {
        record: ApiTokenRecord {
            id: connection.last_insert_rowid(),
            label,
            created_at_ms,
            last_used_at_ms: None,
            revoked_at_ms: None,
        },
        secret,
    })
}

pub fn list(database: &Database) -> Result<Vec<ApiTokenRecord>, rusqlite::Error> {
    let connection = database.connection();
    let mut statement = connection.prepare(
        "SELECT id, label, created_at_ms, last_used_at_ms, revoked_at_ms
           FROM api_tokens
          ORDER BY id DESC",
    )?;
    let records = statement.query_map([], map_record)?.collect();
    records
}

/// Revoking is permanent: the row stays for attribution, the digest stops matching.
pub fn revoke(database: &Database, id: i64) -> Result<Option<ApiTokenRecord>, rusqlite::Error> {
    let connection = database.connection();
    connection.execute(
        "UPDATE api_tokens SET revoked_at_ms=? WHERE id=? AND revoked_at_ms IS NULL",
        params![now_ms(), id],
    )?;
    connection
        .query_row(
            "SELECT id, label, created_at_ms, last_used_at_ms, revoked_at_ms
               FROM api_tokens WHERE id=?",
            [id],
            map_record,
        )
        .optional()
}

/// The identity behind a presented secret, or `None` for an unknown or revoked one.
///
/// Every live digest is compared in constant time and the scan never exits early, so
/// neither the comparison nor the number of comparisons depends on the secret.
pub fn accept(database: &Database, presented: &str) -> Option<i64> {
    if presented.len() != SECRET_LENGTH || !presented.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let digest = sha256_hex(presented);
    let connection = database.connection();
    let accepted = {
        let mut statement = connection
            .prepare("SELECT id, token_sha256 FROM api_tokens WHERE revoked_at_ms IS NULL")
            .ok()?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .ok()?
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        rows.into_iter().fold(None, |accepted, (id, stored)| {
            let matches = stored.len() == digest.len()
                && constant_time_eq::constant_time_eq(stored.as_bytes(), digest.as_bytes());
            if matches {
                Some(id)
            } else {
                accepted
            }
        })?
    };
    connection
        .execute(
            "UPDATE api_tokens SET last_used_at_ms=? WHERE id=?",
            params![now_ms(), accepted],
        )
        .ok()?;
    Some(accepted)
}

fn map_record(row: &rusqlite::Row<'_>) -> Result<ApiTokenRecord, rusqlite::Error> {
    Ok(ApiTokenRecord {
        id: row.get(0)?,
        label: row.get(1)?,
        created_at_ms: row.get(2)?,
        last_used_at_ms: row.get(3)?,
        revoked_at_ms: row.get(4)?,
    })
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook() -> (tempfile::TempDir, Database) {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("studio.sqlite")).unwrap();
        (directory, database)
    }

    #[test]
    fn a_minted_token_is_accepted_and_records_its_use() {
        let (_directory, database) = notebook();
        let minted = mint(&database, "codex plugin").unwrap();

        assert_eq!(accept(&database, &minted.secret), Some(minted.record.id));

        let stored = list(&database).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].label, "codex plugin");
        assert!(stored[0].last_used_at_ms.is_some());
        assert!(stored[0].revoked_at_ms.is_none());
    }

    #[test]
    fn the_secret_is_never_stored() {
        let (_directory, database) = notebook();
        let minted = mint(&database, "codex plugin").unwrap();

        let connection = database.connection();
        let mut statement = connection.prepare("SELECT * FROM api_tokens").unwrap();
        let columns = statement.column_count();
        let stored: Vec<String> = statement
            .query_row([], |row| {
                (0..columns)
                    .map(|index| {
                        row.get::<_, rusqlite::types::Value>(index)
                            .map(|v| format!("{v:?}"))
                    })
                    .collect()
            })
            .unwrap();

        assert!(
            !stored.iter().any(|value| value.contains(&minted.secret)),
            "the plaintext secret must not survive minting"
        );
        assert!(stored
            .iter()
            .any(|value| value.contains(&sha256_hex(&minted.secret))));
    }

    #[test]
    fn an_unknown_or_malformed_secret_is_refused() {
        let (_directory, database) = notebook();
        mint(&database, "codex plugin").unwrap();

        assert_eq!(accept(&database, &"a".repeat(64)), None);
        assert_eq!(accept(&database, ""), None);
        assert_eq!(accept(&database, "not-a-token"), None);
        assert_eq!(accept(&database, &"a".repeat(4096)), None);
    }

    #[test]
    fn revoking_one_token_leaves_the_others_working() {
        let (_directory, database) = notebook();
        let doomed = mint(&database, "old laptop").unwrap();
        let kept = mint(&database, "codex plugin").unwrap();

        let revoked = revoke(&database, doomed.record.id).unwrap().unwrap();

        assert!(revoked.revoked_at_ms.is_some());
        assert_eq!(accept(&database, &doomed.secret), None);
        assert_eq!(accept(&database, &kept.secret), Some(kept.record.id));
        assert_eq!(revoke(&database, 9999).unwrap(), None);
    }

    #[test]
    fn labels_name_a_client_and_nothing_longer() {
        assert!(valid_label("codex plugin"));
        assert!(!valid_label("   "));
        assert!(!valid_label(&"a".repeat(MAX_LABEL_LENGTH + 1)));
        assert!(!valid_label("codex\nplugin"));
    }
}
