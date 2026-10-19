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

/// Absolute green mass, in mg, below which a lot that still has green coffee is
/// dust. Never a percentage. 0 disables dust.
pub const DEFAULT_DUST_THRESHOLD_MG: i64 = 30_000;
pub const MAX_DUST_THRESHOLD_MG: i64 = 10_000_000;

/// The one stock classification for a coffee: `usedUp` at zero, `dust` when
/// strictly below the threshold, otherwise `active`. Classification never
/// changes the balance itself.
pub fn green_stock(remaining_mg: i64, dust_threshold_mg: i64) -> &'static str {
    if remaining_mg <= 0 {
        "usedUp"
    } else if remaining_mg < dust_threshold_mg {
        "dust"
    } else {
        "active"
    }
}

/// The configured dust threshold; settings saved before it existed read the default.
pub fn dust_threshold_mg(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT json_extract(values_json, '$.greenDustThresholdMg') FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(row
                .get::<_, Option<i64>>(0)
                .ok()
                .flatten()
                .unwrap_or(DEFAULT_DUST_THRESHOLD_MG))
        },
    )
}

/// One explicit green balance write, kept internally as stock history.
pub struct Correction {
    pub coffee_id: i64,
    pub previous_remaining_mg: Option<i64>,
    pub remaining_mg: i64,
    pub previous_correction_mg: Option<i64>,
    pub correction_mg: i64,
}

/// Appends an explicit balance write to the internal correction history.
pub fn record_correction(
    connection: &Connection,
    correction: &Correction,
    now_ms: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO coffee_green_corrections (coffee_id, previous_remaining_mg, remaining_mg,
         previous_correction_mg, correction_mg, recorded_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
        params![
            correction.coffee_id,
            correction.previous_remaining_mg,
            correction.remaining_mg,
            correction.previous_correction_mg,
            correction.correction_mg,
            now_ms
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dust_is_an_absolute_threshold_and_zero_disables_it() {
        let classify = |mg| green_stock(mg, DEFAULT_DUST_THRESHOLD_MG);
        assert_eq!(classify(0), "usedUp");
        assert_eq!(classify(1), "dust");
        assert_eq!(classify(29_999), "dust");
        assert_eq!(classify(30_000), "active");
        assert_eq!(classify(30_001), "active");
        // Disabled: anything with green left is active.
        assert_eq!(green_stock(1, 0), "active");
        assert_eq!(green_stock(0, 0), "usedUp");
        // Custom absolute value, independent of how much was purchased.
        assert_eq!(green_stock(99_999, 100_000), "dust");
        assert_eq!(green_stock(100_000, 100_000), "active");
    }
}
