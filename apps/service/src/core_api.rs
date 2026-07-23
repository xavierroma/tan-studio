use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use chrono::{DateTime, TimeDelta, Utc};
use futures_util::StreamExt;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use utoipa::OpenApi;
use uuid::Uuid;

use crate::{
    api::ApiState,
    core_contract::*,
    error::{ApiError, ApiResult, ProblemDetails},
};

#[utoipa::path(get, path = "/api/v1/openapi.json", tag = "contract", operation_id = "getOpenApi", responses((status = 200, body = Value)))]
pub async fn openapi_get() -> Json<Value> {
    Json(serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes"))
}

#[utoipa::path(get, path = "/api/v1/profiles", tag = "profiles", operation_id = "listProfiles", params(ListQuery), responses((status = 200, body = ProfilePage), (status = 401, body = ProblemDetails)))]
pub async fn profiles_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<ProfilePage>> {
    let connection = state.database.connection();
    let pattern = format!(
        "%{}%",
        escape_like(query.q.as_deref().unwrap_or_default().trim())
    );
    let mut statement = connection.prepare(
        "SELECT id FROM profiles
         WHERE (? = '%%' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
         ORDER BY name COLLATE NOCASE, id",
    )?;
    let ids = statement
        .query_map(params![pattern, pattern, pattern], |row| {
            row.get::<_, i64>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(ProfilePage {
        items: ids
            .into_iter()
            .map(|id| get_profile_summary(&connection, id))
            .collect::<ApiResult<_>>()?,
    }))
}

#[utoipa::path(post, path = "/api/v1/profiles", tag = "profiles", operation_id = "createProfile", request_body = ProfileCreate, responses((status = 201, body = ProfileResource), (status = 422, body = ProblemDetails)))]
pub async fn profiles_create(
    State(state): State<ApiState>,
    Json(input): Json<ProfileCreate>,
) -> ApiResult<(StatusCode, Json<ProfileResource>)> {
    let connection = state.database.connection();
    let profile = create_profile_record(&connection, input)?;
    Ok((StatusCode::CREATED, Json(profile)))
}

#[utoipa::path(get, path = "/api/v1/profiles/{id}", tag = "profiles", operation_id = "getProfile", params(("id" = i64, Path)), responses((status = 200, body = ProfileResource), (status = 404, body = ProblemDetails)))]
pub async fn profiles_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<ProfileResource>> {
    Ok(Json(get_profile(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/profiles/{id}", tag = "profiles", operation_id = "updateProfile", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = ProfilePatch, responses((status = 200, body = ProfileResource), (status = 412, body = ProblemDetails)))]
pub async fn profiles_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<ProfilePatch>,
) -> ApiResult<Json<ProfileResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_profile(&connection, id)?;
    let parent = input.parent_profile_id.unwrap_or(current.parent_profile_id);
    if parent == Some(id) {
        return Err(ApiError::validation("A profile cannot be its own parent."));
    }
    ensure_optional_exists(&connection, "profiles", parent)?;
    let name = input.name.unwrap_or(current.name);
    validate_name(&name)?;
    let level = input
        .recommended_level_thousandths
        .unwrap_or(current.recommended_level_thousandths);
    let load = input.reference_load_mg.unwrap_or(current.reference_load_mg);
    validate_profile_values(level, load)?;
    let profile = input.profile.unwrap_or(current.profile);
    validate_object(&profile, "profile")?;
    let changed = connection.execute(
        "UPDATE profiles SET parent_profile_id=?, name=?, description=?, designer=?,
         recommended_level_thousandths=?, reference_load_mg=?, profile_json=?, updated_at_ms=?, revision=revision+1
         WHERE id=? AND revision=?",
        params![parent, name.trim(), input.description.unwrap_or(current.description).trim(),
            input.designer.unwrap_or(current.designer).trim(), level, load, json_text(&profile)?, now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_profile(&connection, id)?))
}

#[utoipa::path(post, path = "/api/v1/profiles/{id}/children", tag = "profiles", operation_id = "createChildProfile", params(("id" = i64, Path)), request_body = ProfileCreate, responses((status = 201, body = ProfileResource)))]
pub async fn profiles_create_child(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    Json(mut input): Json<ProfileCreate>,
) -> ApiResult<(StatusCode, Json<ProfileResource>)> {
    let connection = state.database.connection();
    let parent = get_profile(&connection, id)?;
    input.parent_profile_id = Some(id);
    if input.profile == json!({}) {
        input.profile = parent.profile;
    }
    if input.description.is_empty() {
        input.description = parent.description;
    }
    if input.designer.is_empty() {
        input.designer = parent.designer;
    }
    let profile = create_profile_record(&connection, input)?;
    Ok((StatusCode::CREATED, Json(profile)))
}

#[utoipa::path(get, path = "/api/v1/profiles/{id}/roasts", tag = "profiles", operation_id = "listProfileRoasts", params(("id" = i64, Path)), responses((status = 200, body = RoastPage)))]
pub async fn profiles_roasts(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<RoastPage>> {
    let connection = state.database.connection();
    get_profile(&connection, id)?;
    Ok(Json(RoastPage {
        items: list_roast_summaries(&connection, Some(id), None, None, None)?,
    }))
}

#[utoipa::path(get, path = "/api/v1/profiles/{id}/context", tag = "profiles", operation_id = "getProfileContext", params(("id" = i64, Path)), responses((status = 200, body = ContextResource)))]
pub async fn profiles_context(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<ContextResource>> {
    let connection = state.database.connection();
    let profile = get_profile(&connection, id)?;
    Ok(Json(ContextResource {
        profile: Some(profile),
        coffee: None,
        roast: None,
        brews: vec![],
        notes: list_notes(&connection, Some("profile"), Some(id), None)?,
        rest: None,
    }))
}

#[utoipa::path(get, path = "/api/v1/coffees", tag = "coffees", operation_id = "listCoffees", params(ListQuery), responses((status = 200, body = CoffeePage)))]
pub async fn coffees_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<CoffeePage>> {
    let connection = state.database.connection();
    let pattern = format!(
        "%{}%",
        escape_like(query.q.as_deref().unwrap_or_default().trim())
    );
    let mut statement = connection.prepare(
        "SELECT id FROM coffees WHERE archived_at_ms IS NULL AND
         (? = '%%' OR name LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR country LIKE ? ESCAPE '\\' OR region LIKE ? ESCAPE '\\' OR farm LIKE ? ESCAPE '\\' OR process LIKE ? ESCAPE '\\')
         ORDER BY name COLLATE NOCASE, id",
    )?;
    let ids = statement
        .query_map(
            params![pattern, pattern, pattern, pattern, pattern, pattern, pattern],
            |row| row.get::<_, i64>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(CoffeePage {
        items: ids
            .into_iter()
            .map(|id| get_coffee(&connection, id))
            .collect::<ApiResult<_>>()?,
    }))
}

#[utoipa::path(post, path = "/api/v1/coffees", tag = "coffees", operation_id = "createCoffee", request_body = CoffeeCreate, responses((status = 201, body = CoffeeResource), (status = 422, body = ProblemDetails)))]
pub async fn coffees_create(
    State(state): State<ApiState>,
    Json(input): Json<CoffeeCreate>,
) -> ApiResult<(StatusCode, Json<CoffeeResource>)> {
    validate_coffee_input(
        &input.name,
        input.purchased_mass_mg,
        input.remaining_mass_mg,
        input.altitude_min_m,
        input.altitude_max_m,
        &input.metadata,
    )?;
    let now = now_ms();
    let connection = state.database.connection();
    connection.execute(
        "INSERT INTO coffees(name, provider, provider_url, provider_product_id, purchase_reference, purchased_at_ms,
         price_minor, currency_code, purchased_mass_mg, remaining_mass_mg, country, region, farm, producer,
         washing_station, process, variety, altitude_min_m, altitude_max_m, harvest, storage_location,
         metadata_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![input.name.trim(), input.provider.trim(), input.provider_url.trim(), input.provider_product_id.trim(), input.purchase_reference.trim(),
            optional_instant(input.purchased_at.as_deref())?, input.price_minor, normalize_currency(input.currency_code)?, input.purchased_mass_mg,
            input.remaining_mass_mg, input.country.trim(), input.region.trim(), input.farm.trim(), input.producer.trim(), input.washing_station.trim(),
            input.process.trim(), input.variety.trim(), input.altitude_min_m, input.altitude_max_m, input.harvest.trim(), input.storage_location.trim(),
            json_text(&input.metadata)?, now, now],
    )?;
    let id = connection.last_insert_rowid();
    refresh_coffee_fts(&connection, id)?;
    Ok((StatusCode::CREATED, Json(get_coffee(&connection, id)?)))
}

#[utoipa::path(get, path = "/api/v1/coffees/{id}", tag = "coffees", operation_id = "getCoffee", params(("id" = i64, Path)), responses((status = 200, body = CoffeeResource), (status = 404, body = ProblemDetails)))]
pub async fn coffees_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<CoffeeResource>> {
    Ok(Json(get_coffee(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/coffees/{id}", tag = "coffees", operation_id = "updateCoffee", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = CoffeePatch, responses((status = 200, body = CoffeeResource), (status = 412, body = ProblemDetails)))]
pub async fn coffees_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<CoffeePatch>,
) -> ApiResult<Json<CoffeeResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_coffee(&connection, id)?;
    let name = input.name.unwrap_or(current.name);
    let purchased = input.purchased_mass_mg.unwrap_or(current.purchased_mass_mg);
    let remaining = input.remaining_mass_mg.unwrap_or(current.remaining_mass_mg);
    let min = input.altitude_min_m.unwrap_or(current.altitude_min_m);
    let max = input.altitude_max_m.unwrap_or(current.altitude_max_m);
    let metadata = input.metadata.unwrap_or(current.metadata);
    validate_coffee_input(&name, purchased, remaining, min, max, &metadata)?;
    let changed = connection.execute(
        "UPDATE coffees SET name=?, provider=?, provider_url=?, provider_product_id=?, purchase_reference=?, purchased_at_ms=?,
         price_minor=?, currency_code=?, purchased_mass_mg=?, remaining_mass_mg=?, country=?, region=?, farm=?, producer=?,
         washing_station=?, process=?, variety=?, altitude_min_m=?, altitude_max_m=?, harvest=?, storage_location=?, metadata_json=?,
         updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![name.trim(), input.provider.unwrap_or(current.provider).trim(), input.provider_url.unwrap_or(current.provider_url).trim(),
            input.provider_product_id.unwrap_or(current.provider_product_id).trim(), input.purchase_reference.unwrap_or(current.purchase_reference).trim(),
            match input.purchased_at { Some(value) => optional_instant(value.as_deref())?, None => optional_instant(current.purchased_at.as_deref())? },
            input.price_minor.unwrap_or(current.price_minor), normalize_currency(input.currency_code.unwrap_or(current.currency_code))?, purchased, remaining,
            input.country.unwrap_or(current.country).trim(), input.region.unwrap_or(current.region).trim(), input.farm.unwrap_or(current.farm).trim(),
            input.producer.unwrap_or(current.producer).trim(), input.washing_station.unwrap_or(current.washing_station).trim(), input.process.unwrap_or(current.process).trim(),
            input.variety.unwrap_or(current.variety).trim(), min, max, input.harvest.unwrap_or(current.harvest).trim(),
            input.storage_location.unwrap_or(current.storage_location).trim(), json_text(&metadata)?, now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    refresh_coffee_fts(&connection, id)?;
    Ok(Json(get_coffee(&connection, id)?))
}

#[utoipa::path(get, path = "/api/v1/coffees/{id}/roasts", tag = "coffees", operation_id = "listCoffeeRoasts", params(("id" = i64, Path)), responses((status = 200, body = RoastPage)))]
pub async fn coffees_roasts(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<RoastPage>> {
    let connection = state.database.connection();
    get_coffee(&connection, id)?;
    Ok(Json(RoastPage {
        items: list_roast_summaries(&connection, None, Some(id), None, None)?,
    }))
}

#[utoipa::path(get, path = "/api/v1/coffees/{id}/context", tag = "coffees", operation_id = "getCoffeeContext", params(("id" = i64, Path)), responses((status = 200, body = ContextResource)))]
pub async fn coffees_context(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<ContextResource>> {
    let connection = state.database.connection();
    Ok(Json(ContextResource {
        profile: None,
        coffee: Some(get_coffee(&connection, id)?),
        roast: None,
        brews: vec![],
        notes: list_notes(&connection, Some("coffee"), Some(id), None)?,
        rest: None,
    }))
}

#[utoipa::path(get, path = "/api/v1/roasts", tag = "roasts", operation_id = "listRoasts", params(ListQuery), responses((status = 200, body = RoastPage)))]
pub async fn roasts_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<RoastPage>> {
    let connection = state.database.connection();
    Ok(Json(RoastPage {
        items: list_roast_summaries(
            &connection,
            query.profile_id,
            query.coffee_id,
            query.status.as_deref(),
            query.q.as_deref(),
        )?,
    }))
}

#[utoipa::path(post, path = "/api/v1/roasts", tag = "roasts", operation_id = "createRoast", request_body = RoastCreate, responses((status = 201, body = RoastResource), (status = 422, body = ProblemDetails)))]
pub async fn roasts_create(
    State(state): State<ApiState>,
    Json(input): Json<RoastCreate>,
) -> ApiResult<(StatusCode, Json<RoastResource>)> {
    validate_object(&input.adjustments, "adjustments")?;
    validate_object(&input.roaster_parameters, "roasterParameters")?;
    if input
        .level_thousandths
        .is_some_and(|value| !(0..=10_000).contains(&value))
    {
        return Err(ApiError::validation(
            "levelThousandths must be between 0 and 10000.",
        ));
    }
    if input.green_input_mass_mg.is_some_and(|value| value <= 0) {
        return Err(ApiError::validation("greenInputMassMg must be positive."));
    }
    let connection = state.database.connection();
    ensure_exists(&connection, "profiles", input.profile_id)?;
    ensure_optional_exists(&connection, "coffees", input.coffee_id)?;
    if let Some(active_id) = connection
        .query_row(
            "SELECT id FROM roasts WHERE status='planned' ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "active_roast_exists",
            "A roast is already prepared",
            format!("Finish, synchronize, or discard roast #{active_id} before preparing another."),
        ));
    }
    let snapshot: String = connection.query_row(
        "SELECT profile_json FROM profiles WHERE id=?",
        [input.profile_id],
        |row| row.get(0),
    )?;
    let id: i64 = connection.query_row("SELECT coalesce(max(id),0)+1 FROM roasts", [], |row| {
        row.get(0)
    })?;
    let now = now_ms();
    connection.execute(
        "INSERT INTO roasts(id, profile_id, coffee_id, roasted_at_ms, roasted_at_source, source_timezone,
         status, result, level_thousandths, green_input_mass_mg, profile_snapshot_json, adjustments_json,
         roaster_parameters_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, 'unknown', 'UTC', 'planned', 'unknown', ?, ?, ?, ?, ?, ?, ?)",
        params![id, input.profile_id, input.coffee_id, now, input.level_thousandths, input.green_input_mass_mg,
            snapshot, json_text(&input.adjustments)?, json_text(&input.roaster_parameters)?, now, now],
    )?;
    Ok((StatusCode::CREATED, Json(get_roast(&connection, id)?)))
}

#[utoipa::path(get, path = "/api/v1/roasts/{id}", tag = "roasts", operation_id = "getRoast", params(("id" = i64, Path)), responses((status = 200, body = RoastResource), (status = 404, body = ProblemDetails)))]
pub async fn roasts_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<RoastResource>> {
    Ok(Json(get_roast(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/roasts/{id}", tag = "roasts", operation_id = "updateRoast", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = RoastPatch, responses((status = 200, body = RoastResource), (status = 412, body = ProblemDetails)))]
pub async fn roasts_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoastPatch>,
) -> ApiResult<Json<RoastResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_roast(&connection, id)?;
    let profile_id = input
        .profile_id
        .unwrap_or(current.profile.as_ref().map(|v| v.id));
    let coffee_id = input
        .coffee_id
        .unwrap_or(current.coffee.as_ref().map(|v| v.id));
    let (
        current_roasted_at_ms,
        current_roasted_at_source,
        current_source_timezone,
        current_user_roasted_at_ms,
    ): (i64, String, String, Option<i64>) = connection.query_row(
        "SELECT roasted_at_ms, roasted_at_source, source_timezone, user_roasted_at_ms FROM roasts WHERE id=?",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let source_timezone = input
        .source_timezone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&current_source_timezone);
    if source_timezone.len() > 128 {
        return Err(ApiError::validation(
            "sourceTimezone must be at most 128 characters.",
        ));
    }
    let (roasted_at_ms, roasted_at_source, user_roasted_at_ms) = match input.roasted_at.as_ref() {
        Some(Some(value)) => {
            let parsed = parse_instant(value)?;
            (parsed, current_roasted_at_source.clone(), Some(parsed))
        }
        Some(None) => (now_ms(), "unknown".into(), None),
        None => (
            current_roasted_at_ms,
            current_roasted_at_source,
            current_user_roasted_at_ms,
        ),
    };
    ensure_optional_exists(&connection, "profiles", profile_id)?;
    ensure_optional_exists(&connection, "coffees", coffee_id)?;
    let status = input.status.unwrap_or(current.status);
    let result = input.result.unwrap_or(current.result);
    validate_roast_values(
        &status,
        &result,
        input.level_thousandths.unwrap_or(current.level_thousandths),
        input
            .green_input_mass_mg
            .unwrap_or(current.green_input_mass_mg),
        input
            .roasted_yield_mass_mg
            .unwrap_or(current.roasted_yield_mass_mg),
        input
            .development_basis_points
            .unwrap_or(current.development_basis_points),
    )?;
    let profile_snapshot = if input.profile_id.is_some() {
        profile_id
            .map(|profile_id| {
                connection.query_row(
                    "SELECT profile_json FROM profiles WHERE id=?",
                    [profile_id],
                    |row| row.get::<_, String>(0),
                )
            })
            .transpose()?
            .unwrap_or_else(|| "{}".into())
    } else {
        json_text(&current.profile_snapshot)?
    };
    let adjustments = input.adjustments.unwrap_or(current.adjustments);
    let parameters = input
        .roaster_parameters
        .unwrap_or(current.roaster_parameters);
    validate_object(&adjustments, "adjustments")?;
    validate_object(&parameters, "roasterParameters")?;
    let changed = connection.execute(
        "UPDATE roasts SET profile_id=?, coffee_id=?, roasted_at_ms=?, roasted_at_source=?, user_roasted_at_ms=?, source_timezone=?, status=?, result=?, level_thousandths=?, green_input_mass_mg=?,
         roasted_yield_mass_mg=?, development_basis_points=?, adjustments_json=?, roaster_parameters_json=?,
         profile_snapshot_json=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![profile_id, coffee_id, roasted_at_ms, roasted_at_source, user_roasted_at_ms, source_timezone, status, result,
            input.level_thousandths.unwrap_or(current.level_thousandths), input.green_input_mass_mg.unwrap_or(current.green_input_mass_mg),
            input.roasted_yield_mass_mg.unwrap_or(current.roasted_yield_mass_mg), input.development_basis_points.unwrap_or(current.development_basis_points),
            json_text(&adjustments)?, json_text(&parameters)?, profile_snapshot, now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_roast(&connection, id)?))
}

#[utoipa::path(get, path = "/api/v1/roasts/{id}/series", tag = "roasts", operation_id = "getRoastSeries", params(("id" = i64, Path), SeriesQuery), responses((status = 200, body = SeriesResponse), (status = 409, body = ProblemDetails)))]
pub async fn roasts_series(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    Query(query): Query<SeriesQuery>,
) -> ApiResult<Json<SeriesResponse>> {
    let connection = state.database.connection();
    get_roast(&connection, id)?;
    let current: i64 = connection
        .query_row(
            "SELECT stream_version FROM roast_sample_streams WHERE roast_id=?",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| ApiError::not_found("sample stream", &id.to_string()))?;
    if current != query.stream_version {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "stream_version_changed",
            "Stream version changed",
            "Reload the roast snapshot before requesting telemetry again.",
        ));
    }
    let from = query.from_elapsed_ms.unwrap_or(-3_600_000);
    let to = query.to_elapsed_ms.unwrap_or(604_800_000);
    let maximum = query.max_points.unwrap_or(2_000).clamp(2, 10_000);
    let mut statement = connection.prepare(
        "SELECT sample_seq, elapsed_ms, temperature_milli_c, profile_temperature_milli_c,
         ror_milli_c_per_min, spot_temperature_milli_c, mean_temperature_milli_c,
         profile_ror_milli_c_per_min, desired_ror_milli_c_per_min, power_milli_kw,
         actual_fan_rpm, values_json FROM roast_series_points
         WHERE roast_id=? AND elapsed_ms BETWEEN ? AND ? ORDER BY sample_seq",
    )?;
    let all = statement
        .query_map(params![id, from, to], map_series_point)?
        .collect::<Result<Vec<_>, _>>()?;
    let points = downsample(all, maximum);
    Ok(Json(SeriesResponse {
        roast_id: id,
        stream_version: current,
        points,
    }))
}

#[utoipa::path(get, path = "/api/v1/roasts/{id}/context", tag = "roasts", operation_id = "getRoastContext", params(("id" = i64, Path)), responses((status = 200, body = ContextResource)))]
pub async fn roasts_context(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<ContextResource>> {
    let connection = state.database.connection();
    let roast = get_roast(&connection, id)?;
    let profile = roast
        .profile
        .as_ref()
        .map(|v| get_profile(&connection, v.id))
        .transpose()?;
    let coffee = roast
        .coffee
        .as_ref()
        .map(|v| get_coffee(&connection, v.id))
        .transpose()?;
    let settings = get_settings(&connection)?;
    let rest = Some(rest_window(&roast, &settings));
    Ok(Json(ContextResource {
        profile,
        coffee,
        roast: Some(roast),
        brews: list_brews(&connection, Some(id))?,
        notes: list_notes(&connection, Some("roast"), Some(id), None)?,
        rest,
    }))
}

#[utoipa::path(get, path = "/api/v1/pantry", tag = "roasts", operation_id = "getPantry", responses((status = 200, body = PantryResource)))]
pub async fn pantry_get(State(state): State<ApiState>) -> ApiResult<Json<PantryResource>> {
    let connection = state.database.connection();
    let settings = get_settings(&connection)?;
    let roast_ids = list_roast_summaries(&connection, None, None, Some("completed"), None)?
        .into_iter()
        .map(|roast| roast.id)
        .collect::<Vec<_>>();
    let mut items = Vec::new();
    for roast_id in roast_ids {
        let roast = get_roast(&connection, roast_id)?;
        let consumed: i64 = connection.query_row(
            "SELECT coalesce(sum(coffee_mass_mg),0) FROM brews WHERE roast_id=?",
            [roast.id],
            |row| row.get(0),
        )?;
        let initial = roast
            .roasted_yield_mass_mg
            .or(roast.green_input_mass_mg)
            .unwrap_or(0);
        let latest_tasting = connection.query_row(
            "SELECT n.body FROM notes n JOIN note_links l ON l.note_id=n.id WHERE l.roast_id=? AND n.kind='tasting' ORDER BY n.created_at_ms DESC LIMIT 1",
            [roast.id], |row| row.get(0)
        ).optional()?;
        items.push(PantryRoast {
            estimated_remaining_mass_mg: (initial - consumed).max(0),
            rest: rest_window(&roast, &settings),
            latest_tasting,
            roast,
        });
    }
    items.retain(|item| item.estimated_remaining_mass_mg > 0);
    items.sort_by_key(|item| {
        (
            rest_priority(&item.rest.state),
            item.rest.suggested_until.clone(),
            item.roast.id,
        )
    });
    Ok(Json(PantryResource { items }))
}

#[utoipa::path(get, path = "/api/v1/brews", tag = "brews", operation_id = "listBrews", params(ListQuery), responses((status = 200, body = BrewPage)))]
pub async fn brews_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<BrewPage>> {
    Ok(Json(BrewPage {
        items: list_brews(&state.database.connection(), query.roast_id)?,
    }))
}

#[utoipa::path(post, path = "/api/v1/brews", tag = "brews", operation_id = "createBrew", request_body = BrewCreate, responses((status = 201, body = BrewResource), (status = 422, body = ProblemDetails)))]
pub async fn brews_create(
    State(state): State<ApiState>,
    Json(input): Json<BrewCreate>,
) -> ApiResult<(StatusCode, Json<BrewResource>)> {
    let mut connection = state.database.connection();
    get_roast(&connection, input.roast_id)?;
    let defaults = get_settings(&connection)?;
    let coffee_mass = input
        .coffee_mass_mg
        .unwrap_or(defaults.default_coffee_mass_mg);
    let water_mass = input
        .water_mass_mg
        .unwrap_or(defaults.default_water_mass_mg);
    if coffee_mass <= 0 || water_mass <= 0 {
        return Err(ApiError::validation("Brew masses must be positive."));
    }
    validate_object(&input.recipe, "recipe")?;
    let now = now_ms();
    let brewed = input
        .brewed_at
        .as_deref()
        .map(parse_instant)
        .transpose()?
        .unwrap_or(now);
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO brews(roast_id, brewed_at_ms, source_timezone, method, grinder, grinder_setting, kettle, water,
         coffee_mass_mg, water_mass_mg, water_temperature_milli_c, recipe_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![input.roast_id, brewed, input.source_timezone.unwrap_or_else(|| "UTC".into()), input.method.unwrap_or(defaults.default_brew_method),
            input.grinder.unwrap_or(defaults.default_grinder), input.grinder_setting.unwrap_or(defaults.default_grinder_setting),
            input.kettle.unwrap_or(defaults.default_kettle), input.water.unwrap_or(defaults.default_water), coffee_mass, water_mass,
            input.water_temperature_milli_c.or(Some(defaults.default_water_temperature_milli_c)), json_text(&input.recipe)?, now, now],
    )?;
    let id = transaction.last_insert_rowid();
    if let Some(body) = input.note.filter(|value| !value.trim().is_empty()) {
        transaction.execute(
            "INSERT INTO notes(kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms) VALUES ('tasting', ?, ?, '{}', 'user', ?, ?)",
            params![body.trim(), input.rating_basis_points, now, now],
        )?;
        let note_id = transaction.last_insert_rowid();
        transaction.execute(
            "INSERT INTO note_links(note_id, brew_id) VALUES (?, ?)",
            params![note_id, id],
        )?;
        transaction.execute(
            "INSERT INTO note_links(note_id, roast_id) VALUES (?, ?)",
            params![note_id, input.roast_id],
        )?;
    }
    transaction.commit()?;
    Ok((StatusCode::CREATED, Json(get_brew(&connection, id)?)))
}

#[utoipa::path(get, path = "/api/v1/brews/{id}", tag = "brews", operation_id = "getBrew", params(("id" = i64, Path)), responses((status = 200, body = BrewResource)))]
pub async fn brews_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<BrewResource>> {
    Ok(Json(get_brew(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/brews/{id}", tag = "brews", operation_id = "updateBrew", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = BrewPatch, responses((status = 200, body = BrewResource), (status = 412, body = ProblemDetails)))]
pub async fn brews_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<BrewPatch>,
) -> ApiResult<Json<BrewResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_brew(&connection, id)?;
    let recipe = input.recipe.unwrap_or(current.recipe);
    validate_object(&recipe, "recipe")?;
    let coffee_mass = input.coffee_mass_mg.unwrap_or(current.coffee_mass_mg);
    let water_mass = input.water_mass_mg.unwrap_or(current.water_mass_mg);
    if coffee_mass <= 0 || water_mass <= 0 {
        return Err(ApiError::validation("Brew masses must be positive."));
    }
    let changed = connection.execute(
        "UPDATE brews SET method=?, grinder=?, grinder_setting=?, kettle=?, water=?, coffee_mass_mg=?, water_mass_mg=?,
         water_temperature_milli_c=?, recipe_json=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![input.method.unwrap_or(current.method), input.grinder.unwrap_or(current.grinder), input.grinder_setting.unwrap_or(current.grinder_setting),
            input.kettle.unwrap_or(current.kettle), input.water.unwrap_or(current.water), coffee_mass, water_mass,
            input.water_temperature_milli_c.unwrap_or(current.water_temperature_milli_c), json_text(&recipe)?, now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_brew(&connection, id)?))
}

#[utoipa::path(get, path = "/api/v1/notes", tag = "notes", operation_id = "listNotes", params(ListQuery), responses((status = 200, body = NotePage)))]
pub async fn notes_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<NotePage>> {
    Ok(Json(NotePage {
        items: list_notes(
            &state.database.connection(),
            query.resource_type.as_deref(),
            query.resource_id,
            query.q.as_deref(),
        )?,
    }))
}

#[utoipa::path(post, path = "/api/v1/notes", tag = "notes", operation_id = "createNote", request_body = NoteCreate, responses((status = 201, body = NoteResource), (status = 422, body = ProblemDetails)))]
pub async fn notes_create(
    State(state): State<ApiState>,
    Json(input): Json<NoteCreate>,
) -> ApiResult<(StatusCode, Json<NoteResource>)> {
    validate_note(
        &input.kind,
        &input.body,
        input.rating_basis_points,
        &input.attributes,
        &input.source,
        &input.links,
    )?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    validate_links(&transaction, &input.links)?;
    let now = now_ms();
    transaction.execute("INSERT INTO notes(kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![input.kind, input.body.trim(), input.rating_basis_points, json_text(&input.attributes)?, input.source, now, now])?;
    let id = transaction.last_insert_rowid();
    insert_links(&transaction, id, &input.links)?;
    transaction.commit()?;
    refresh_note_fts(&connection, id)?;
    Ok((StatusCode::CREATED, Json(get_note(&connection, id)?)))
}

#[utoipa::path(get, path = "/api/v1/notes/{id}", tag = "notes", operation_id = "getNote", params(("id" = i64, Path)), responses((status = 200, body = NoteResource)))]
pub async fn notes_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<NoteResource>> {
    Ok(Json(get_note(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/notes/{id}", tag = "notes", operation_id = "updateNote", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = NotePatch, responses((status = 200, body = NoteResource), (status = 412, body = ProblemDetails)))]
pub async fn notes_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<NotePatch>,
) -> ApiResult<Json<NoteResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_note(&connection, id)?;
    let kind = input.kind.unwrap_or(current.kind);
    let body = input.body.unwrap_or(current.body);
    let rating = input
        .rating_basis_points
        .unwrap_or(current.rating_basis_points);
    let attributes = input.attributes.unwrap_or(current.attributes);
    validate_note(
        &kind,
        &body,
        rating,
        &attributes,
        &current.source,
        &current.links,
    )?;
    let changed = connection.execute("UPDATE notes SET kind=?, body=?, rating_basis_points=?, attributes_json=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![kind, body.trim(), rating, json_text(&attributes)?, now_ms(), id, expected])?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    refresh_note_fts(&connection, id)?;
    Ok(Json(get_note(&connection, id)?))
}

#[utoipa::path(put, path = "/api/v1/notes/{id}/links", tag = "notes", operation_id = "replaceNoteLinks", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = NoteLinksPut, responses((status = 200, body = NoteResource), (status = 412, body = ProblemDetails)))]
pub async fn notes_put_links(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<NoteLinksPut>,
) -> ApiResult<Json<NoteResource>> {
    let expected = expected_revision(&headers)?;
    if input.links.is_empty() {
        return Err(ApiError::validation(
            "A note must remain linked to at least one resource.",
        ));
    }
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    get_note(&transaction, id)?;
    validate_links(&transaction, &input.links)?;
    let changed = transaction.execute(
        "UPDATE notes SET updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    transaction.execute("DELETE FROM note_links WHERE note_id=?", [id])?;
    insert_links(&transaction, id, &input.links)?;
    transaction.commit()?;
    Ok(Json(get_note(&connection, id)?))
}

#[utoipa::path(delete, path = "/api/v1/notes/{id}", tag = "notes", operation_id = "deleteNote", params(("id" = i64, Path), ("If-Match" = String, Header)), responses((status = 204), (status = 412, body = ProblemDetails)))]
pub async fn notes_delete(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let changed = connection.execute(
        "DELETE FROM notes WHERE id=? AND revision=?",
        params![id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    connection.execute(
        "DELETE FROM studio_fts WHERE resource_type='note' AND resource_id=?",
        [id],
    )?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/v1/attachments", tag = "attachments", operation_id = "listAttachments", params(ListQuery), responses((status = 200, body = AttachmentPage)))]
pub async fn attachments_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<AttachmentPage>> {
    let connection = state.database.connection();
    let pattern = format!(
        "%{}%",
        escape_like(query.q.as_deref().unwrap_or_default().trim())
    );
    let ids = match (query.resource_type.as_deref(), query.resource_id) {
        (Some(kind), Some(resource_id)) => {
            let column = link_column(kind)?;
            let mut statement = connection.prepare(&format!(
                "SELECT DISTINCT a.id FROM attachments a
                 JOIN attachment_links l ON l.attachment_id=a.id
                 WHERE l.{column}=? AND (?='%%' OR a.title LIKE ? ESCAPE '\\' OR a.filename LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')
                 ORDER BY a.created_at_ms DESC, a.id DESC LIMIT 1000"
            ))?;
            let ids = statement
                .query_map(
                    params![resource_id, pattern, pattern, pattern, pattern],
                    |row| row.get::<_, i64>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        }
        (None, None) => {
            let mut statement = connection.prepare(
                "SELECT id FROM attachments
                 WHERE (?='%%' OR title LIKE ? ESCAPE '\\' OR filename LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
                 ORDER BY created_at_ms DESC, id DESC LIMIT 1000",
            )?;
            let ids = statement
                .query_map(params![pattern, pattern, pattern, pattern], |row| {
                    row.get::<_, i64>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        }
        _ => {
            return Err(ApiError::validation(
                "resourceType and resourceId must be supplied together.",
            ))
        }
    };
    Ok(Json(AttachmentPage {
        items: ids
            .into_iter()
            .map(|id| get_attachment(&connection, id))
            .collect::<ApiResult<_>>()?,
    }))
}

#[utoipa::path(post, path = "/api/v1/attachments", tag = "attachments", operation_id = "createAttachment", request_body = AttachmentCreate, responses((status = 201, body = AttachmentResource), (status = 422, body = ProblemDetails)))]
pub async fn attachments_create(
    State(state): State<ApiState>,
    Json(input): Json<AttachmentCreate>,
) -> ApiResult<(StatusCode, Json<AttachmentResource>)> {
    validate_attachment_fields(
        &input.title,
        &input.filename,
        &input.media_type,
        input.source_url.as_deref(),
        &input.description,
        &input.links,
    )?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    validate_attachment_links(&transaction, &input.links, &input.media_type)?;
    let now = now_ms();
    transaction.execute(
        "INSERT INTO attachments(title, filename, media_type, source_url, description, captured_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            input.title.trim(),
            input.filename.trim(),
            input.media_type.trim().to_ascii_lowercase(),
            input.source_url.as_deref().map(str::trim),
            input.description.trim(),
            optional_instant(input.captured_at.as_deref())?,
            now,
            now
        ],
    )?;
    let id = transaction.last_insert_rowid();
    insert_attachment_links(&transaction, id, &input.links)?;
    transaction.commit()?;
    Ok((StatusCode::CREATED, Json(get_attachment(&connection, id)?)))
}

#[utoipa::path(get, path = "/api/v1/attachments/{id}", tag = "attachments", operation_id = "getAttachment", params(("id" = i64, Path)), responses((status = 200, body = AttachmentResource), (status = 404, body = ProblemDetails)))]
pub async fn attachments_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<AttachmentResource>> {
    Ok(Json(get_attachment(&state.database.connection(), id)?))
}

#[utoipa::path(patch, path = "/api/v1/attachments/{id}", tag = "attachments", operation_id = "updateAttachment", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = AttachmentPatch, responses((status = 200, body = AttachmentResource), (status = 412, body = ProblemDetails)))]
pub async fn attachments_patch(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<AttachmentPatch>,
) -> ApiResult<Json<AttachmentResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_attachment(&connection, id)?;
    let title = input.title.unwrap_or(current.title);
    let filename = input.filename.unwrap_or(current.filename);
    let media_type = input.media_type.unwrap_or(current.media_type);
    let source_url = input.source_url.unwrap_or(current.source_url);
    let description = input.description.unwrap_or(current.description);
    let captured_at = input.captured_at.unwrap_or(current.captured_at);
    validate_attachment_fields(
        &title,
        &filename,
        &media_type,
        source_url.as_deref(),
        &description,
        &current.links,
    )?;
    validate_attachment_links(&connection, &current.links, &media_type)?;
    let changed = connection.execute(
        "UPDATE attachments SET title=?, filename=?, media_type=?, source_url=?, description=?, captured_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![title.trim(), filename.trim(), media_type.trim().to_ascii_lowercase(), source_url.as_deref().map(str::trim), description.trim(), optional_instant(captured_at.as_deref())?, now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_attachment(&connection, id)?))
}

#[utoipa::path(put, path = "/api/v1/attachments/{id}/links", tag = "attachments", operation_id = "replaceAttachmentLinks", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body = AttachmentLinksPut, responses((status = 200, body = AttachmentResource), (status = 412, body = ProblemDetails)))]
pub async fn attachments_put_links(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<AttachmentLinksPut>,
) -> ApiResult<Json<AttachmentResource>> {
    let expected = expected_revision(&headers)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let attachment = get_attachment(&transaction, id)?;
    validate_attachment_links(&transaction, &input.links, &attachment.media_type)?;
    let changed = transaction.execute(
        "UPDATE attachments SET updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![now_ms(), id, expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    transaction.execute("DELETE FROM attachment_links WHERE attachment_id=?", [id])?;
    insert_attachment_links(&transaction, id, &input.links)?;
    transaction.commit()?;
    Ok(Json(get_attachment(&connection, id)?))
}

#[utoipa::path(put, path = "/api/v1/entity-profile-images/{resource_type}/{resource_id}", tag = "attachments", operation_id = "setEntityProfileImage", params(("resource_type" = String, Path), ("resource_id" = i64, Path)), request_body = EntityProfileImagePut, responses((status = 204), (status = 422, body = ProblemDetails)))]
pub async fn entity_profile_image_put(
    State(state): State<ApiState>,
    Path((resource_type, resource_id)): Path<(String, i64)>,
    Json(input): Json<EntityProfileImagePut>,
) -> ApiResult<StatusCode> {
    let column = link_column(&resource_type)?;
    let table = link_table(&resource_type)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    ensure_exists(&transaction, table, resource_id)?;
    if let Some(attachment_id) = input.attachment_id {
        let media_type: String = transaction
            .query_row(
                "SELECT media_type FROM attachments WHERE id=?",
                [attachment_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| ApiError::not_found("attachment", &attachment_id.to_string()))?;
        if !media_type.starts_with("image/") {
            return Err(ApiError::validation(
                "Only image attachments can be used as a profile image.",
            ));
        }
        let linked = transaction.query_row(
            &format!(
                "SELECT EXISTS(
                   SELECT 1 FROM attachment_links
                   WHERE attachment_id=? AND {column}=?
                 )"
            ),
            params![attachment_id, resource_id],
            |row| row.get::<_, bool>(0),
        )?;
        if !linked {
            return Err(ApiError::validation(
                "The profile image must already be attached to this resource.",
            ));
        }
        transaction.execute(
            &format!(
                "UPDATE attachment_links SET role='gallery'
                 WHERE {column}=? AND role='profile'"
            ),
            [resource_id],
        )?;
        transaction.execute(
            &format!(
                "UPDATE attachment_links SET role='profile'
                 WHERE attachment_id=? AND {column}=?"
            ),
            params![attachment_id, resource_id],
        )?;
    } else {
        transaction.execute(
            &format!(
                "UPDATE attachment_links SET role='gallery'
                 WHERE {column}=? AND role='profile'"
            ),
            [resource_id],
        )?;
    }
    transaction.commit()?;
    Ok(StatusCode::NO_CONTENT)
}

const MAX_ATTACHMENT_BYTES: u64 = 512 * 1024 * 1024;

#[utoipa::path(put, path = "/api/v1/attachments/{id}/content", tag = "attachments", operation_id = "putAttachmentContent", params(("id" = i64, Path), ("If-Match" = String, Header)), request_body(content = String, content_type = "application/octet-stream"), responses((status = 200, body = AttachmentResource), (status = 413, body = ProblemDetails), (status = 412, body = ProblemDetails)))]
pub async fn attachments_put_content(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Body,
) -> ApiResult<Json<AttachmentResource>> {
    let expected = expected_revision(&headers)?;
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|value| value == 0 || value > MAX_ATTACHMENT_BYTES)
    {
        return Err(attachment_size_error());
    }
    let previous_hash = {
        let connection = state.database.connection();
        let current = get_attachment(&connection, id)?;
        if current.revision != expected {
            return Err(ApiError::revision());
        }
        current.sha256
    };

    let temporary_path = state
        .attachment_root
        .join(".tmp")
        .join(Uuid::now_v7().to_string());
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .await
        .map_err(|error| attachment_io_error(error, "create"))?;
    let mut stream = body.into_data_stream();
    let mut hasher = Sha256::new();
    let mut byte_length = 0_u64;
    let write_result: ApiResult<()> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| attachment_io_error(error, "receive"))?;
            byte_length = byte_length.saturating_add(chunk.len() as u64);
            if byte_length > MAX_ATTACHMENT_BYTES {
                return Err(attachment_size_error());
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|error| attachment_io_error(error, "write"))?;
        }
        if byte_length == 0 {
            return Err(attachment_size_error());
        }
        file.sync_all()
            .await
            .map_err(|error| attachment_io_error(error, "flush"))?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(error) = write_result {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }

    let hash = hex::encode(hasher.finalize());
    let object_directory = state.attachment_root.join("objects").join(&hash[..2]);
    tokio::fs::create_dir_all(&object_directory)
        .await
        .map_err(|error| attachment_io_error(error, "create"))?;
    let object_path = object_directory.join(&hash);
    if tokio::fs::try_exists(&object_path)
        .await
        .map_err(|error| attachment_io_error(error, "inspect"))?
    {
        tokio::fs::remove_file(&temporary_path)
            .await
            .map_err(|error| attachment_io_error(error, "deduplicate"))?;
    } else {
        tokio::fs::rename(&temporary_path, &object_path)
            .await
            .map_err(|error| attachment_io_error(error, "commit"))?;
    }

    let updated = {
        let connection = state.database.connection();
        let changed = connection.execute(
            "UPDATE attachments SET byte_length=?, sha256=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
            params![byte_length as i64, hash, now_ms(), id, expected],
        )?;
        if changed == 0 {
            return Err(ApiError::revision());
        }
        get_attachment(&connection, id)?
    };

    if let Some(previous_hash) = previous_hash.filter(|value| value != &hash) {
        let still_referenced = {
            let connection = state.database.connection();
            connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM attachments WHERE sha256=?)",
                [&previous_hash],
                |row| row.get::<_, bool>(0),
            )?
        };
        if !still_referenced {
            let old_path = state
                .attachment_root
                .join("objects")
                .join(&previous_hash[..2])
                .join(previous_hash);
            let _ = tokio::fs::remove_file(old_path).await;
        }
    }
    Ok(Json(updated))
}

#[utoipa::path(get, path = "/api/v1/attachments/{id}/content", tag = "attachments", operation_id = "getAttachmentContent", params(("id" = i64, Path)), responses((status = 200, body = String, content_type = "application/octet-stream"), (status = 404, body = ProblemDetails)))]
pub async fn attachments_get_content(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Response> {
    let (hash, filename, media_type, byte_length) = {
        let connection = state.database.connection();
        let attachment = get_attachment(&connection, id)?;
        (
            attachment.sha256.ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "attachment_content_missing",
                    "Attachment content missing",
                    "This attachment record does not have local file content yet.",
                )
            })?,
            attachment.filename,
            attachment.media_type,
            attachment.byte_length.unwrap_or(0),
        )
    };
    let object_path = state
        .attachment_root
        .join("objects")
        .join(&hash[..2])
        .join(&hash);
    let file = tokio::fs::File::open(object_path)
        .await
        .map_err(|error| attachment_io_error(error, "open"))?;
    let mut response = Response::new(Body::from_stream(ReaderStream::new(file)));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&media_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    if let Ok(value) = HeaderValue::from_str(&byte_length.to_string()) {
        response.headers_mut().insert(header::CONTENT_LENGTH, value);
    }
    let safe_filename: String = filename
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, ' ' | '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if let Ok(value) =
        HeaderValue::from_str(&format!("inline; filename=\"{}\"", safe_filename.trim()))
    {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, value);
    }
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"sha256:{hash}\"")).expect("hex hash is a valid header"),
    );
    Ok(response)
}

#[utoipa::path(get, path = "/api/v1/labels", tag = "labels", operation_id = "listLabels", params(ListQuery), responses((status = 200, body = LabelPage)))]
pub async fn labels_list(
    State(state): State<ApiState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<LabelPage>> {
    let connection = state.database.connection();
    let mut statement = connection.prepare("SELECT id FROM labels WHERE (? IS NULL OR roast_id=?) ORDER BY created_at_ms DESC, id DESC")?;
    let ids = statement
        .query_map(params![query.roast_id, query.roast_id], |row| {
            row.get::<_, i64>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(LabelPage {
        items: ids
            .into_iter()
            .map(|id| get_label(&connection, id))
            .collect::<ApiResult<_>>()?,
    }))
}

#[utoipa::path(post, path = "/api/v1/labels", tag = "labels", operation_id = "createLabel", request_body = LabelCreate, responses((status = 201, body = LabelResource)))]
pub async fn labels_create(
    State(state): State<ApiState>,
    Json(input): Json<LabelCreate>,
) -> ApiResult<(StatusCode, Json<LabelResource>)> {
    if input.copies <= 0 {
        return Err(ApiError::validation("Copies must be positive."));
    }
    validate_object(&input.content, "content")?;
    let connection = state.database.connection();
    get_roast(&connection, input.roast_id)?;
    let defaults = get_settings(&connection)?;
    let now = now_ms();
    let content = if input.content == json!({}) {
        json!({"roastId": input.roast_id, "qrPayload": format!("tan:roast:{}", input.roast_id)})
    } else {
        input.content
    };
    connection.execute("INSERT INTO labels(roast_id, copies, width_micrometers, height_micrometers, content_json, printer, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?)",
        params![input.roast_id, input.copies, input.width_micrometers.or(Some(defaults.default_label_width_micrometers)), input.height_micrometers.or(Some(defaults.default_label_height_micrometers)), json_text(&content)?, input.printer, now, now])?;
    Ok((
        StatusCode::CREATED,
        Json(get_label(&connection, connection.last_insert_rowid())?),
    ))
}

#[utoipa::path(get, path = "/api/v1/labels/{id}", tag = "labels", operation_id = "getLabel", params(("id" = i64, Path)), responses((status = 200, body = LabelResource)))]
pub async fn labels_get(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<LabelResource>> {
    Ok(Json(get_label(&state.database.connection(), id)?))
}

#[utoipa::path(get, path = "/api/v1/settings", tag = "settings", operation_id = "getSettings", responses((status = 200, body = SettingsResource)))]
pub async fn settings_get(State(state): State<ApiState>) -> ApiResult<Json<SettingsResource>> {
    Ok(Json(get_settings(&state.database.connection())?))
}

#[utoipa::path(patch, path = "/api/v1/settings", tag = "settings", operation_id = "updateSettings", params(("If-Match" = String, Header)), request_body = SettingsPatch, responses((status = 200, body = SettingsResource), (status = 412, body = ProblemDetails)))]
pub async fn settings_patch(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<SettingsPatch>,
) -> ApiResult<Json<SettingsResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_settings(&connection)?;
    let mut values = serde_json::to_value(&current)
        .expect("settings serialize")
        .as_object()
        .cloned()
        .unwrap_or_default();
    values.remove("updatedAt");
    values.remove("revision");
    for (key, value) in serde_json::to_value(input)
        .expect("settings patch serializes")
        .as_object()
        .cloned()
        .unwrap_or_default()
    {
        if !value.is_null() {
            values.insert(key, value);
        }
    }
    validate_settings(&values)?;
    let changed = connection.execute("UPDATE settings SET values_json=?, updated_at_ms=?, revision=revision+1 WHERE id=1 AND revision=?", params![Value::Object(values).to_string(), now_ms(), expected])?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_settings(&connection)?))
}

#[utoipa::path(get, path = "/api/v1/ui-preferences", tag = "ui-preferences", operation_id = "getUiPreferences", responses((status = 200, body = UiPreferencesResource)))]
pub async fn ui_preferences_get(
    State(state): State<ApiState>,
) -> ApiResult<Json<UiPreferencesResource>> {
    Ok(Json(get_ui_preferences(&state.database.connection())?))
}

#[utoipa::path(patch, path = "/api/v1/ui-preferences", tag = "ui-preferences", operation_id = "updateUiPreferences", params(("If-Match" = String, Header)), request_body = UiPreferencesPatch, responses((status = 200, body = UiPreferencesResource), (status = 412, body = ProblemDetails), (status = 422, body = ProblemDetails)))]
pub async fn ui_preferences_patch(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<UiPreferencesPatch>,
) -> ApiResult<Json<UiPreferencesResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_ui_preferences(&connection)?;
    let density = input
        .default_table_density
        .unwrap_or(current.default_table_density);
    if !matches!(density.as_str(), "compact" | "expanded") {
        return Err(ApiError::validation(
            "defaultTableDensity must be compact or expanded.",
        ));
    }
    let tables = input.table_preferences.unwrap_or(current.table_preferences);
    validate_table_preferences(&tables)?;
    let changed = connection.execute(
        "UPDATE ui_preferences
         SET default_table_density=?, table_preferences_json=?,
             updated_at_ms=?, revision=revision+1
         WHERE id=1 AND revision=?",
        params![density, json_text(&tables)?, now_ms(), expected],
    )?;
    if changed == 0 {
        return Err(ApiError::revision());
    }
    Ok(Json(get_ui_preferences(&connection)?))
}

fn get_profile(connection: &Connection, id: i64) -> ApiResult<ProfileResource> {
    let mut profile = connection.query_row(
        "SELECT p.*, (SELECT count(*) FROM roasts r WHERE r.profile_id=p.id), (SELECT count(*) FROM profiles c WHERE c.parent_profile_id=p.id) FROM profiles p WHERE p.id=?",
        [id], |row| Ok(ProfileResource {
            id: row.get("id")?, parent_profile_id: row.get("parent_profile_id")?, name: row.get("name")?, description: row.get("description")?, designer: row.get("designer")?, origin: row.get("origin")?,
            recommended_level_thousandths: row.get("recommended_level_thousandths")?, reference_load_mg: row.get("reference_load_mg")?,
            profile: json_column(row.get("profile_json")?), source_hash: row.get("source_hash")?, roast_count: row.get(14)?, child_count: row.get(15)?,
            profile_image_attachment_id: None,
            created_at: iso(row.get("created_at_ms")?), updated_at: iso(row.get("updated_at_ms")?), revision: row.get("revision")?,
        })
    ).optional()?.ok_or_else(|| ApiError::not_found("profile", &id.to_string()))?;
    profile.profile_image_attachment_id = profile_image_attachment_id(connection, "profile", id)?;
    Ok(profile)
}

fn get_profile_summary(connection: &Connection, id: i64) -> ApiResult<ProfileSummary> {
    let mut profile = connection
        .query_row(
            "SELECT p.id, p.parent_profile_id, p.name, p.origin,
                    p.recommended_level_thousandths, p.reference_load_mg,
                    (SELECT count(*) FROM roasts r WHERE r.profile_id=p.id),
                    (SELECT count(*) FROM profiles c WHERE c.parent_profile_id=p.id),
                    p.updated_at_ms, p.revision
             FROM profiles p WHERE p.id=?",
            [id],
            |row| {
                Ok(ProfileSummary {
                    id: row.get(0)?,
                    parent_profile_id: row.get(1)?,
                    name: row.get(2)?,
                    origin: row.get(3)?,
                    recommended_level_thousandths: row.get(4)?,
                    reference_load_mg: row.get(5)?,
                    roast_count: row.get(6)?,
                    child_count: row.get(7)?,
                    profile_image_attachment_id: None,
                    updated_at: iso(row.get(8)?),
                    revision: row.get(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| ApiError::not_found("profile", &id.to_string()))?;
    profile.profile_image_attachment_id = profile_image_attachment_id(connection, "profile", id)?;
    Ok(profile)
}

fn get_coffee(connection: &Connection, id: i64) -> ApiResult<CoffeeResource> {
    let mut coffee = connection.query_row(
        "SELECT c.*, (SELECT count(*) FROM roasts r WHERE r.coffee_id=c.id) FROM coffees c WHERE c.id=? AND c.archived_at_ms IS NULL",
        [id], map_coffee
    ).optional()?.ok_or_else(|| ApiError::not_found("coffee", &id.to_string()))?;
    coffee.profile_image_attachment_id = profile_image_attachment_id(connection, "coffee", id)?;
    Ok(coffee)
}

fn map_coffee(row: &Row<'_>) -> rusqlite::Result<CoffeeResource> {
    Ok(CoffeeResource {
        id: row.get("id")?,
        name: row.get("name")?,
        provider: row.get("provider")?,
        provider_url: row.get("provider_url")?,
        provider_product_id: row.get("provider_product_id")?,
        purchase_reference: row.get("purchase_reference")?,
        purchased_at: optional_iso(row.get("purchased_at_ms")?),
        price_minor: row.get("price_minor")?,
        currency_code: row.get("currency_code")?,
        purchased_mass_mg: row.get("purchased_mass_mg")?,
        remaining_mass_mg: row.get("remaining_mass_mg")?,
        country: row.get("country")?,
        region: row.get("region")?,
        farm: row.get("farm")?,
        producer: row.get("producer")?,
        washing_station: row.get("washing_station")?,
        process: row.get("process")?,
        variety: row.get("variety")?,
        altitude_min_m: row.get("altitude_min_m")?,
        altitude_max_m: row.get("altitude_max_m")?,
        harvest: row.get("harvest")?,
        storage_location: row.get("storage_location")?,
        metadata: json_column(row.get("metadata_json")?),
        roast_count: row.get(27)?,
        profile_image_attachment_id: None,
        created_at: iso(row.get("created_at_ms")?),
        updated_at: iso(row.get("updated_at_ms")?),
        revision: row.get("revision")?,
    })
}

fn list_roast_summaries(
    connection: &Connection,
    profile_id: Option<i64>,
    coffee_id: Option<i64>,
    status: Option<&str>,
    q: Option<&str>,
) -> ApiResult<Vec<RoastSummary>> {
    let pattern = format!("%{}%", escape_like(q.unwrap_or_default().trim()));
    let mut statement = connection.prepare(
        "SELECT r.id FROM roasts r LEFT JOIN profiles p ON p.id=r.profile_id LEFT JOIN coffees c ON c.id=r.coffee_id
         WHERE (? IS NULL OR r.profile_id=?) AND (? IS NULL OR r.coffee_id=?) AND (? IS NULL OR r.status=?)
           AND (?='%%' OR CAST(r.id AS TEXT) LIKE ? OR p.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.provider LIKE ? ESCAPE '\\')
         ORDER BY r.id DESC LIMIT 1000",
    )?;
    let ids = statement
        .query_map(
            params![
                profile_id, profile_id, coffee_id, coffee_id, status, status, pattern, pattern,
                pattern, pattern, pattern
            ],
            |row| row.get::<_, i64>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    ids.into_iter()
        .map(|id| get_roast_summary(connection, id))
        .collect()
}

fn get_roast_summary(connection: &Connection, id: i64) -> ApiResult<RoastSummary> {
    let mut roast = connection
        .query_row(
            "SELECT r.id, r.profile_id, p.name, r.coffee_id, c.name,
                    coalesce(r.user_roasted_at_ms, r.roasted_at_ms),
                    CASE WHEN r.user_roasted_at_ms IS NOT NULL THEN 'user' ELSE r.roasted_at_source END,
                    r.status, r.result,
                    r.level_thousandths, r.green_input_mass_mg,
                    r.roasted_yield_mass_mg, r.duration_ms,
                    (SELECT count(*) FROM brews b WHERE b.roast_id=r.id),
                    (SELECT count(DISTINCT l.note_id) FROM note_links l
                      WHERE l.roast_id=r.id OR l.brew_id IN
                        (SELECT id FROM brews WHERE roast_id=r.id)),
                    (SELECT count(*) FROM labels x WHERE x.roast_id=r.id),
                    r.revision
             FROM roasts r
             LEFT JOIN profiles p ON p.id=r.profile_id
             LEFT JOIN coffees c ON c.id=r.coffee_id
             WHERE r.id=?",
            [id],
            |row| {
                let profile_id: Option<i64> = row.get(1)?;
                let coffee_id: Option<i64> = row.get(3)?;
                let roasted_at_source: String = row.get(6)?;
                Ok(RoastSummary {
                    id: row.get(0)?,
                    profile: profile_id.map(|id| ResourceReference {
                        id,
                        name: row
                            .get::<_, Option<String>>(2)
                            .unwrap_or_default()
                            .unwrap_or_default(),
                    }),
                    coffee: coffee_id.map(|id| ResourceReference {
                        id,
                        name: row
                            .get::<_, Option<String>>(4)
                            .unwrap_or_default()
                            .unwrap_or_default(),
                    }),
                    roasted_at: (roasted_at_source != "unknown")
                        .then(|| iso(row.get::<_, i64>(5).unwrap_or_default())),
                    roasted_at_source,
                    status: row.get(7)?,
                    result: row.get(8)?,
                    level_thousandths: row.get(9)?,
                    green_input_mass_mg: row.get(10)?,
                    roasted_yield_mass_mg: row.get(11)?,
                    duration_ms: row.get(12)?,
                    brew_count: row.get(13)?,
                    note_count: row.get(14)?,
                    label_count: row.get(15)?,
                    profile_image_attachment_id: None,
                    revision: row.get(16)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| ApiError::not_found("roast", &id.to_string()))?;
    roast.profile_image_attachment_id = profile_image_attachment_id(connection, "roast", id)?;
    Ok(roast)
}

fn get_roast(connection: &Connection, id: i64) -> ApiResult<RoastResource> {
    let mut roast = connection.query_row(
        "SELECT r.*, p.name profile_name, c.name coffee_name,
          (SELECT count(*) FROM brews b WHERE b.roast_id=r.id) brew_count,
          (SELECT count(DISTINCT l.note_id) FROM note_links l WHERE l.roast_id=r.id OR l.brew_id IN (SELECT id FROM brews WHERE roast_id=r.id)) note_count,
          (SELECT count(*) FROM labels x WHERE x.roast_id=r.id) label_count,
          s.stream_version, s.row_count, s.first_elapsed_ms, s.last_elapsed_ms, s.reconciliation_state
         FROM roasts r LEFT JOIN profiles p ON p.id=r.profile_id LEFT JOIN coffees c ON c.id=r.coffee_id
         LEFT JOIN roast_sample_streams s ON s.roast_id=r.id WHERE r.id=?",
        [id], |row| {
          let user_roasted_at_ms: Option<i64> = row.get("user_roasted_at_ms")?;
          let stored_roasted_at_source: String = row.get("roasted_at_source")?;
          let roasted_at_source = if user_roasted_at_ms.is_some() { "user".into() } else { stored_roasted_at_source };
          let roasted_at_ms = user_roasted_at_ms.unwrap_or(row.get("roasted_at_ms")?);
          Ok(RoastResource {
            id: row.get("id")?,
            profile: row.get::<_, Option<i64>>("profile_id")?.map(|id| ResourceReference { id, name: row.get::<_, Option<String>>("profile_name").unwrap_or_default().unwrap_or_default() }),
            coffee: row.get::<_, Option<i64>>("coffee_id")?.map(|id| ResourceReference { id, name: row.get::<_, Option<String>>("coffee_name").unwrap_or_default().unwrap_or_default() }),
            roasted_at: (roasted_at_source != "unknown").then(|| iso(roasted_at_ms)), roasted_at_source, source_timezone: row.get("source_timezone")?, status: row.get("status")?, result: row.get("result")?,
            level_thousandths: row.get("level_thousandths")?, green_input_mass_mg: row.get("green_input_mass_mg")?, roasted_yield_mass_mg: row.get("roasted_yield_mass_mg")?, development_basis_points: row.get("development_basis_points")?, duration_ms: row.get("duration_ms")?, end_reason: row.get("end_reason")?, native_log_number: row.get("native_log_number")?,
            profile_snapshot: json_column(row.get("profile_snapshot_json")?), adjustments: json_column(row.get("adjustments_json")?), roaster_parameters: json_column(row.get("roaster_parameters_json")?), native_metadata: json_column(row.get("native_metadata_json")?), import_warnings: json_array(row.get("import_warnings_json")?),
            sample_stream: row.get::<_, Option<i64>>("stream_version")?.map(|stream_version| SampleStreamResource { stream_version, row_count: row.get("row_count").unwrap_or(0), first_elapsed_ms: row.get("first_elapsed_ms").unwrap_or(0), last_elapsed_ms: row.get("last_elapsed_ms").unwrap_or(0), reconciliation_state: row.get("reconciliation_state").unwrap_or_else(|_| "reconciled".into()) }),
            events: vec![], brew_count: row.get("brew_count")?, note_count: row.get("note_count")?, label_count: row.get("label_count")?,
            profile_image_attachment_id: None,
            created_at: iso(row.get("created_at_ms")?), updated_at: iso(row.get("updated_at_ms")?), revision: row.get("revision")?,
        })}
    ).optional()?.ok_or_else(|| ApiError::not_found("roast", &id.to_string()))?;
    let mut events = connection.prepare("SELECT id, event_kind, elapsed_ms, temperature_milli_c, source FROM roast_events WHERE roast_id=? ORDER BY elapsed_ms, id")?;
    roast.events = events
        .query_map([id], |row| {
            Ok(RoastEvent {
                id: row.get(0)?,
                kind: row.get(1)?,
                elapsed_ms: row.get(2)?,
                temperature_milli_c: row.get(3)?,
                source: row.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    roast.profile_image_attachment_id = profile_image_attachment_id(connection, "roast", id)?;
    Ok(roast)
}

fn list_brews(connection: &Connection, roast_id: Option<i64>) -> ApiResult<Vec<BrewResource>> {
    let mut statement = connection.prepare("SELECT id FROM brews WHERE (? IS NULL OR roast_id=?) ORDER BY brewed_at_ms DESC, id DESC LIMIT 1000")?;
    let ids = statement
        .query_map(params![roast_id, roast_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.into_iter().map(|id| get_brew(connection, id)).collect()
}

fn get_brew(connection: &Connection, id: i64) -> ApiResult<BrewResource> {
    let mut brew = connection
        .query_row("SELECT * FROM brews WHERE id=?", [id], |row| {
            Ok(BrewResource {
                id: row.get("id")?,
                roast_id: row.get("roast_id")?,
                brewed_at: iso(row.get("brewed_at_ms")?),
                source_timezone: row.get("source_timezone")?,
                method: row.get("method")?,
                grinder: row.get("grinder")?,
                grinder_setting: row.get("grinder_setting")?,
                kettle: row.get("kettle")?,
                water: row.get("water")?,
                coffee_mass_mg: row.get("coffee_mass_mg")?,
                water_mass_mg: row.get("water_mass_mg")?,
                water_temperature_milli_c: row.get("water_temperature_milli_c")?,
                recipe: json_column(row.get("recipe_json")?),
                notes: vec![],
                profile_image_attachment_id: None,
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
                revision: row.get("revision")?,
            })
        })
        .optional()?
        .map(|mut brew| {
            brew.notes =
                list_notes(connection, Some("brew"), Some(brew.id), None).unwrap_or_default();
            brew
        })
        .ok_or_else(|| ApiError::not_found("brew", &id.to_string()))?;
    brew.profile_image_attachment_id = profile_image_attachment_id(connection, "brew", id)?;
    Ok(brew)
}

fn list_notes(
    connection: &Connection,
    resource_type: Option<&str>,
    resource_id: Option<i64>,
    q: Option<&str>,
) -> ApiResult<Vec<NoteResource>> {
    if resource_type.is_some() != resource_id.is_some() {
        return Err(ApiError::validation(
            "resourceType and resourceId must be provided together.",
        ));
    }
    let pattern = format!("%{}%", escape_like(q.unwrap_or_default().trim()));
    let (column, id) = if let (Some(kind), Some(id)) = (resource_type, resource_id) {
        (link_column(kind)?, Some(id))
    } else {
        ("note_id", None)
    };
    let sql = if id.is_some() {
        format!("SELECT DISTINCT n.id FROM notes n JOIN note_links l ON l.note_id=n.id WHERE l.{column}=? AND (?='%%' OR n.body LIKE ? ESCAPE '\\') ORDER BY n.created_at_ms DESC, n.id DESC LIMIT 1000")
    } else {
        "SELECT n.id FROM notes n WHERE (?='%%' OR n.body LIKE ? ESCAPE '\\') ORDER BY n.created_at_ms DESC, n.id DESC LIMIT 1000".into()
    };
    let mut statement = connection.prepare(&sql)?;
    let ids = if let Some(id) = id {
        statement
            .query_map(params![id, pattern, pattern], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map(params![pattern, pattern], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    ids.into_iter().map(|id| get_note(connection, id)).collect()
}

fn get_note(connection: &Connection, id: i64) -> ApiResult<NoteResource> {
    let mut note = connection
        .query_row("SELECT * FROM notes WHERE id=?", [id], |row| {
            Ok(NoteResource {
                id: row.get("id")?,
                kind: row.get("kind")?,
                body: row.get("body")?,
                rating_basis_points: row.get("rating_basis_points")?,
                attributes: json_column(row.get("attributes_json")?),
                source: row.get("source")?,
                links: vec![],
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
                revision: row.get("revision")?,
            })
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("note", &id.to_string()))?;
    let mut statement = connection.prepare("SELECT profile_id, coffee_id, roast_id, brew_id FROM note_links WHERE note_id=? ORDER BY id")?;
    note.links = statement
        .query_map([id], |row| {
            let values = [
                ("profile", row.get::<_, Option<i64>>(0)?),
                ("coffee", row.get::<_, Option<i64>>(1)?),
                ("roast", row.get::<_, Option<i64>>(2)?),
                ("brew", row.get::<_, Option<i64>>(3)?),
            ];
            let (resource_type, resource_id) = values
                .into_iter()
                .find_map(|(kind, value)| value.map(|id| (kind.to_owned(), id)))
                .expect("note link constraint");
            Ok(NoteLink {
                resource_type,
                resource_id,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(note)
}

fn get_attachment(connection: &Connection, id: i64) -> ApiResult<AttachmentResource> {
    let mut attachment = connection
        .query_row("SELECT * FROM attachments WHERE id=?", [id], |row| {
            Ok(AttachmentResource {
                id: row.get("id")?,
                title: row.get("title")?,
                filename: row.get("filename")?,
                media_type: row.get("media_type")?,
                byte_length: row.get("byte_length")?,
                sha256: row.get("sha256")?,
                source_url: row.get("source_url")?,
                description: row.get("description")?,
                captured_at: row.get::<_, Option<i64>>("captured_at_ms")?.map(iso),
                links: vec![],
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
                revision: row.get("revision")?,
            })
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("attachment", &id.to_string()))?;
    let mut statement = connection.prepare(
        "SELECT profile_id, coffee_id, roast_id, brew_id, role
         FROM attachment_links WHERE attachment_id=? ORDER BY id",
    )?;
    attachment.links = statement
        .query_map([id], |row| {
            let values = [
                ("profile", row.get::<_, Option<i64>>(0)?),
                ("coffee", row.get::<_, Option<i64>>(1)?),
                ("roast", row.get::<_, Option<i64>>(2)?),
                ("brew", row.get::<_, Option<i64>>(3)?),
            ];
            let (resource_type, resource_id) = values
                .into_iter()
                .find_map(|(kind, value)| value.map(|resource_id| (kind.to_owned(), resource_id)))
                .expect("attachment link constraint");
            Ok(AttachmentLink {
                resource_type,
                resource_id,
                role: row.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(attachment)
}

fn get_label(connection: &Connection, id: i64) -> ApiResult<LabelResource> {
    connection
        .query_row("SELECT * FROM labels WHERE id=?", [id], |row| {
            Ok(LabelResource {
                id: row.get("id")?,
                roast_id: row.get("roast_id")?,
                copies: row.get("copies")?,
                width_micrometers: row.get("width_micrometers")?,
                height_micrometers: row.get("height_micrometers")?,
                content: json_column(row.get("content_json")?),
                artifact_sha256: row.get("artifact_sha256")?,
                printer: row.get("printer")?,
                status: row.get("status")?,
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
            })
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("label", &id.to_string()))
}

fn get_settings(connection: &Connection) -> ApiResult<SettingsResource> {
    connection
        .query_row(
            "SELECT values_json, updated_at_ms, revision FROM settings WHERE id=1",
            [],
            |row| {
                let value: Value = json_column(row.get(0)?);
                let object = value.as_object().cloned().unwrap_or_default();
                Ok(SettingsResource {
                    default_roaster: string_value(&object, "defaultRoaster", "Kaffelogic Nano 7"),
                    default_grinder: string_value(&object, "defaultGrinder", ""),
                    default_grinder_setting: string_value(&object, "defaultGrinderSetting", ""),
                    default_kettle: string_value(&object, "defaultKettle", ""),
                    default_water: string_value(&object, "defaultWater", ""),
                    default_brew_method: string_value(&object, "defaultBrewMethod", "V60"),
                    default_coffee_mass_mg: int_value(&object, "defaultCoffeeMassMg", 15_000),
                    default_water_mass_mg: int_value(&object, "defaultWaterMassMg", 250_000),
                    default_water_temperature_milli_c: int_value(
                        &object,
                        "defaultWaterTemperatureMilliC",
                        93_000,
                    ),
                    default_rest_days: int_value(&object, "defaultRestDays", 7),
                    default_peak_days: int_value(&object, "defaultPeakDays", 21),
                    default_label_width_micrometers: int_value(
                        &object,
                        "defaultLabelWidthMicrometers",
                        50_000,
                    ),
                    default_label_height_micrometers: int_value(
                        &object,
                        "defaultLabelHeightMicrometers",
                        30_000,
                    ),
                    updated_at: iso(row.get(1)?),
                    revision: row.get(2)?,
                })
            },
        )
        .map_err(Into::into)
}

fn get_ui_preferences(connection: &Connection) -> ApiResult<UiPreferencesResource> {
    connection
        .query_row(
            "SELECT default_table_density, table_preferences_json, updated_at_ms, revision
         FROM ui_preferences WHERE id=1",
            [],
            |row| {
                Ok(UiPreferencesResource {
                    default_table_density: row.get(0)?,
                    table_preferences: json_column(row.get(1)?),
                    updated_at: iso(row.get(2)?),
                    revision: row.get(3)?,
                })
            },
        )
        .map_err(Into::into)
}

fn profile_image_attachment_id(
    connection: &Connection,
    resource_type: &str,
    resource_id: i64,
) -> ApiResult<Option<i64>> {
    let column = link_column(resource_type)?;
    Ok(connection
        .query_row(
            &format!(
                "SELECT attachment_id FROM attachment_links
                 WHERE {column}=? AND role='profile'
                 LIMIT 1"
            ),
            [resource_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn create_profile_record(
    connection: &Connection,
    input: ProfileCreate,
) -> ApiResult<ProfileResource> {
    validate_name(&input.name)?;
    validate_object(&input.profile, "profile")?;
    validate_profile_values(input.recommended_level_thousandths, input.reference_load_mg)?;
    ensure_optional_exists(connection, "profiles", input.parent_profile_id)?;
    let now = now_ms();
    connection.execute(
        "INSERT INTO profiles(parent_profile_id, name, description, designer, origin,
          recommended_level_thousandths, reference_load_mg, profile_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)",
        params![input.parent_profile_id, input.name.trim(), input.description.trim(), input.designer.trim(),
            input.recommended_level_thousandths, input.reference_load_mg, json_text(&input.profile)?, now, now],
    )?;
    get_profile(connection, connection.last_insert_rowid())
}

fn map_series_point(row: &Row<'_>) -> rusqlite::Result<SeriesPoint> {
    Ok(SeriesPoint {
        sample_seq: row.get(0)?,
        elapsed_ms: row.get(1)?,
        temperature_milli_c: row.get(2)?,
        profile_temperature_milli_c: row.get(3)?,
        ror_milli_c_per_min: row.get(4)?,
        spot_temperature_milli_c: row.get(5)?,
        mean_temperature_milli_c: row.get(6)?,
        profile_ror_milli_c_per_min: row.get(7)?,
        desired_ror_milli_c_per_min: row.get(8)?,
        power_milli_kw: row.get(9)?,
        actual_fan_rpm: row.get(10)?,
        native: json_column(row.get(11)?),
    })
}

fn downsample(points: Vec<SeriesPoint>, maximum: usize) -> Vec<SeriesPoint> {
    if points.len() <= maximum {
        return points;
    }
    let last = points.len() - 1;
    (0..maximum)
        .map(|index| &points[index * last / (maximum - 1)])
        .cloned()
        .collect()
}

fn insert_links(connection: &Connection, note_id: i64, links: &[NoteLink]) -> ApiResult<()> {
    for link in links {
        let column = link_column(&link.resource_type)?;
        connection.execute(
            &format!("INSERT OR IGNORE INTO note_links(note_id, {column}) VALUES (?, ?)"),
            params![note_id, link.resource_id],
        )?;
    }
    Ok(())
}
fn insert_attachment_links(
    connection: &Connection,
    attachment_id: i64,
    links: &[AttachmentLink],
) -> ApiResult<()> {
    for link in links {
        let column = link_column(&link.resource_type)?;
        connection.execute(
            &format!(
                "INSERT OR IGNORE INTO attachment_links(attachment_id, {column}, role)
                 VALUES (?, ?, ?)"
            ),
            params![attachment_id, link.resource_id, link.role],
        )?;
    }
    Ok(())
}
fn validate_attachment_links(
    connection: &Connection,
    links: &[AttachmentLink],
    media_type: &str,
) -> ApiResult<()> {
    if links.is_empty() {
        return Err(ApiError::validation(
            "An attachment must link to at least one resource.",
        ));
    }
    for link in links {
        if !matches!(link.role.as_str(), "gallery" | "profile") {
            return Err(ApiError::validation(
                "Attachment role must be gallery or profile.",
            ));
        }
        if link.role == "profile" && !media_type.starts_with("image/") {
            return Err(ApiError::validation(
                "Only image attachments can be used as a profile image.",
            ));
        }
        let table = link_table(&link.resource_type)?;
        ensure_exists(connection, table, link.resource_id)?;
    }
    Ok(())
}
fn validate_links(connection: &Connection, links: &[NoteLink]) -> ApiResult<()> {
    if links.is_empty() {
        return Err(ApiError::validation(
            "A note must link to at least one resource.",
        ));
    }
    for link in links {
        let table = link_table(&link.resource_type)?;
        ensure_exists(connection, table, link.resource_id)?;
    }
    Ok(())
}
fn link_column(kind: &str) -> ApiResult<&'static str> {
    match kind {
        "profile" => Ok("profile_id"),
        "coffee" => Ok("coffee_id"),
        "roast" => Ok("roast_id"),
        "brew" => Ok("brew_id"),
        _ => Err(ApiError::validation(
            "resourceType must be profile, coffee, roast, or brew.",
        )),
    }
}
fn link_table(kind: &str) -> ApiResult<&'static str> {
    match kind {
        "profile" => Ok("profiles"),
        "coffee" => Ok("coffees"),
        "roast" => Ok("roasts"),
        "brew" => Ok("brews"),
        _ => Err(ApiError::validation(
            "resourceType must be profile, coffee, roast, or brew.",
        )),
    }
}
fn ensure_exists(connection: &Connection, table: &'static str, id: i64) -> ApiResult<()> {
    let exists = connection
        .query_row(&format!("SELECT 1 FROM {table} WHERE id=?"), [id], |_| {
            Ok(())
        })
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ApiError::not_found("resource", &id.to_string()))
    }
}
fn ensure_optional_exists(
    connection: &Connection,
    table: &'static str,
    id: Option<i64>,
) -> ApiResult<()> {
    id.map(|id| ensure_exists(connection, table, id))
        .transpose()
        .map(|_| ())
}

fn validate_note(
    kind: &str,
    body: &str,
    rating: Option<i64>,
    attributes: &Value,
    source: &str,
    links: &[NoteLink],
) -> ApiResult<()> {
    if !matches!(
        kind,
        "observation" | "tasting" | "annotation" | "recommendation" | "general"
    ) {
        return Err(ApiError::validation("Unknown note kind."));
    }
    if body.trim().is_empty() || body.len() > 100_000 {
        return Err(ApiError::validation(
            "A note body is required and must be at most 100,000 characters.",
        ));
    }
    if rating.is_some_and(|v| !(0..=10_000).contains(&v)) {
        return Err(ApiError::validation(
            "ratingBasisPoints must be between 0 and 10000.",
        ));
    }
    if !matches!(source, "user" | "import" | "device" | "agent") {
        return Err(ApiError::validation("Unknown note source."));
    }
    validate_object(attributes, "attributes")?;
    if links.is_empty() {
        return Err(ApiError::validation(
            "A note must link to at least one resource.",
        ));
    }
    Ok(())
}

fn validate_attachment_fields(
    title: &str,
    filename: &str,
    media_type: &str,
    source_url: Option<&str>,
    description: &str,
    links: &[AttachmentLink],
) -> ApiResult<()> {
    if title.trim().is_empty() || title.len() > 300 {
        return Err(ApiError::validation(
            "title is required and must be at most 300 characters.",
        ));
    }
    if filename.trim().is_empty() || filename.len() > 255 || filename.contains(['/', '\\', '\0']) {
        return Err(ApiError::validation(
            "filename must be a simple local filename of at most 255 characters.",
        ));
    }
    if media_type.trim().is_empty()
        || media_type.len() > 200
        || !media_type.contains('/')
        || media_type.contains(['\r', '\n', '\0'])
    {
        return Err(ApiError::validation("mediaType is invalid."));
    }
    if source_url.is_some_and(|url| {
        url.len() > 4_096
            || !(url.starts_with("https://") || url.starts_with("http://"))
            || url.contains(['\r', '\n', '\0'])
    }) {
        return Err(ApiError::validation(
            "sourceUrl must be an HTTP(S) URL of at most 4096 characters.",
        ));
    }
    if description.len() > 100_000 {
        return Err(ApiError::validation(
            "description must be at most 100,000 characters.",
        ));
    }
    if links.is_empty() {
        return Err(ApiError::validation(
            "An attachment must link to at least one resource.",
        ));
    }
    Ok(())
}

fn validate_table_preferences(value: &Value) -> ApiResult<()> {
    let Some(tables) = value.as_object() else {
        return Err(ApiError::validation(
            "tablePreferences must be a JSON object.",
        ));
    };
    if tables.len() > 100 {
        return Err(ApiError::validation(
            "tablePreferences contains too many tables.",
        ));
    }
    for (table, preference) in tables {
        if table.is_empty()
            || table.len() > 64
            || !table
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(ApiError::validation(
                "Table preference keys must be short identifiers.",
            ));
        }
        let Some(preference) = preference.as_object() else {
            return Err(ApiError::validation(
                "Each table preference must be a JSON object.",
            ));
        };
        if let Some(density) = preference.get("density") {
            if !matches!(density.as_str(), Some("compact" | "expanded")) {
                return Err(ApiError::validation(
                    "Table density must be compact or expanded.",
                ));
            }
        }
        if let Some(hidden) = preference.get("hidden") {
            let Some(hidden) = hidden.as_array() else {
                return Err(ApiError::validation("Hidden columns must be an array."));
            };
            if hidden.len() > 100
                || hidden.iter().any(|column| {
                    column.as_str().is_none_or(|column| {
                        column.is_empty()
                            || column.len() > 64
                            || !column.bytes().all(|byte| {
                                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
                            })
                    })
                })
            {
                return Err(ApiError::validation(
                    "Hidden columns contain an invalid identifier.",
                ));
            }
        }
    }
    Ok(())
}

fn attachment_size_error() -> ApiError {
    ApiError::new(
        StatusCode::PAYLOAD_TOO_LARGE,
        "attachment_size_invalid",
        "Attachment size invalid",
        "Attachment content must be between 1 byte and 512 MiB.",
    )
}

fn attachment_io_error(error: impl std::fmt::Display, action: &'static str) -> ApiError {
    tracing::error!(%error, action, "attachment_store_operation_failed");
    ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "attachment_store_error",
        "Attachment store error",
        "Tan Studio could not complete the local attachment file operation.",
    )
}
fn validate_profile_values(level: Option<i64>, load: Option<i64>) -> ApiResult<()> {
    if level.is_some_and(|v| !(0..=10_000).contains(&v)) {
        return Err(ApiError::validation(
            "recommendedLevelThousandths must be between 0 and 10000.",
        ));
    }
    if load.is_some_and(|v| !(0..=10_000_000).contains(&v)) {
        return Err(ApiError::validation(
            "referenceLoadMg is outside the supported range.",
        ));
    }
    Ok(())
}
fn validate_roast_values(
    status: &str,
    result: &str,
    level: Option<i64>,
    green_input: Option<i64>,
    roasted_yield: Option<i64>,
    development: Option<i64>,
) -> ApiResult<()> {
    if !matches!(status, "planned" | "completed" | "interrupted") {
        return Err(ApiError::validation("Unknown roast status."));
    }
    if !matches!(result, "success" | "aborted" | "fault" | "unknown") {
        return Err(ApiError::validation("Unknown roast result."));
    }
    if level.is_some_and(|value| !(0..=10_000).contains(&value)) {
        return Err(ApiError::validation(
            "levelThousandths must be between 0 and 10000.",
        ));
    }
    if green_input.is_some_and(|value| value <= 0) || roasted_yield.is_some_and(|value| value < 0) {
        return Err(ApiError::validation(
            "Roast masses are outside the supported range.",
        ));
    }
    if development.is_some_and(|value| !(0..=10_000).contains(&value)) {
        return Err(ApiError::validation(
            "developmentBasisPoints must be between 0 and 10000.",
        ));
    }
    Ok(())
}
fn validate_coffee_input(
    name: &str,
    purchased: i64,
    remaining: i64,
    min: Option<i64>,
    max: Option<i64>,
    metadata: &Value,
) -> ApiResult<()> {
    validate_name(name)?;
    if purchased < 0 || remaining < 0 {
        return Err(ApiError::validation("Coffee masses cannot be negative."));
    }
    if max.zip(min).is_some_and(|(max, min)| max < min) {
        return Err(ApiError::validation(
            "altitudeMaxM cannot be lower than altitudeMinM.",
        ));
    }
    validate_object(metadata, "metadata")
}
fn validate_name(value: &str) -> ApiResult<()> {
    if value.trim().is_empty() || value.trim().len() > 200 {
        Err(ApiError::validation(
            "Name is required and must be at most 200 characters.",
        ))
    } else {
        Ok(())
    }
}
fn validate_object(value: &Value, name: &str) -> ApiResult<()> {
    if value.is_object() {
        Ok(())
    } else {
        Err(ApiError::validation(format!(
            "{name} must be a JSON object."
        )))
    }
}
fn validate_settings(values: &Map<String, Value>) -> ApiResult<()> {
    let positive = [
        "defaultCoffeeMassMg",
        "defaultWaterMassMg",
        "defaultRestDays",
        "defaultPeakDays",
        "defaultLabelWidthMicrometers",
        "defaultLabelHeightMicrometers",
    ];
    if positive.iter().any(|key| {
        values
            .get(*key)
            .and_then(Value::as_i64)
            .is_none_or(|v| v <= 0)
    }) {
        return Err(ApiError::validation(
            "Mass, rest, peak, and label defaults must be positive integers.",
        ));
    }
    let temp = values
        .get("defaultWaterTemperatureMilliC")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if !(0..=100_000).contains(&temp) {
        return Err(ApiError::validation(
            "Default water temperature must be between 0 and 100°C.",
        ));
    }
    Ok(())
}

fn refresh_coffee_fts(connection: &Connection, id: i64) -> ApiResult<()> {
    connection.execute(
        "DELETE FROM studio_fts WHERE resource_type='coffee' AND resource_id=?",
        [id],
    )?;
    connection.execute("INSERT INTO studio_fts(resource_type, resource_id, name, provider, origin, process, body) SELECT 'coffee', id, name, provider, trim(country || ' ' || region || ' ' || farm || ' ' || producer), process, '' FROM coffees WHERE id=?", [id])?;
    Ok(())
}
fn refresh_note_fts(connection: &Connection, id: i64) -> ApiResult<()> {
    connection.execute(
        "DELETE FROM studio_fts WHERE resource_type='note' AND resource_id=?",
        [id],
    )?;
    connection.execute("INSERT INTO studio_fts(resource_type, resource_id, name, provider, origin, process, body) SELECT 'note', id, '', '', '', '', body FROM notes WHERE id=?", [id])?;
    Ok(())
}

fn rest_window(roast: &RoastResource, settings: &SettingsResource) -> RestWindow {
    let roasted = roast
        .roasted_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|v| v.with_timezone(&Utc));
    let Some(roasted) = roasted else {
        return RestWindow {
            age_days: None,
            rest_days: settings.default_rest_days,
            peak_days: settings.default_peak_days,
            state: "unknown".into(),
            suggested_from: None,
            suggested_until: None,
        };
    };
    let from = roasted + TimeDelta::days(settings.default_rest_days);
    let until = roasted + TimeDelta::days(settings.default_peak_days);
    let now = Utc::now();
    let state = if now < from {
        "resting"
    } else if now <= until {
        "peak"
    } else {
        "pastPeak"
    };
    RestWindow {
        age_days: Some((now - roasted).num_days().max(0)),
        rest_days: settings.default_rest_days,
        peak_days: settings.default_peak_days,
        state: state.into(),
        suggested_from: Some(from.to_rfc3339()),
        suggested_until: Some(until.to_rfc3339()),
    }
}
fn rest_priority(state: &str) -> i32 {
    match state {
        "peak" => 0,
        "pastPeak" => 1,
        "resting" => 2,
        _ => 3,
    }
}
fn expected_revision(headers: &HeaderMap) -> ApiResult<i64> {
    headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("\"revision:"))
        .and_then(|v| v.strip_suffix('"'))
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .ok_or_else(ApiError::revision)
}
fn optional_instant(value: Option<&str>) -> ApiResult<Option<i64>> {
    value.map(parse_instant).transpose()
}
fn parse_instant(value: &str) -> ApiResult<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|v| v.timestamp_millis())
        .map_err(|_| ApiError::validation("Timestamp must be RFC 3339."))
}
fn normalize_currency(value: Option<String>) -> ApiResult<Option<String>> {
    value
        .map(|v| v.trim().to_ascii_uppercase())
        .filter(|v| !v.is_empty())
        .map(|v| {
            if v.len() == 3 && v.bytes().all(|b| b.is_ascii_alphabetic()) {
                Ok(v)
            } else {
                Err(ApiError::validation(
                    "currencyCode must be a three-letter code.",
                ))
            }
        })
        .transpose()
}
fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}
fn iso(value: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(value)
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn optional_iso(value: Option<i64>) -> Option<String> {
    value.map(iso)
}
fn json_text(value: &Value) -> ApiResult<String> {
    serde_json::to_string(value)
        .map_err(|_| ApiError::validation("JSON value is not serializable."))
}
fn json_column(value: String) -> Value {
    serde_json::from_str(&value).unwrap_or_else(|_| json!({}))
}
fn json_array(value: String) -> Vec<Value> {
    serde_json::from_str(&value).unwrap_or_default()
}
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
fn string_value(values: &Map<String, Value>, key: &str, fallback: &str) -> String {
    values
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}
fn int_value(values: &Map<String, Value>, key: &str, fallback: i64) -> i64 {
    values.get(key).and_then(Value::as_i64).unwrap_or(fallback)
}
