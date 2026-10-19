//! Green coffee inventory. A coffee's green left is derived on every read:
//!
//! `remaining = max(0, purchased - roasted green + correction)`
//!
//! Roasted green is the green input of every roast that ran on the coffee:
//! completed roasts, and interrupted roasts (aborted or faulted beans were
//! still used), with or without an imported log. Planned roasts and discarded
//! plans consumed nothing. Archived roasts still consumed their green.
//! Nothing is accumulated, so edits, reassignment and re-import can never
//! double count.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};

/// Roasts that consumed green coffee, for a coffee row aliased `c`.
pub const ROASTED_GREEN_FOR_COFFEE: &str = "(SELECT coalesce(sum(r.green_input_mass_mg), 0) FROM roasts r WHERE r.coffee_id = c.id AND (r.status = 'completed' OR (r.status = 'interrupted' AND r.discarded_at_ms IS NULL)))";

/// The green coffee every run roast of `coffee_id` consumed, in mg.
pub fn roasted_green_mg(connection: &Connection, coffee_id: i64) -> rusqlite::Result<i64> {
    connection.query_row(
        &format!("SELECT {ROASTED_GREEN_FOR_COFFEE} FROM coffees c WHERE c.id = ?"),
        [coffee_id],
        |row| row.get(0),
    )
}

/// Derived green left, never negative.
pub fn remaining_mg(purchased: i64, roasted_green: i64, correction: i64) -> i64 {
    (purchased - roasted_green + correction).max(0)
}

/// Roasted green per coffee before a roast change, so the change can be compared.
pub fn snapshot(
    connection: &Connection,
    coffee_ids: impl IntoIterator<Item = Option<i64>>,
) -> rusqlite::Result<BTreeMap<i64, i64>> {
    coffee_ids
        .into_iter()
        .flatten()
        .map(|id| Ok((id, roasted_green_mg(connection, id)?)))
        .collect()
}

/// A roast change that moves a coffee's derived green left also moves that
/// coffee's revision, so a form opened earlier cannot silently overwrite it.
pub fn touch_changed(
    connection: &Connection,
    before: &BTreeMap<i64, i64>,
    now_ms: i64,
) -> rusqlite::Result<()> {
    for (&coffee_id, &roasted) in before {
        if roasted_green_mg(connection, coffee_id)? != roasted {
            connection.execute(
                "UPDATE coffees SET updated_at_ms = ?, revision = revision + 1 WHERE id = ?",
                params![now_ms, coffee_id],
            )?;
        }
    }
    Ok(())
}
