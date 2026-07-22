use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use rusqlite::{params, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use utoipa::{IntoParams, OpenApi};
use uuid::Uuid;

use crate::{
    config::{LaunchMode, ServiceConfig},
    contract::*,
    db::Database,
    device::NanoDeviceManager,
    error::{ApiError, ApiResult, ProblemDetails},
    kpro::{self, Document as KproDocument},
    lan_bridge,
    static_ui::{self, StaticUi},
};

#[derive(Clone)]
pub struct ApiState {
    pub(crate) config: Arc<ServiceConfig>,
    pub(crate) database: Database,
    pub(crate) device: Arc<NanoDeviceManager>,
    pub(crate) session_id: String,
    pub(crate) cursor_key: Arc<[u8]>,
    pub(crate) attachment_root: Arc<PathBuf>,
}

impl ApiState {
    pub fn new(
        config: ServiceConfig,
        database: Database,
        device: Arc<NanoDeviceManager>,
    ) -> Result<Self, ApiError> {
        let session_id = Uuid::now_v7().to_string();
        let cursor_key: Arc<[u8]> = config.launch_token.as_bytes().to_vec().into();
        let attachment_root = config
            .database_path
            .parent()
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "attachment_store_unavailable",
                    "Attachment store unavailable",
                    "The database path has no directory for local attachments.",
                )
            })?
            .join("attachments");
        std::fs::create_dir_all(attachment_root.join(".tmp")).map_err(|error| {
            tracing::error!(%error, "attachment_store_initialization_failed");
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "attachment_store_unavailable",
                "Attachment store unavailable",
                "Tan Studio could not initialize its local attachment store.",
            )
        })?;
        Ok(Self {
            config: Arc::new(config),
            database,
            device,
            session_id,
            cursor_key,
            attachment_root: Arc::new(attachment_root),
        })
    }
}

pub fn build_router(state: ApiState) -> Router {
    let api = Router::new()
        .route("/system/bootstrap", get(system_bootstrap))
        .route("/openapi.json", get(crate::core_api::openapi_get))
        .route("/device", get(device_get))
        .route("/device/refresh", post(device_refresh))
        .route("/device/synchronize", post(device_synchronize))
        .route("/bridges", get(bridges_list))
        .route("/bridges/claims", post(bridge_claim_create))
        .route(
            "/profiles",
            get(crate::core_api::profiles_list).post(crate::core_api::profiles_create),
        )
        .route(
            "/profiles/{id}",
            get(crate::core_api::profiles_get).patch(crate::core_api::profiles_patch),
        )
        .route(
            "/profiles/{id}/children",
            post(crate::core_api::profiles_create_child),
        )
        .route(
            "/profiles/{id}/roasts",
            get(crate::core_api::profiles_roasts),
        )
        .route(
            "/profiles/{id}/context",
            get(crate::core_api::profiles_context),
        )
        .route(
            "/coffees",
            get(crate::core_api::coffees_list).post(crate::core_api::coffees_create),
        )
        .route(
            "/coffees/{id}",
            get(crate::core_api::coffees_get).patch(crate::core_api::coffees_patch),
        )
        .route("/coffees/{id}/roasts", get(crate::core_api::coffees_roasts))
        .route(
            "/coffees/{id}/context",
            get(crate::core_api::coffees_context),
        )
        .route(
            "/roasts",
            get(crate::core_api::roasts_list).post(crate::core_api::roasts_create),
        )
        .route(
            "/roasts/{id}",
            get(crate::core_api::roasts_get).patch(crate::core_api::roasts_patch),
        )
        .route("/roasts/{id}/series", get(crate::core_api::roasts_series))
        .route("/roasts/{id}/context", get(crate::core_api::roasts_context))
        .route("/pantry", get(crate::core_api::pantry_get))
        .route(
            "/brews",
            get(crate::core_api::brews_list).post(crate::core_api::brews_create),
        )
        .route(
            "/brews/{id}",
            get(crate::core_api::brews_get).patch(crate::core_api::brews_patch),
        )
        .route(
            "/notes",
            get(crate::core_api::notes_list).post(crate::core_api::notes_create),
        )
        .route(
            "/notes/{id}",
            get(crate::core_api::notes_get)
                .patch(crate::core_api::notes_patch)
                .delete(crate::core_api::notes_delete),
        )
        .route(
            "/notes/{id}/links",
            axum::routing::put(crate::core_api::notes_put_links),
        )
        .route(
            "/attachments",
            get(crate::core_api::attachments_list).post(crate::core_api::attachments_create),
        )
        .route(
            "/attachments/{id}",
            get(crate::core_api::attachments_get).patch(crate::core_api::attachments_patch),
        )
        .route(
            "/attachments/{id}/links",
            axum::routing::put(crate::core_api::attachments_put_links),
        )
        .route(
            "/attachments/{id}/content",
            get(crate::core_api::attachments_get_content)
                .put(crate::core_api::attachments_put_content),
        )
        .route(
            "/labels",
            get(crate::core_api::labels_list).post(crate::core_api::labels_create),
        )
        .route("/labels/{id}", get(crate::core_api::labels_get))
        .route(
            "/settings",
            get(crate::core_api::settings_get).patch(crate::core_api::settings_patch),
        )
        .fallback(api_not_found)
        .layer(middleware::from_fn_with_state(state.clone(), api_security));

    let mut router = Router::new()
        .route("/healthz", get(health))
        .nest("/api/v1", api)
        .with_state(state.clone());
    if let (LaunchMode::Headless, Some(root)) = (state.config.mode, &state.config.web_root) {
        router = router.fallback_service(Router::new().fallback(static_ui::serve).with_state(
            StaticUi {
                root: root.clone(),
                token: state.config.launch_token.clone().into(),
            },
        ));
    }
    router.layer(middleware::from_fn_with_state(state, host_security))
}

async fn host_security(
    State(state): State<ApiState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let permitted = match state.config.mode {
        LaunchMode::Desktop => host
            .split(':')
            .next()
            .is_some_and(|name| name == "127.0.0.1" || name == "localhost"),
        LaunchMode::Headless => state
            .config
            .allowed_hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(&host)),
    };
    if !permitted {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "host_not_allowed",
            "Host not allowed",
            "The request Host is not an assigned Tan Studio authority.",
        )
        .with_request(request.uri().path(), correlation_id(request.headers()))
        .into_response();
    }
    next.run(request).await
}

async fn api_security(
    State(state): State<ApiState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let correlation = correlation_id(request.headers());
    let path = request.uri().path().to_owned();
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    if origin
        .as_deref()
        .map(|value| {
            !state
                .config
                .allowed_origins
                .iter()
                .any(|allowed| allowed == value)
        })
        .unwrap_or(!state.config.allow_originless_requests)
    {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "origin_not_allowed",
            "Origin not allowed",
            "The request Origin is not authorized for this service session.",
        )
        .with_request(path, correlation)
        .into_response();
    }
    if request.method() == Method::OPTIONS {
        let Some(origin) = origin.as_deref() else {
            return ApiError::new(
                StatusCode::FORBIDDEN,
                "origin_not_allowed",
                "Origin not allowed",
                "CORS preflight requires an authorized Origin.",
            )
            .with_request(path, correlation)
            .into_response();
        };
        let mut response = StatusCode::NO_CONTENT.into_response();
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            header::HeaderValue::from_str(origin).unwrap(),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            header::HeaderValue::from_static("Authorization, Content-Type, X-Tan-Studio-Client, If-Match, Idempotency-Key, X-Correlation-Id"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            header::HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
        );
        return response;
    }
    let client = request
        .headers()
        .get("x-tan-studio-client")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let authenticated = authorization.is_some_and(|token| {
        token.len() == state.config.launch_token.len()
            && constant_time_eq::constant_time_eq(
                token.as_bytes(),
                state.config.launch_token.as_bytes(),
            )
    });
    if !state
        .config
        .allowed_client_ids
        .iter()
        .any(|allowed| allowed == client)
        || !authenticated
    {
        return ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "Authentication required",
            "A valid Tan Studio client identity and launch token are required.",
        )
        .with_request(path, correlation)
        .into_response();
    }
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next());
    let attachment_upload = request.method() == Method::PUT
        && content_type == Some("application/octet-stream")
        && is_attachment_content_path(&path);
    if matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) && content_type != Some("application/json")
        && !attachment_upload
    {
        return ApiError::new(
            StatusCode::BAD_REQUEST,
            "unsupported_content_type",
            "Unsupported content type",
            "Mutation endpoints accept application/json only.",
        )
        .with_request(path, correlation)
        .into_response();
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        header::HeaderValue::from_static("nosniff"),
    );
    if let Ok(value) = header::HeaderValue::from_str(&correlation) {
        response.headers_mut().insert("x-correlation-id", value);
    }
    if let Some(origin) = origin.as_deref() {
        if let Ok(value) = header::HeaderValue::from_str(origin) {
            response
                .headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        }
    }
    response
}

fn is_attachment_content_path(path: &str) -> bool {
    ["/api/v1/attachments/", "/attachments/"]
        .into_iter()
        .find_map(|prefix| path.strip_prefix(prefix))
        .and_then(|suffix| suffix.strip_suffix("/content"))
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
}

async fn api_not_found(request: Request<Body>) -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "route_not_found",
        "Route not found",
        "The requested API route does not exist.",
    )
    .with_request(request.uri().path(), correlation_id(request.headers()))
}

fn correlation_id(headers: &HeaderMap) -> String {
    headers
        .get("x-correlation-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| Uuid::parse_str(value).is_ok())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::now_v7().to_string())
}

async fn health(State(state): State<ApiState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "applicationVersion": state.config.application_version,
        "database": if state.database.is_ready() { "ready" } else { "busy" },
        "device": state.device.snapshot().connection,
    }))
}

#[utoipa::path(get, path = "/api/v1/system/bootstrap", tag = "system", responses((status = 200, body = BootstrapResponse), (status = 401, body = ProblemDetails)))]
pub async fn system_bootstrap(State(state): State<ApiState>) -> ApiResult<Json<BootstrapResponse>> {
    let (schema_version, projection_version) = state.database.schema_versions()?;
    let mut user_units = BTreeMap::new();
    user_units.insert("temperature".into(), "celsius".into());
    user_units.insert("mass".into(), "grams".into());
    Ok(Json(BootstrapResponse {
        api_version: "v1".into(),
        application_version: state.config.application_version.clone(),
        schema_version,
        projection_version,
        session_id: state.session_id.clone(),
        server_time: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        recovery_state: "ready".into(),
        user_units,
        features: FeatureSet {
            catalog: true,
            roast_library: true,
            roast_detail: true,
            series_json: true,
            device_connection: true,
            profile_editing: true,
            printing: false,
            ai_proposals: false,
            remote_monitoring: false,
        },
        adapters: AdapterSet {
            database: SimpleAdapter {
                // Reading the schema versions above proves this connection is
                // usable. Full integrity scans belong to diagnostics and
                // migration verification, not bootstrap's request path.
                state: "ready".into(),
                reason: None,
            },
            usb: state.device.snapshot(),
            printing: SimpleAdapter {
                state: "unavailable".into(),
                reason: Some("not_implemented".into()),
            },
        },
    }))
}

#[utoipa::path(get, path = "/api/v1/openapi.json", tag = "contract", responses((status = 200, description = "OpenAPI 3.1 contract", body = Value)))]
pub async fn openapi_get() -> Json<Value> {
    Json(serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes"))
}

#[utoipa::path(get, path = "/api/v1/device", tag = "device", responses((status = 200, body = DeviceSnapshot)))]
pub async fn device_get(State(state): State<ApiState>) -> Json<DeviceSnapshot> {
    Json(state.device.snapshot())
}

#[utoipa::path(post, path = "/api/v1/device/refresh", tag = "device", request_body = Object, responses((status = 200, body = DeviceSnapshot)))]
pub async fn device_refresh(State(state): State<ApiState>) -> Json<DeviceSnapshot> {
    state.device.refresh();
    Json(state.device.snapshot())
}

#[utoipa::path(post, path = "/api/v1/device/synchronize", tag = "device", request_body = Object, responses((status = 200, body = DeviceSnapshot), (status = 409, body = ProblemDetails)))]
pub async fn device_synchronize(State(state): State<ApiState>) -> ApiResult<Json<DeviceSnapshot>> {
    state.device.synchronize().await.map_err(|reason| {
        let (status, code, title) = if reason == "device_not_connected" {
            (
                StatusCode::CONFLICT,
                "device_not_connected",
                "Roaster not connected",
            )
        } else {
            (
                StatusCode::LOCKED,
                "device_busy",
                "Roaster session not ready",
            )
        };
        ApiError::new(status, code, title, "The Nano cannot synchronize yet.")
    })?;
    Ok(Json(state.device.snapshot()))
}

#[utoipa::path(get, path = "/api/v1/bridges", tag = "bridges", responses((status = 200, body = BridgePage), (status = 500, body = ProblemDetails)))]
pub async fn bridges_list(State(state): State<ApiState>) -> ApiResult<Json<BridgePage>> {
    let records = lan_bridge::list_bridges(&state.database)?;
    Ok(Json(BridgePage {
        items: records
            .into_iter()
            .map(|record| BridgeResource {
                id: record.id.to_string(),
                bridge_id: record.bridge_id,
                firmware_version: record.firmware_version,
                build_id: record.build_id,
                state: record.state,
                last_seen_at: record.last_seen_at_ms.and_then(timestamp_from_ms),
                created_at: timestamp_from_ms(record.created_at_ms)
                    .unwrap_or_else(|| "1970-01-01T00:00:00Z".into()),
                updated_at: timestamp_from_ms(record.updated_at_ms)
                    .unwrap_or_else(|| "1970-01-01T00:00:00Z".into()),
            })
            .collect(),
    }))
}

#[utoipa::path(post, path = "/api/v1/bridges/claims", tag = "bridges", responses((status = 201, body = BridgeClaimResource), (status = 500, body = ProblemDetails)))]
pub async fn bridge_claim_create(
    State(state): State<ApiState>,
) -> ApiResult<(StatusCode, Json<BridgeClaimResource>)> {
    let claim = lan_bridge::create_claim(&state.database)?;
    Ok((
        StatusCode::CREATED,
        Json(BridgeClaimResource {
            claim_token: claim.token,
            expires_at: timestamp_from_ms(claim.expires_at_ms)
                .expect("generated claim expiry is representable"),
            backend_host: "xrc.local".into(),
            backend_port: state
                .config
                .bridge_port
                .unwrap_or(lan_bridge::DEFAULT_BRIDGE_PORT),
        }),
    ))
}

fn timestamp_from_ms(value: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(value)
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

#[utoipa::path(get, path = "/api/v1/profiles", tag = "profiles", responses((status = 200, body = ProfilePage), (status = 500, body = ProblemDetails)))]
pub async fn profiles_list(State(state): State<ApiState>) -> ApiResult<Json<ProfilePage>> {
    let records = {
        let connection = state.database.connection();
        let mut statement = connection.prepare(
            "WITH ranked AS (
               SELECT pr.id, pr.profile_id, pr.revision_number, nf.filename,
                      nf.source_modified_at, nf.sha256, nf.warnings_json,
                      pr.document_json,
                      row_number() OVER (
                        PARTITION BY coalesce(nf.device_path, nf.id)
                        ORDER BY nf.imported_at_ms DESC, pr.revision_number DESC
                      ) AS rank
                 FROM profile_revisions pr
                 JOIN native_files nf ON nf.id=pr.source_file_id
                WHERE nf.kind='kpro'
             )
             SELECT id, profile_id, revision_number, filename, source_modified_at,
                    sha256, warnings_json, document_json
               FROM ranked WHERE rank=1
               ORDER BY filename COLLATE NOCASE, id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut items = Vec::with_capacity(records.len());
    for (
        id,
        profile_id,
        revision_number,
        file_name,
        source_modified_at,
        source_hash,
        warnings_json,
        document_json,
    ) in records
    {
        let document: KproDocument = serde_json::from_str(&document_json).map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "profile_projection_invalid",
                "Profile projection is invalid",
                "A retained profile cannot be represented safely. Re-import the source file.",
            )
        })?;
        let warnings: Vec<String> = serde_json::from_str(&warnings_json).map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "profile_projection_invalid",
                "Profile projection is invalid",
                "A retained profile warning list is invalid. Re-import the source file.",
            )
        })?;
        let roast_curve = kpro::sample_curve(&document.roast_curve, 24)
            .into_iter()
            .map(|point| RoastProfileCurvePoint {
                elapsed_ms: (point.time_seconds * 1_000.0).round() as i64,
                temperature_milli_c: (point.value * 1_000.0).round() as i64,
            })
            .collect();
        let fan_curve = kpro::sample_curve(&document.fan_curve, 24)
            .into_iter()
            .map(|point| FanProfileCurvePoint {
                elapsed_ms: (point.time_seconds * 1_000.0).round() as i64,
                fan_rpm: point.value.round() as i64,
            })
            .collect();
        items.push(ProfileResource {
            kind: "profile".into(),
            id,
            profile_id,
            revision_number,
            file_name,
            display_name: document.short_name,
            designer: document.designer,
            description: document.description,
            schema_version: document.schema_version,
            source_modified_at,
            profile_modified_at: document.profile_modified,
            recommended_level_thousandths: document
                .recommended_level
                .map(|value| (value * 1_000.0).round() as i64),
            reference_load_mg: document
                .reference_load_grams
                .map(|value| (value * 1_000.0).round() as i64),
            roast_levels_milli_c: document
                .roast_levels
                .into_iter()
                .map(|value| (value * 1_000.0).round() as i64)
                .collect(),
            roast_curve,
            fan_curve,
            source_hash,
            warnings,
        });
    }
    Ok(Json(ProfilePage { items }))
}

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct CollectionQuery {
    #[serde(default = "default_first")]
    first: i64,
    after: Option<String>,
    search: Option<String>,
    #[serde(default)]
    include_archived: bool,
}

fn default_first() -> i64 {
    50
}

fn validate_collection(query: &CollectionQuery) -> ApiResult<()> {
    if !(1..=200).contains(&query.first)
        || query.search.as_ref().is_some_and(|value| value.len() > 200)
    {
        return Err(ApiError::validation(
            "Collection query is outside the supported range.",
        ));
    }
    Ok(())
}

#[utoipa::path(get, path = "/api/v1/providers", tag = "catalog", params(CollectionQuery), responses((status = 200, body = ProviderPage)))]
pub async fn providers_list(
    State(state): State<ApiState>,
    Query(query): Query<CollectionQuery>,
) -> ApiResult<Json<ProviderPage>> {
    validate_collection(&query)?;
    let offset = read_cursor(&state, query.after.as_deref(), "providers")?;
    let connection = state.database.connection();
    let pattern = query
        .search
        .as_ref()
        .map(|value| format!("%{}%", escape_like(&normalize_name(value))));
    let mut statement = connection.prepare(
        "SELECT * FROM providers
          WHERE (?1 OR archived_at_ms IS NULL)
            AND (?2 IS NULL OR normalized_name LIKE ?2 ESCAPE '\\')
          ORDER BY normalized_name, id LIMIT ?3 OFFSET ?4",
    )?;
    let rows = statement
        .query_map(
            params![query.include_archived, pattern, query.first + 1, offset],
            map_provider,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_next_page = rows.len() as i64 > query.first;
    let items = rows.into_iter().take(query.first as usize).collect();
    Ok(Json(ProviderPage {
        items,
        page_info: page_info(&state, "providers", offset, query.first, has_next_page)?,
    }))
}

#[utoipa::path(post, path = "/api/v1/providers", tag = "catalog", request_body = ProviderCreate, responses((status = 201, body = ResourceMutationProvider), (status = 422, body = ProblemDetails)))]
pub async fn providers_create(
    State(state): State<ApiState>,
    Json(input): Json<ProviderCreate>,
) -> ApiResult<(StatusCode, Json<ResourceMutationProvider>)> {
    validate_name(&input.display_name)?;
    let id = new_id();
    let now = now_ms();
    let connection = state.database.connection();
    connection.execute(
        "INSERT INTO providers
         (id, display_name, normalized_name, aliases_json, contact_json, reference_notes, default_currency_code, notes, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, input.display_name, normalize_name(&input.display_name), json_string(&input.aliases)?, json_string(&input.contact)?, input.reference_notes, input.default_currency_code, input.notes, now, now],
    ).map_err(constraint_error)?;
    let resource = get_provider(&connection, &id)?;
    Ok((
        StatusCode::CREATED,
        Json(ResourceMutationProvider { resource }),
    ))
}

#[utoipa::path(get, path = "/api/v1/providers/{id}", tag = "catalog", params(("id" = String, Path)), responses((status = 200, body = ProviderResource), (status = 404, body = ProblemDetails)))]
pub async fn providers_get(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<ProviderResource>> {
    Ok(Json(get_provider(&state.database.connection(), &id)?))
}

#[utoipa::path(patch, path = "/api/v1/providers/{id}", tag = "catalog", params(("id" = String, Path)), request_body = ProviderPatch, responses((status = 200, body = ResourceMutationProvider), (status = 412, body = ProblemDetails)))]
pub async fn providers_patch(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<ProviderPatch>,
) -> ApiResult<Json<ResourceMutationProvider>> {
    let expected = expected_revision(&headers)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let current = get_provider(&transaction, &id)?;
    if current.revision != expected {
        return Err(ApiError::revision());
    }
    let display_name = input.display_name.unwrap_or(current.display_name);
    validate_name(&display_name)?;
    let aliases = input.aliases.unwrap_or(current.aliases);
    let contact = input.contact.unwrap_or(current.contact);
    transaction.execute(
        "UPDATE providers SET display_name=?, normalized_name=?, aliases_json=?, contact_json=?, reference_notes=?, default_currency_code=?, notes=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![display_name, normalize_name(&display_name), json_string(&aliases)?, json_string(&contact)?, input.reference_notes.or(current.reference_notes), input.default_currency_code.or(current.default_currency_code), input.notes.or(current.notes), now_ms(), id, expected],
    ).map_err(constraint_error)?;
    transaction.execute(
        "UPDATE roast_library_rows SET provider_name=? WHERE provider_id=?",
        params![display_name, id],
    )?;
    transaction.commit()?;
    Ok(Json(ResourceMutationProvider {
        resource: get_provider(&state.database.connection(), &id)?,
    }))
}

#[utoipa::path(delete, path = "/api/v1/providers/{id}", tag = "catalog", params(("id" = String, Path)), responses((status = 200, body = ResourceMutationProvider), (status = 412, body = ProblemDetails)))]
pub async fn providers_delete(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<ResourceMutationProvider>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    if get_provider(&connection, &id)?.revision != expected {
        return Err(ApiError::revision());
    }
    let now = now_ms();
    connection.execute("UPDATE providers SET archived_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?", params![now, now, id, expected])?;
    Ok(Json(ResourceMutationProvider {
        resource: get_provider(&connection, &id)?,
    }))
}

#[utoipa::path(get, path = "/api/v1/coffees", tag = "catalog", params(CollectionQuery), responses((status = 200, body = CoffeePage)))]
pub async fn coffees_list(
    State(state): State<ApiState>,
    Query(query): Query<CollectionQuery>,
) -> ApiResult<Json<CoffeePage>> {
    validate_collection(&query)?;
    let offset = read_cursor(&state, query.after.as_deref(), "coffees")?;
    let connection = state.database.connection();
    let pattern = query
        .search
        .as_ref()
        .map(|value| format!("%{}%", escape_like(&normalize_name(value))));
    let mut statement = connection.prepare(
        "SELECT c.* FROM coffee_identities c
          WHERE (?1 OR c.archived_at_ms IS NULL)
            AND (?2 IS NULL OR c.normalized_name LIKE ?2 ESCAPE '\\' OR lower(coalesce(c.region,'')) LIKE ?2 ESCAPE '\\')
          ORDER BY c.normalized_name, c.id LIMIT ?3 OFFSET ?4")?;
    let rows = statement
        .query_map(
            params![query.include_archived, pattern, query.first + 1, offset],
            map_coffee,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_next_page = rows.len() as i64 > query.first;
    let items = rows.into_iter().take(query.first as usize).collect();
    Ok(Json(CoffeePage {
        items,
        page_info: page_info(&state, "coffees", offset, query.first, has_next_page)?,
    }))
}

#[utoipa::path(post, path = "/api/v1/coffees", tag = "catalog", request_body = CoffeeCreate, responses((status = 201, body = ResourceMutationCoffee)))]
pub async fn coffees_create(
    State(state): State<ApiState>,
    Json(input): Json<CoffeeCreate>,
) -> ApiResult<(StatusCode, Json<ResourceMutationCoffee>)> {
    validate_coffee(
        &input.display_name,
        input.altitude_min_metres,
        input.altitude_max_metres,
    )?;
    let id = new_id();
    let now = now_ms();
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let serial: i64 = transaction.query_row(
        "SELECT coalesce(max(serial_number), 0) + 1 FROM coffee_identities",
        [],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO coffee_identities
         (id, serial_number, display_name, normalized_name, country_code, region, farm_producer, station_cooperative, process, varieties_json, altitude_min_m, altitude_max_m, harvest_label, notes, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, serial, input.display_name, normalize_name(&input.display_name), normalize_country(input.country_code)?, input.region, input.farm_producer, input.station_cooperative, input.process, json_string(&input.varieties)?, input.altitude_min_metres, input.altitude_max_metres, input.harvest_label, input.notes, now, now],
    )?;
    transaction.commit()?;
    Ok((
        StatusCode::CREATED,
        Json(ResourceMutationCoffee {
            resource: get_coffee(&state.database.connection(), &id)?,
        }),
    ))
}

#[utoipa::path(get, path = "/api/v1/coffees/{id}", tag = "catalog", params(("id" = String, Path)), responses((status = 200, body = CoffeeResource)))]
pub async fn coffees_get(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<CoffeeResource>> {
    Ok(Json(get_coffee(&state.database.connection(), &id)?))
}

#[utoipa::path(patch, path = "/api/v1/coffees/{id}", tag = "catalog", params(("id" = String, Path)), request_body = CoffeePatch, responses((status = 200, body = ResourceMutationCoffee)))]
pub async fn coffees_patch(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<CoffeePatch>,
) -> ApiResult<Json<ResourceMutationCoffee>> {
    let expected = expected_revision(&headers)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let current = get_coffee(&transaction, &id)?;
    if current.revision != expected {
        return Err(ApiError::revision());
    }
    let display_name = input.display_name.unwrap_or(current.display_name);
    let altitude_min = input.altitude_min_metres.or(current.altitude_min_metres);
    let altitude_max = input.altitude_max_metres.or(current.altitude_max_metres);
    validate_coffee(&display_name, altitude_min, altitude_max)?;
    let country = normalize_country(input.country_code.or(current.country_code))?;
    let region = input.region.or(current.region);
    let farm = input.farm_producer.or(current.farm_producer);
    let station = input.station_cooperative.or(current.station_cooperative);
    let process = input.process.or(current.process);
    let varieties = input.varieties.unwrap_or(current.varieties);
    let harvest = input.harvest_label.or(current.harvest_label);
    let notes = input.notes.or(current.notes);
    transaction.execute(
        "UPDATE coffee_identities SET display_name=?, normalized_name=?, country_code=?, region=?, farm_producer=?, station_cooperative=?, process=?, varieties_json=?, altitude_min_m=?, altitude_max_m=?, harvest_label=?, notes=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![display_name, normalize_name(&display_name), country, region, farm, station, process, json_string(&varieties)?, altitude_min, altitude_max, harvest, notes, now_ms(), id, expected],
    )?;
    transaction.execute(
        "UPDATE roast_library_rows SET coffee_name=?, country_code=?, region=?, farm_producer=?, process=?, varieties_json=? WHERE coffee_id=?",
        params![display_name, country, region, farm, process, json_string(&varieties)?, id],
    )?;
    transaction.commit()?;
    Ok(Json(ResourceMutationCoffee {
        resource: get_coffee(&state.database.connection(), &id)?,
    }))
}

#[utoipa::path(delete, path = "/api/v1/coffees/{id}", tag = "catalog", params(("id" = String, Path)), responses((status = 200, body = ResourceMutationCoffee)))]
pub async fn coffees_delete(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<ResourceMutationCoffee>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    if get_coffee(&connection, &id)?.revision != expected {
        return Err(ApiError::revision());
    }
    let now = now_ms();
    connection.execute("UPDATE coffee_identities SET archived_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?", params![now, now, id, expected])?;
    Ok(Json(ResourceMutationCoffee {
        resource: get_coffee(&connection, &id)?,
    }))
}

#[utoipa::path(get, path = "/api/v1/lots", tag = "catalog", params(CollectionQuery), responses((status = 200, body = LotPage)))]
pub async fn lots_list(
    State(state): State<ApiState>,
    Query(query): Query<CollectionQuery>,
) -> ApiResult<Json<LotPage>> {
    validate_collection(&query)?;
    let offset = read_cursor(&state, query.after.as_deref(), "lots")?;
    let connection = state.database.connection();
    let pattern = query
        .search
        .as_ref()
        .map(|value| format!("%{}%", escape_like(&normalize_name(value))));
    let sql = format!("{LOT_SELECT}
        WHERE (?1 OR l.archived_at_ms IS NULL)
          AND (?2 IS NULL OR lower(l.internal_code) LIKE ?2 ESCAPE '\\' OR lower(c.display_name) LIKE ?2 ESCAPE '\\' OR lower(v.display_name) LIKE ?2 ESCAPE '\\')
        ORDER BY l.received_at_ms DESC, l.id DESC LIMIT ?3 OFFSET ?4");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(
            params![query.include_archived, pattern, query.first + 1, offset],
            map_lot,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_next_page = rows.len() as i64 > query.first;
    let items = rows.into_iter().take(query.first as usize).collect();
    Ok(Json(LotPage {
        items,
        page_info: page_info(&state, "lots", offset, query.first, has_next_page)?,
    }))
}

#[utoipa::path(post, path = "/api/v1/lots", tag = "catalog", request_body = LotCreate, responses((status = 201, body = ResourceMutationLot)))]
pub async fn lots_create(
    State(state): State<ApiState>,
    Json(input): Json<LotCreate>,
) -> ApiResult<(StatusCode, Json<ResourceMutationLot>)> {
    validate_name(&input.internal_code)?;
    if input.received_mass_mg <= 0
        || input
            .on_hand_mass_mg
            .is_some_and(|value| value < 0 || value > input.received_mass_mg)
    {
        return Err(ApiError::validation("Lot masses are invalid."));
    }
    let received_at = parse_instant(&input.received_at)?;
    let id = new_id();
    let now = now_ms();
    let balance = input.on_hand_mass_mg.unwrap_or(input.received_mass_mg);
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO green_lots
         (id, purchase_line_id, supplier_code, internal_code, received_mass_mg, on_hand_mass_mg, received_at_ms, source_timezone, storage_location, storage_notes, state, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, input.purchase_line_id, input.supplier_code, input.internal_code, input.received_mass_mg, balance, received_at, input.source_timezone, input.storage_location, input.storage_notes.unwrap_or_default(), input.state.unwrap_or_else(|| "active".into()), now, now],
    ).map_err(constraint_error)?;
    transaction.execute(
        "INSERT INTO inventory_transactions (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms) VALUES (?, ?, 'receipt', ?, ?, 'Initial lot receipt', ?)",
        params![new_id(), id, input.received_mass_mg, received_at, now],
    )?;
    if balance != input.received_mass_mg {
        transaction.execute(
            "INSERT INTO inventory_transactions (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms) VALUES (?, ?, 'adjustment', ?, ?, 'Opening balance reconciliation', ?)",
            params![new_id(), id, balance - input.received_mass_mg, now, now],
        )?;
    }
    transaction.commit()?;
    Ok((
        StatusCode::CREATED,
        Json(ResourceMutationLot {
            resource: get_lot(&state.database.connection(), &id)?,
        }),
    ))
}

#[utoipa::path(post, path = "/api/v1/acquisitions", tag = "catalog", request_body = AcquisitionCreate, responses((status = 201, body = AcquisitionResource), (status = 422, body = ProblemDetails), (status = 409, body = ProblemDetails)))]
pub async fn acquisitions_create(
    State(state): State<ApiState>,
    Json(input): Json<AcquisitionCreate>,
) -> ApiResult<(StatusCode, Json<AcquisitionResource>)> {
    validate_name(&input.provider_name)?;
    validate_name(&input.coffee_name)?;
    if input.received_mass_mg <= 0 || input.received_mass_mg > 1_000_000_000_000 {
        return Err(ApiError::validation(
            "Received mass must be greater than zero and at most 1,000,000 kg.",
        ));
    }
    if input
        .cost_per_kg_minor
        .is_some_and(|value| value < 0 || value > 1_000_000_000)
    {
        return Err(ApiError::validation(
            "Cost per kg is outside the supported range.",
        ));
    }
    let currency_code = input
        .currency_code
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty());
    if currency_code.as_ref().is_some_and(|value| {
        value.len() != 3 || !value.bytes().all(|byte| byte.is_ascii_alphabetic())
    }) {
        return Err(ApiError::validation(
            "currencyCode must contain three letters.",
        ));
    }
    if input.source_timezone.trim().is_empty() || input.source_timezone.len() > 100 {
        return Err(ApiError::validation("sourceTimezone is invalid."));
    }
    let received_at = parse_instant(&input.received_at)?;
    let provider_name = input.provider_name.trim();
    let coffee_name = input.coffee_name.trim();
    let now = now_ms();
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;

    let normalized_provider = normalize_name(provider_name);
    let existing_provider = transaction
        .query_row(
            "SELECT id FROM providers WHERE normalized_name=? AND archived_at_ms IS NULL ORDER BY id LIMIT 1",
            [&normalized_provider],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let provider_created = existing_provider.is_none();
    let provider_id = existing_provider.unwrap_or_else(new_id);
    if provider_created {
        transaction.execute(
            "INSERT INTO providers
             (id, display_name, normalized_name, aliases_json, contact_json, default_currency_code, created_at_ms, updated_at_ms)
             VALUES (?, ?, ?, '[]', '{}', ?, ?, ?)",
            params![provider_id, provider_name, normalized_provider, currency_code, now, now],
        )?;
    }

    let normalized_coffee = normalize_name(coffee_name);
    let existing_coffee = transaction
        .query_row(
            "SELECT id FROM coffee_identities WHERE normalized_name=? AND archived_at_ms IS NULL ORDER BY id LIMIT 1",
            [&normalized_coffee],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let coffee_created = existing_coffee.is_none();
    let coffee_id = existing_coffee.unwrap_or_else(new_id);
    if coffee_created {
        let serial: i64 = transaction.query_row(
            "SELECT coalesce(max(serial_number), 0) + 1 FROM coffee_identities",
            [],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO coffee_identities
             (id, serial_number, display_name, normalized_name, varieties_json, created_at_ms, updated_at_ms)
             VALUES (?, ?, ?, ?, '[]', ?, ?)",
            params![coffee_id, serial, coffee_name, normalized_coffee, now, now],
        )?;
    }

    let purchase_id = new_id();
    let purchase_line_id = new_id();
    let lot_id = new_id();
    let total_cost_minor = input
        .cost_per_kg_minor
        .map(|cost| ((input.received_mass_mg as i128 * cost as i128 + 500_000) / 1_000_000) as i64);
    transaction.execute(
        "INSERT INTO green_purchases
         (id, provider_id, supplier_reference, purchased_at_ms, received_at_ms, source_timezone, total_mass_mg, currency_code, total_cost_minor, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![purchase_id, provider_id, input.supplier_reference, received_at, received_at, input.source_timezone, input.received_mass_mg, currency_code, total_cost_minor, now, now],
    )?;
    transaction.execute(
        "INSERT INTO purchase_lines
         (id, purchase_id, coffee_id, ordered_mass_mg, received_mass_mg, cost_minor, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![purchase_line_id, purchase_id, coffee_id, input.received_mass_mg, input.received_mass_mg, total_cost_minor, now, now],
    )?;
    let next_lot_number: i64 = transaction.query_row(
        "SELECT coalesce(max(CASE WHEN internal_code GLOB 'LOT-[0-9]*' THEN CAST(substr(internal_code, 5) AS INTEGER) END), 0) + 1 FROM green_lots",
        [],
        |row| row.get(0),
    )?;
    let internal_code = format!("LOT-{next_lot_number}");
    transaction.execute(
        "INSERT INTO green_lots
         (id, purchase_line_id, internal_code, received_mass_mg, on_hand_mass_mg, received_at_ms, source_timezone, storage_notes, state, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'active', ?, ?)",
        params![lot_id, purchase_line_id, internal_code, input.received_mass_mg, input.received_mass_mg, received_at, input.source_timezone, now, now],
    )?;
    transaction.execute(
        "INSERT INTO inventory_transactions
         (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms)
         VALUES (?, ?, 'receipt', ?, ?, 'Initial acquisition receipt', ?)",
        params![new_id(), lot_id, input.received_mass_mg, received_at, now],
    )?;
    transaction.commit()?;
    drop(connection);

    Ok((
        StatusCode::CREATED,
        Json(AcquisitionResource {
            kind: "acquisition".into(),
            provider_created,
            coffee_created,
            lot: get_lot(&state.database.connection(), &lot_id)?,
        }),
    ))
}

#[utoipa::path(get, path = "/api/v1/lots/{id}", tag = "catalog", params(("id" = String, Path)), responses((status = 200, body = LotResource)))]
pub async fn lots_get(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<LotResource>> {
    Ok(Json(get_lot(&state.database.connection(), &id)?))
}

#[utoipa::path(patch, path = "/api/v1/lots/{id}", tag = "catalog", params(("id" = String, Path)), request_body = LotPatch, responses((status = 200, body = ResourceMutationLot)))]
pub async fn lots_patch(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<LotPatch>,
) -> ApiResult<Json<ResourceMutationLot>> {
    let expected = expected_revision(&headers)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let current = get_lot(&transaction, &id)?;
    if current.revision != expected {
        return Err(ApiError::revision());
    }
    let internal_code = input.internal_code.unwrap_or(current.internal_code);
    validate_name(&internal_code)?;
    let state_value = input.state.unwrap_or(current.state);
    if !matches!(state_value.as_str(), "active" | "depleted" | "archived") {
        return Err(ApiError::validation("Lot state is invalid."));
    }
    let now = now_ms();
    transaction.execute(
        "UPDATE green_lots SET supplier_code=?, internal_code=?, storage_location=?, storage_notes=?, state=?, archived_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?",
        params![input.supplier_code.or(current.supplier_code), internal_code, input.storage_location.or(current.storage_location), input.storage_notes.unwrap_or(current.storage_notes), state_value, if state_value == "archived" { Some(now) } else { None }, now, id, expected],
    ).map_err(constraint_error)?;
    transaction.execute(
        "UPDATE roast_library_rows SET lot_code=? WHERE green_lot_id=?",
        params![internal_code, id],
    )?;
    transaction.commit()?;
    Ok(Json(ResourceMutationLot {
        resource: get_lot(&state.database.connection(), &id)?,
    }))
}

#[utoipa::path(get, path = "/api/v1/preferences", tag = "brews", responses((status = 200, body = PreferencesResource)))]
pub async fn preferences_get(
    State(state): State<ApiState>,
) -> ApiResult<Json<PreferencesResource>> {
    Ok(Json(get_preferences(&state.database.connection())?))
}

#[utoipa::path(patch, path = "/api/v1/preferences", tag = "brews", request_body = PreferencesPatch, responses((status = 200, body = PreferencesResource), (status = 412, body = ProblemDetails)))]
pub async fn preferences_patch(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<PreferencesPatch>,
) -> ApiResult<Json<PreferencesResource>> {
    let expected = expected_revision(&headers)?;
    let connection = state.database.connection();
    let current = get_preferences(&connection)?;
    if current.revision != expected {
        return Err(ApiError::revision());
    }
    let coffee_mass = input
        .default_coffee_mass_mg
        .unwrap_or(current.default_coffee_mass_mg);
    let water_mass = input
        .default_water_mass_mg
        .unwrap_or(current.default_water_mass_mg);
    let temperature = input
        .default_water_temperature_milli_c
        .unwrap_or(current.default_water_temperature_milli_c);
    if coffee_mass <= 0 || water_mass <= 0 || !(0..=100_000).contains(&temperature) {
        return Err(ApiError::validation(
            "Preference units are outside the supported range.",
        ));
    }
    connection.execute(
        "UPDATE user_preferences SET default_roaster_name=?, default_grinder_name=?, default_grinder_setting=?, default_kettle_name=?, default_water_name=?, default_brew_method=?, default_coffee_mass_mg=?, default_water_mass_mg=?, default_water_temperature_milli_c=?, updated_at_ms=?, revision=revision+1 WHERE id=1 AND revision=?",
        params![input.default_roaster_name.unwrap_or(current.default_roaster_name), input.default_grinder_name.unwrap_or(current.default_grinder_name), input.default_grinder_setting.unwrap_or(current.default_grinder_setting), input.default_kettle_name.unwrap_or(current.default_kettle_name), input.default_water_name.unwrap_or(current.default_water_name), input.default_brew_method.unwrap_or(current.default_brew_method), coffee_mass, water_mass, temperature, now_ms(), expected],
    )?;
    Ok(Json(get_preferences(&connection)?))
}

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct RoastNumberQuery {
    roast_number: Option<i64>,
}

#[utoipa::path(get, path = "/api/v1/brews", tag = "brews", params(RoastNumberQuery), responses((status = 200, body = BrewPage)))]
pub async fn brews_list(
    State(state): State<ApiState>,
    Query(query): Query<RoastNumberQuery>,
) -> ApiResult<Json<BrewPage>> {
    let connection = state.database.connection();
    let sql = if query.roast_number.is_some() {
        format!("{BREW_SELECT} WHERE r.serial_number = ? ORDER BY b.brewed_at_ms DESC, b.serial_number DESC")
    } else {
        format!("{BREW_SELECT} ORDER BY b.brewed_at_ms DESC, b.serial_number DESC LIMIT 500")
    };
    let mut statement = connection.prepare(&sql)?;
    let rows = if let Some(number) = query.roast_number {
        statement
            .query_map([number], map_brew)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map([], map_brew)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(Json(BrewPage { items: rows }))
}

#[utoipa::path(post, path = "/api/v1/brews", tag = "brews", request_body = BrewCreate, responses((status = 201, body = BrewResource)))]
pub async fn brews_create(
    State(state): State<ApiState>,
    Json(input): Json<BrewCreate>,
) -> ApiResult<(StatusCode, Json<BrewResource>)> {
    if input.roast_number <= 0 {
        return Err(ApiError::validation("roastNumber must be positive."));
    }
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let roast_id: Option<String> = transaction
        .query_row(
            "SELECT id FROM roasts WHERE serial_number=?",
            [input.roast_number],
            |row| row.get(0),
        )
        .optional()?;
    let roast_id =
        roast_id.ok_or_else(|| ApiError::not_found("roast", &input.roast_number.to_string()))?;
    let defaults = get_preferences(&transaction)?;
    let serial: i64 = transaction.query_row(
        "SELECT coalesce(max(serial_number), 0) + 1 FROM brews",
        [],
        |row| row.get(0),
    )?;
    let id = new_id();
    let now = now_ms();
    let brewed_at = input
        .brewed_at
        .as_deref()
        .map(parse_instant)
        .transpose()?
        .unwrap_or(now);
    let coffee_mass = input
        .coffee_mass_mg
        .unwrap_or(defaults.default_coffee_mass_mg);
    let water_mass = input
        .water_mass_mg
        .unwrap_or(defaults.default_water_mass_mg);
    if coffee_mass <= 0 || water_mass <= 0 {
        return Err(ApiError::validation("Brew masses must be positive."));
    }
    transaction.execute(
        "INSERT INTO brews
         (id, serial_number, roast_id, brewed_at_ms, source_timezone, method, grinder_name, grinder_setting, kettle_name, water_name, coffee_mass_mg, water_mass_mg, water_temperature_milli_c, bloom_water_mass_mg, bloom_duration_ms, brew_duration_ms, score_basis_points, descriptors_json, tasting_notes, notes, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, serial, roast_id, brewed_at, input.source_timezone.unwrap_or_else(|| "UTC".into()), input.method.unwrap_or(defaults.default_brew_method), input.grinder_name.unwrap_or(defaults.default_grinder_name), input.grinder_setting.unwrap_or(defaults.default_grinder_setting), input.kettle_name.unwrap_or(defaults.default_kettle_name), input.water_name.unwrap_or(defaults.default_water_name), coffee_mass, water_mass, input.water_temperature_milli_c.or(Some(defaults.default_water_temperature_milli_c)), input.bloom_water_mass_mg, input.bloom_duration_ms, input.brew_duration_ms, input.score_basis_points, json_string(&input.descriptors)?, input.tasting_notes.unwrap_or_default(), input.notes.unwrap_or_default(), now, now],
    )?;
    transaction.commit()?;
    Ok((
        StatusCode::CREATED,
        Json(get_brew(&state.database.connection(), &serial.to_string())?),
    ))
}

#[utoipa::path(get, path = "/api/v1/brews/{reference}", tag = "brews", params(("reference" = String, Path)), responses((status = 200, body = BrewResource)))]
pub async fn brews_get(
    State(state): State<ApiState>,
    Path(reference): Path<String>,
) -> ApiResult<Json<BrewResource>> {
    Ok(Json(get_brew(&state.database.connection(), &reference)?))
}

#[utoipa::path(get, path = "/api/v1/labels", tag = "labels", params(RoastNumberQuery), responses((status = 200, body = LabelPage)))]
pub async fn labels_list(
    State(state): State<ApiState>,
    Query(query): Query<RoastNumberQuery>,
) -> ApiResult<Json<LabelPage>> {
    let connection = state.database.connection();
    let mut statement = if query.roast_number.is_some() {
        connection.prepare(
            "SELECT * FROM label_records WHERE roast_serial_number=? ORDER BY created_at_ms DESC",
        )?
    } else {
        connection.prepare("SELECT * FROM label_records ORDER BY created_at_ms DESC LIMIT 500")?
    };
    let items = if let Some(number) = query.roast_number {
        statement
            .query_map([number], map_label)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map([], map_label)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(Json(LabelPage { items }))
}

#[utoipa::path(post, path = "/api/v1/labels", tag = "labels", request_body = LabelCreate, responses((status = 201, body = LabelResource)))]
pub async fn labels_create(
    State(state): State<ApiState>,
    Json(input): Json<LabelCreate>,
) -> ApiResult<(StatusCode, Json<LabelResource>)> {
    if input.roast_number <= 0 || !(1..=99).contains(&input.copies) {
        return Err(ApiError::validation(
            "Label request is outside the supported range.",
        ));
    }
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let roast_id: Option<String> = transaction
        .query_row(
            "SELECT id FROM roasts WHERE serial_number=?",
            [input.roast_number],
            |row| row.get(0),
        )
        .optional()?;
    let roast_id =
        roast_id.ok_or_else(|| ApiError::not_found("roast", &input.roast_number.to_string()))?;
    let serial: i64 = transaction.query_row(
        "SELECT coalesce(max(serial_number), 0) + 1 FROM label_records",
        [],
        |row| row.get(0),
    )?;
    let id = new_id();
    transaction.execute(
        "INSERT INTO label_records (id, serial_number, roast_id, roast_serial_number, qr_payload, copies, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'generated', ?)",
        params![id, serial, roast_id, input.roast_number, format!("tan:roast:{}", input.roast_number), input.copies, now_ms()],
    )?;
    transaction.commit()?;
    Ok((
        StatusCode::CREATED,
        Json(get_label(
            &state.database.connection(),
            &serial.to_string(),
        )?),
    ))
}

#[utoipa::path(get, path = "/api/v1/labels/{reference}", tag = "labels", params(("reference" = String, Path)), responses((status = 200, body = LabelResource)))]
pub async fn labels_get(
    State(state): State<ApiState>,
    Path(reference): Path<String>,
) -> ApiResult<Json<LabelResource>> {
    Ok(Json(get_label(&state.database.connection(), &reference)?))
}

#[utoipa::path(post, path = "/api/v1/print-jobs", tag = "labels", request_body = PrintJobCreate, responses((status = 202, body = PrintJobResource), (status = 501, body = ProblemDetails)))]
pub async fn print_jobs_create(
    Json(_input): Json<PrintJobCreate>,
) -> ApiResult<(StatusCode, Json<PrintJobResource>)> {
    Err(ApiError::new(
        StatusCode::NOT_IMPLEMENTED,
        "printing_adapter_unavailable",
        "Printing adapter unavailable",
        "Automated printing is not enabled in this build.",
    ))
}

#[utoipa::path(post, path = "/api/v1/roast-library/query", tag = "roasts", request_body = RoastLibraryQuery, responses((status = 200, body = RoastLibraryResult), (status = 422, body = ProblemDetails)))]
pub async fn roast_library_query(
    State(state): State<ApiState>,
    Json(query): Json<RoastLibraryQuery>,
) -> ApiResult<Json<RoastLibraryResult>> {
    if query.view_version != 1
        || !(1..=200).contains(&query.page.first)
        || query.columns.is_empty()
        || query.columns.len() > 40
    {
        return Err(ApiError::validation(
            "Roast library query is outside the supported contract.",
        ));
    }
    let mut selected = HashSet::new();
    for field in &query.columns {
        if field_column(field).is_none() || !selected.insert(field) {
            return Err(ApiError::validation(format!(
                "Unsupported or duplicate roast field: {field}"
            )));
        }
    }
    let offset = read_cursor(&state, query.page.after.as_deref(), "roast-library")?;
    let filter: RoastFilter = serde_json::from_value(query.filters.clone())
        .map_err(|_| ApiError::validation("Roast filter does not match the contract."))?;
    let mut sql_params = Vec::new();
    let where_sql = compile_filter(&filter, &mut sql_params, 0)?;

    if !query.groups.is_empty() {
        return query_roast_groups(&state, &query, offset, &where_sql, sql_params);
    }

    let sorts = if query.sorts.is_empty() {
        vec![RoastSort {
            field: "roastedAt".into(),
            direction: "desc".into(),
            nulls: "last".into(),
        }]
    } else {
        query.sorts.clone()
    };
    if sorts.len() > 5 {
        return Err(ApiError::validation("At most five sorts are supported."));
    }
    let mut order = Vec::new();
    for sort in &sorts {
        let column = field_column(&sort.field)
            .ok_or_else(|| ApiError::validation("Sort field is unsupported."))?;
        if !matches!(sort.direction.as_str(), "asc" | "desc")
            || !matches!(sort.nulls.as_str(), "first" | "last")
        {
            return Err(ApiError::validation("Sort direction is invalid."));
        }
        order.push(format!(
            "{column} {} NULLS {}",
            sort.direction.to_ascii_uppercase(),
            sort.nulls.to_ascii_uppercase()
        ));
    }
    if !sorts.iter().any(|sort| sort.field == "roastId") {
        order.push("roast_id ASC".into());
    }
    let selects = query
        .columns
        .iter()
        .map(|field| field_column(field).unwrap())
        .collect::<Vec<_>>();
    let sql = format!(
        "SELECT revision, roast_id, {} FROM roast_library_rows WHERE {where_sql} ORDER BY {} LIMIT ? OFFSET ?",
        selects.join(", "), order.join(", ")
    );
    sql_params.push(rusqlite::types::Value::Integer(query.page.first + 1));
    sql_params.push(rusqlite::types::Value::Integer(offset));
    let connection = state.database.connection();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(sql_params), |row| {
            let mut values = BTreeMap::new();
            for (index, field) in query.columns.iter().enumerate() {
                let raw = row.get_ref(index + 2)?;
                values.insert(field.clone(), public_sql_value(field, raw));
            }
            Ok(RoastLibraryRow {
                revision: row.get(0)?,
                roast_id: row.get(1)?,
                values,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let has_next_page = rows.len() as i64 > query.page.first;
    Ok(Json(RoastLibraryResult::Rows {
        scope: query.group_path.clone(),
        rows: rows.into_iter().take(query.page.first as usize).collect(),
        aggregates: BTreeMap::new(),
        page_info: page_info(
            &state,
            "roast-library",
            offset,
            query.page.first,
            has_next_page,
        )?,
    }))
}

fn query_roast_groups(
    state: &ApiState,
    query: &RoastLibraryQuery,
    offset: i64,
    where_sql: &str,
    mut sql_params: Vec<rusqlite::types::Value>,
) -> ApiResult<Json<RoastLibraryResult>> {
    if !query.group_path.is_empty() {
        return Err(ApiError::validation(
            "Nested group expansion requires a refreshed query contract.",
        ));
    }
    let spec = query
        .groups
        .first()
        .and_then(Value::as_object)
        .ok_or_else(|| ApiError::validation("Group definition is invalid."))?;
    let field = spec
        .get("field")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("Group field is required."))?;
    let direction = spec
        .get("direction")
        .and_then(Value::as_str)
        .unwrap_or("asc");
    if spec.contains_key("bucket") || !matches!(direction, "asc" | "desc") {
        return Err(ApiError::validation(
            "This group bucket is not supported by the current service.",
        ));
    }
    let column =
        field_column(field).ok_or_else(|| ApiError::validation("Group field is unsupported."))?;
    let label = match field {
        "coffeeId" => "coffee_name",
        "providerId" => "provider_name",
        "purchaseId" => "purchase_reference",
        "greenLotId" => "lot_code",
        "profileRevisionId" => "profile_name",
        _ => column,
    };
    let sql = format!("SELECT {column}, {label}, count(*) FROM roast_library_rows WHERE {where_sql} GROUP BY {column}, {label} ORDER BY {column} {} NULLS LAST LIMIT ? OFFSET ?", direction.to_ascii_uppercase());
    sql_params.push(rusqlite::types::Value::Integer(query.page.first + 1));
    sql_params.push(rusqlite::types::Value::Integer(offset));
    let connection = state.database.connection();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(sql_params), |row| {
            let raw = row.get_ref(0)?;
            let value = public_sql_value(field, raw);
            let label_value = public_sql_value(field, row.get_ref(1)?);
            let key = GroupKey::Value {
                value: if value.is_null() { None } else { Some(value) },
            };
            Ok(RoastLibraryGroup {
                path: vec![GroupPathEntry {
                    field: field.into(),
                    key: key.clone(),
                }],
                key,
                label: if label_value.is_null() {
                    "Unassigned".into()
                } else {
                    label_value
                        .as_str()
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| label_value.to_string())
                },
                count: row.get(2)?,
                aggregates: BTreeMap::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let has_next_page = rows.len() as i64 > query.page.first;
    Ok(Json(RoastLibraryResult::Groups {
        scope: Vec::new(),
        groups: rows.into_iter().take(query.page.first as usize).collect(),
        page_info: page_info(
            state,
            "roast-library",
            offset,
            query.page.first,
            has_next_page,
        )?,
    }))
}

#[utoipa::path(get, path = "/api/v1/roasts/{reference}", tag = "roasts", params(("reference" = String, Path)), responses((status = 200, body = RoastDetail), (status = 404, body = ProblemDetails)))]
pub async fn roast_get(
    State(state): State<ApiState>,
    Path(reference): Path<String>,
) -> ApiResult<Json<RoastDetail>> {
    Ok(Json(get_roast(&state.database.connection(), &reference)?))
}

#[utoipa::path(patch, path = "/api/v1/roasts/{reference}/coffee", tag = "roasts", params(("reference" = String, Path)), request_body = RoastCoffeePatch, responses((status = 200, body = RoastMutation), (status = 412, body = ProblemDetails)))]
pub async fn roast_assign_coffee(
    State(state): State<ApiState>,
    Path(reference): Path<String>,
    headers: HeaderMap,
    Json(input): Json<RoastCoffeePatch>,
) -> ApiResult<Json<RoastMutation>> {
    let expected = expected_revision(&headers)?;
    let mut connection = state.database.connection();
    let transaction = connection.transaction()?;
    let roast_id = resolve_roast_id(&transaction, &reference)?;
    let revision: i64 = transaction.query_row(
        "SELECT revision FROM roasts WHERE id=?",
        [&roast_id],
        |row| row.get(0),
    )?;
    if revision != expected {
        return Err(ApiError::revision());
    }
    let coffee = if let Some(number) = input.coffee_number {
        transaction.query_row(
            "SELECT id, display_name, country_code, region, farm_producer, process, varieties_json FROM coffee_identities WHERE serial_number=? AND archived_at_ms IS NULL",
            [number],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?, row.get::<_, String>(6)?)),
        ).optional()?.ok_or_else(|| ApiError::not_found("coffee", &number.to_string()))?.into()
    } else {
        None
    };
    let (coffee_id, name, country, region, farm, process, varieties) = coffee.unwrap_or((
        String::new(),
        String::new(),
        None,
        None,
        None,
        None,
        "[]".into(),
    ));
    let assigned_id = if coffee_id.is_empty() {
        None
    } else {
        Some(coffee_id.as_str())
    };
    transaction.execute("UPDATE roasts SET coffee_id=?, green_lot_id=NULL, updated_at_ms=?, revision=revision+1 WHERE id=?", params![assigned_id, now_ms(), roast_id])?;
    transaction.execute(
        "UPDATE roast_library_rows SET coffee_id=?, coffee_name=?, country_code=?, region=?, farm_producer=?, process=?, varieties_json=?, green_lot_id=NULL, lot_code=NULL, provider_id=NULL, provider_name=NULL, purchase_id=NULL, purchase_reference=NULL, revision=revision+1 WHERE roast_id=?",
        params![assigned_id, if name.is_empty() { None } else { Some(name.as_str()) }, country, region, farm, process, varieties, roast_id],
    )?;
    transaction.execute(
        "DELETE FROM roast_library_fts WHERE roast_id=?",
        [&roast_id],
    )?;
    transaction.execute("INSERT INTO roast_library_fts (roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion) SELECT roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion FROM roast_library_rows WHERE roast_id=?", [&roast_id])?;
    transaction.commit()?;
    Ok(Json(RoastMutation {
        resource: get_roast(&state.database.connection(), &roast_id)?,
    }))
}

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct SeriesQuery {
    stream_version: i64,
    #[serde(default = "series_from")]
    from_elapsed_ms: i64,
    #[serde(default = "series_to")]
    to_elapsed_ms: i64,
    #[serde(default = "series_points")]
    max_points: usize,
    through_sample_seq: Option<i64>,
    channels: Option<String>,
}
fn series_from() -> i64 {
    -60_000
}
fn series_to() -> i64 {
    3_600_000
}
fn series_points() -> usize {
    1_000
}

#[utoipa::path(get, path = "/api/v1/roasts/{reference}/series", tag = "roasts", params(("reference" = String, Path), SeriesQuery), responses((status = 200, body = SeriesResponse), (status = 409, body = ProblemDetails)))]
pub async fn roast_series(
    State(state): State<ApiState>,
    Path(reference): Path<String>,
    Query(query): Query<SeriesQuery>,
) -> ApiResult<Json<SeriesResponse>> {
    if query.to_elapsed_ms < query.from_elapsed_ms || !(2..=2_000).contains(&query.max_points) {
        return Err(ApiError::validation("Telemetry window is invalid."));
    }
    let channels: HashSet<_> = query
        .channels
        .as_deref()
        .unwrap_or("temperature,profileTemperature,ror")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    let allowed: HashSet<_> = [
        "temperature",
        "spotTemperature",
        "meanTemperature",
        "profileTemperature",
        "profileRor",
        "ror",
        "desiredRor",
        "power",
        "motorVoltageTrace",
        "kp",
        "ki",
        "kd",
        "actualFanRpm",
        "native",
    ]
    .into_iter()
    .collect();
    if !channels.is_subset(&allowed) {
        return Err(ApiError::validation("Telemetry channel is unsupported."));
    }
    let connection = state.database.connection();
    let roast_id = resolve_roast_id(&connection, &reference)?;
    let stream: Option<(i64, String)> = connection.query_row("SELECT stream_version, reconciliation_state FROM roast_sample_streams WHERE roast_id=?", [&roast_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
    let (version, reconciliation_state) = stream.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "roast_series_not_found",
            "Series not found",
            "This roast has no telemetry series.",
        )
    })?;
    if version != query.stream_version {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "stream_version_changed",
            "Telemetry stream changed",
            format!("The current stream version is {version}."),
        ));
    }
    let mut statement = connection.prepare("SELECT sample_seq, elapsed_ms, temperature_milli_c, profile_temperature_milli_c, ror_milli_c_per_min, spot_temperature_milli_c, mean_temperature_milli_c, profile_ror_milli_c_per_min, desired_ror_milli_c_per_min, power_milli_kw, motor_voltage_trace_milli, kp_milli, ki_milli, kd_milli, actual_fan_rpm, values_json FROM roast_series_points WHERE roast_id=? AND elapsed_ms BETWEEN ? AND ? AND sample_seq <= ? ORDER BY sample_seq")?;
    let all = statement
        .query_map(
            params![
                roast_id,
                query.from_elapsed_ms,
                query.to_elapsed_ms,
                query.through_sample_seq.unwrap_or(i64::MAX)
            ],
            |row| map_series_point(row, &channels),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let source_row_count = all.len();
    let stride = if all.len() <= query.max_points {
        1
    } else {
        all.len().div_ceil(query.max_points)
    };
    let mut points: Vec<_> = all
        .into_iter()
        .enumerate()
        .filter(|(index, _)| *index == 0 || index % stride == 0 || *index + 1 == source_row_count)
        .map(|(_, point)| point)
        .collect();
    if points.len() > query.max_points {
        points.drain(query.max_points - 1..points.len() - 1);
    }
    Ok(Json(SeriesResponse {
        roast_id,
        stream_version: version,
        reconciliation_state,
        source_row_count,
        downsampled: points.len() < source_row_count,
        through_sample_seq: points.last().map(|point| point.sample_seq),
        points,
    }))
}

const LOT_SELECT: &str = "
  SELECT l.*,
         c.id AS coffee_id, c.display_name AS coffee_name,
         p.id AS purchase_id, p.supplier_reference AS purchase_reference,
         v.id AS provider_id, v.display_name AS provider_name,
         (SELECT count(*) FROM roasts r WHERE r.green_lot_id = l.id) AS roast_count,
         (SELECT max(t.score_basis_points) FROM roasts r JOIN tastings t ON t.roast_id = r.id WHERE r.green_lot_id = l.id) AS latest_score_basis_points
    FROM green_lots l
    JOIN purchase_lines pl ON pl.id = l.purchase_line_id
    JOIN coffee_identities c ON c.id = pl.coffee_id
    JOIN green_purchases p ON p.id = pl.purchase_id
    JOIN providers v ON v.id = p.provider_id";

const BREW_SELECT: &str = "
  SELECT b.*, r.serial_number AS roast_serial_number, c.display_name AS coffee_name
    FROM brews b
    JOIN roasts r ON r.id = b.roast_id
    LEFT JOIN coffee_identities c ON c.id = r.coffee_id";

const ROAST_DETAIL_SELECT: &str = "
  SELECT r.*,
         l.internal_code AS lot_code,
         c.display_name AS coffee_name, c.country_code, c.region, c.farm_producer, c.process,
         v.id AS provider_id, v.display_name AS provider_name,
         gp.id AS purchase_id, gp.supplier_reference AS purchase_reference,
         pr.profile_id, p.display_name AS profile_name, pr.revision_number AS profile_revision_number,
         s.stream_version, s.channel_schema_json, s.row_count, s.first_elapsed_ms,
         s.last_elapsed_ms, s.reconciliation_state,
         t.id AS tasting_id, t.tasted_at_ms, t.score_basis_points, t.descriptors_json,
         t.notes AS tasting_notes, t.conclusion, t.next_action
    FROM roasts r
    LEFT JOIN green_lots l ON l.id = r.green_lot_id
    LEFT JOIN purchase_lines pl ON pl.id = l.purchase_line_id
    LEFT JOIN green_purchases gp ON gp.id = pl.purchase_id
    LEFT JOIN providers v ON v.id = gp.provider_id
    LEFT JOIN coffee_identities c ON c.id = r.coffee_id
    LEFT JOIN profile_revisions pr ON pr.id = r.profile_revision_id
    LEFT JOIN profiles p ON p.id = pr.profile_id
    LEFT JOIN roast_sample_streams s ON s.roast_id = r.id
    LEFT JOIN tastings t ON t.id = r.promoted_tasting_id
   WHERE r.id = ?";

fn map_provider(row: &Row<'_>) -> rusqlite::Result<ProviderResource> {
    Ok(ProviderResource {
        kind: "provider".into(),
        id: row.get("id")?,
        revision: row.get("revision")?,
        display_name: row.get("display_name")?,
        aliases: json_column(row.get("aliases_json")?),
        contact: json_column(row.get("contact_json")?),
        reference_notes: row.get("reference_notes")?,
        default_currency_code: row.get("default_currency_code")?,
        notes: row.get("notes")?,
        archived_at: optional_iso(row.get("archived_at_ms")?),
        created_at: iso(row.get("created_at_ms")?),
        updated_at: iso(row.get("updated_at_ms")?),
    })
}

fn get_provider(connection: &rusqlite::Connection, id: &str) -> ApiResult<ProviderResource> {
    connection
        .query_row("SELECT * FROM providers WHERE id=?", [id], map_provider)
        .optional()?
        .ok_or_else(|| ApiError::not_found("provider", id))
}

fn map_coffee(row: &Row<'_>) -> rusqlite::Result<CoffeeResource> {
    Ok(CoffeeResource {
        kind: "coffee".into(),
        id: row.get("id")?,
        serial_number: row.get("serial_number")?,
        revision: row.get("revision")?,
        display_name: row.get("display_name")?,
        country_code: row.get("country_code")?,
        region: row.get("region")?,
        farm_producer: row.get("farm_producer")?,
        station_cooperative: row.get("station_cooperative")?,
        process: row.get("process")?,
        varieties: json_column(row.get("varieties_json")?),
        altitude_min_metres: row.get("altitude_min_m")?,
        altitude_max_metres: row.get("altitude_max_m")?,
        harvest_label: row.get("harvest_label")?,
        notes: row.get("notes")?,
        archived_at: optional_iso(row.get("archived_at_ms")?),
        created_at: iso(row.get("created_at_ms")?),
        updated_at: iso(row.get("updated_at_ms")?),
    })
}

fn get_coffee(connection: &rusqlite::Connection, id: &str) -> ApiResult<CoffeeResource> {
    connection
        .query_row(
            "SELECT * FROM coffee_identities WHERE id=?",
            [id],
            map_coffee,
        )
        .optional()?
        .ok_or_else(|| ApiError::not_found("coffee", id))
}

fn map_lot(row: &Row<'_>) -> rusqlite::Result<LotResource> {
    let archived: Option<i64> = row.get("archived_at_ms")?;
    Ok(LotResource {
        kind: "lot".into(),
        id: row.get("id")?,
        revision: row.get("revision")?,
        purchase_line_id: row.get("purchase_line_id")?,
        coffee_id: row.get("coffee_id")?,
        supplier_code: row.get("supplier_code")?,
        internal_code: row.get("internal_code")?,
        received_mass_mg: row.get("received_mass_mg")?,
        on_hand_mass_mg: row.get("on_hand_mass_mg")?,
        balance_mg: row.get("on_hand_mass_mg")?,
        received_at: iso(row.get("received_at_ms")?),
        source_timezone: row.get("source_timezone")?,
        storage_location: row.get("storage_location")?,
        storage_notes: row.get("storage_notes")?,
        state: row.get("state")?,
        coffee: LotReference {
            id: row.get("coffee_id")?,
            display_name: row.get("coffee_name")?,
        },
        purchase: PurchaseReference {
            id: row.get("purchase_id")?,
            supplier_reference: row.get("purchase_reference")?,
        },
        provider: LotReference {
            id: row.get("provider_id")?,
            display_name: row.get("provider_name")?,
        },
        summary: LotSummary {
            roast_count: row.get("roast_count")?,
            latest_score_basis_points: row.get("latest_score_basis_points")?,
        },
        archived_at: optional_iso(archived),
        created_at: iso(row.get("created_at_ms")?),
        updated_at: iso(row.get("updated_at_ms")?),
    })
}

fn get_lot(connection: &rusqlite::Connection, id: &str) -> ApiResult<LotResource> {
    connection
        .query_row(&format!("{LOT_SELECT} WHERE l.id=?"), [id], map_lot)
        .optional()?
        .ok_or_else(|| ApiError::not_found("lot", id))
}

fn get_preferences(connection: &rusqlite::Connection) -> ApiResult<PreferencesResource> {
    Ok(
        connection.query_row("SELECT * FROM user_preferences WHERE id=1", [], |row| {
            Ok(PreferencesResource {
                kind: "preferences".into(),
                revision: row.get("revision")?,
                default_roaster_name: row.get("default_roaster_name")?,
                default_grinder_name: row.get("default_grinder_name")?,
                default_grinder_setting: row.get("default_grinder_setting")?,
                default_kettle_name: row.get("default_kettle_name")?,
                default_water_name: row.get("default_water_name")?,
                default_brew_method: row.get("default_brew_method")?,
                default_coffee_mass_mg: row.get("default_coffee_mass_mg")?,
                default_water_mass_mg: row.get("default_water_mass_mg")?,
                default_water_temperature_milli_c: row.get("default_water_temperature_milli_c")?,
                updated_at: iso(row.get("updated_at_ms")?),
            })
        })?,
    )
}

fn map_brew(row: &Row<'_>) -> rusqlite::Result<BrewResource> {
    let coffee_mass: i64 = row.get("coffee_mass_mg")?;
    let water_mass: i64 = row.get("water_mass_mg")?;
    Ok(BrewResource {
        kind: "brew".into(),
        id: row.get("id")?,
        serial_number: row.get("serial_number")?,
        revision: row.get("revision")?,
        roast: RoastReference {
            id: row.get("roast_id")?,
            serial_number: row.get("roast_serial_number")?,
            coffee_name: row.get("coffee_name")?,
        },
        brewed_at: iso(row.get("brewed_at_ms")?),
        source_timezone: row.get("source_timezone")?,
        method: row.get("method")?,
        grinder_name: row.get("grinder_name")?,
        grinder_setting: row.get("grinder_setting")?,
        kettle_name: row.get("kettle_name")?,
        water_name: row.get("water_name")?,
        coffee_mass_mg: coffee_mass,
        water_mass_mg: water_mass,
        ratio: water_mass as f64 / coffee_mass as f64,
        water_temperature_milli_c: row.get("water_temperature_milli_c")?,
        bloom_water_mass_mg: row.get("bloom_water_mass_mg")?,
        bloom_duration_ms: row.get("bloom_duration_ms")?,
        brew_duration_ms: row.get("brew_duration_ms")?,
        score_basis_points: row.get("score_basis_points")?,
        descriptors: json_column(row.get("descriptors_json")?),
        tasting_notes: row.get("tasting_notes")?,
        notes: row.get("notes")?,
        created_at: iso(row.get("created_at_ms")?),
        updated_at: iso(row.get("updated_at_ms")?),
    })
}

fn get_brew(connection: &rusqlite::Connection, reference: &str) -> ApiResult<BrewResource> {
    let numeric = numeric_reference(reference);
    let sql = format!(
        "{BREW_SELECT} WHERE {}=?",
        if numeric.is_some() {
            "b.serial_number"
        } else {
            "b.id"
        }
    );
    let value = numeric
        .map(rusqlite::types::Value::Integer)
        .unwrap_or_else(|| rusqlite::types::Value::Text(reference.into()));
    connection
        .query_row(&sql, [value], map_brew)
        .optional()?
        .ok_or_else(|| ApiError::not_found("brew", reference))
}

fn map_label(row: &Row<'_>) -> rusqlite::Result<LabelResource> {
    Ok(LabelResource {
        kind: "label".into(),
        id: row.get("id")?,
        serial_number: row.get("serial_number")?,
        roast_id: row.get("roast_id")?,
        roast_number: row.get("roast_serial_number")?,
        qr_payload: row.get("qr_payload")?,
        copies: row.get("copies")?,
        artifact_sha256: row.get("artifact_sha256")?,
        status: row.get("status")?,
        created_at: iso(row.get("created_at_ms")?),
    })
}

fn get_label(connection: &rusqlite::Connection, reference: &str) -> ApiResult<LabelResource> {
    let numeric = numeric_reference(reference);
    let sql = format!(
        "SELECT * FROM label_records WHERE {}=?",
        if numeric.is_some() {
            "serial_number"
        } else {
            "id"
        }
    );
    let value = numeric
        .map(rusqlite::types::Value::Integer)
        .unwrap_or_else(|| rusqlite::types::Value::Text(reference.into()));
    connection
        .query_row(&sql, [value], map_label)
        .optional()?
        .ok_or_else(|| ApiError::not_found("label", reference))
}

fn get_roast(connection: &rusqlite::Connection, reference: &str) -> ApiResult<RoastDetail> {
    let id = resolve_roast_id(connection, reference)?;
    let resource = connection
        .query_row(ROAST_DETAIL_SELECT, [&id], |row| {
            let coffee_id: Option<String> = row.get("coffee_id")?;
            let lot_id: Option<String> = row.get("green_lot_id")?;
            let provider_id: Option<String> = row.get("provider_id")?;
            let purchase_id: Option<String> = row.get("purchase_id")?;
            let profile_revision_id: Option<String> = row.get("profile_revision_id")?;
            let stream_version: Option<i64> = row.get("stream_version")?;
            let tasting_id: Option<String> = row.get("tasting_id")?;
            Ok(RoastDetail {
                kind: "roast".into(),
                id: row.get("id")?,
                serial_number: row.get("serial_number")?,
                native_log_number: row.get("native_log_number")?,
                revision: row.get("revision")?,
                green_lot_id: lot_id.clone(),
                coffee_id: coffee_id.clone(),
                profile_revision_id: profile_revision_id.clone(),
                roasted_at: match row.get::<_, String>("roasted_at_source")?.as_str() {
                    "unknown" => None,
                    _ => Some(iso(row.get("roasted_at_ms")?)),
                },
                roasted_at_source: row.get("roasted_at_source")?,
                source_timezone: row.get("source_timezone")?,
                roast_level_thousandths: row.get("level_thousandths")?,
                development_basis_points: row.get("development_basis_points")?,
                green_input_mass_mg: row.get("green_input_mass_mg")?,
                roasted_yield_mass_mg: row.get("roasted_yield_mass_mg")?,
                end_reason: row.get("end_reason")?,
                result: row.get("result")?,
                status: row.get("status")?,
                notes: row.get("notes")?,
                duration_ms: row.get("roast_duration_ms")?,
                cooldown_end_ms: row.get("cooldown_end_ms")?,
                native_metadata: json_column(row.get("native_metadata_json")?),
                import_warnings: json_column(row.get("import_warnings_json")?),
                source_file_id: row.get("source_file_id")?,
                promoted_tasting_id: tasting_id.clone(),
                lineage: RoastLineage {
                    coffee: coffee_id.map(|id| {
                        object(&[
                            ("id", json!(id)),
                            (
                                "displayName",
                                nullable_json(
                                    row.get::<_, Option<String>>("coffee_name").unwrap_or(None),
                                ),
                            ),
                        ])
                    }),
                    lot: lot_id.map(|id| {
                        object(&[
                            ("id", json!(id)),
                            (
                                "internalCode",
                                nullable_json(
                                    row.get::<_, Option<String>>("lot_code").unwrap_or(None),
                                ),
                            ),
                        ])
                    }),
                    provider: provider_id.map(|id| {
                        object(&[
                            ("id", json!(id)),
                            (
                                "displayName",
                                nullable_json(
                                    row.get::<_, Option<String>>("provider_name")
                                        .unwrap_or(None),
                                ),
                            ),
                        ])
                    }),
                    purchase: purchase_id.map(|id| {
                        object(&[
                            ("id", json!(id)),
                            (
                                "supplierReference",
                                nullable_json(
                                    row.get::<_, Option<String>>("purchase_reference")
                                        .unwrap_or(None),
                                ),
                            ),
                        ])
                    }),
                    origin: object(&[
                        (
                            "countryCode",
                            nullable_json(
                                row.get::<_, Option<String>>("country_code").unwrap_or(None),
                            ),
                        ),
                        (
                            "region",
                            nullable_json(row.get::<_, Option<String>>("region").unwrap_or(None)),
                        ),
                        (
                            "farmProducer",
                            nullable_json(
                                row.get::<_, Option<String>>("farm_producer")
                                    .unwrap_or(None),
                            ),
                        ),
                        (
                            "process",
                            nullable_json(row.get::<_, Option<String>>("process").unwrap_or(None)),
                        ),
                    ]),
                },
                profile: profile_revision_id.map(|revision_id| RoastProfileReference {
                    id: row.get("profile_id").unwrap_or(None),
                    revision_id,
                    display_name: row.get("profile_name").unwrap_or(None),
                    revision_number: row.get("profile_revision_number").unwrap_or(None),
                }),
                sample_stream: stream_version.map(|stream_version| RoastSampleStream {
                    stream_version,
                    channels: json_column(
                        row.get::<_, Option<String>>("channel_schema_json")
                            .unwrap_or(None)
                            .unwrap_or_else(|| "[]".into()),
                    ),
                    row_count: row.get("row_count").unwrap_or(None),
                    first_elapsed_ms: row.get("first_elapsed_ms").unwrap_or(None),
                    last_elapsed_ms: row.get("last_elapsed_ms").unwrap_or(None),
                    reconciliation_state: row.get("reconciliation_state").unwrap_or(None),
                }),
                promoted_tasting: tasting_id.map(|id| RoastTasting {
                    id,
                    tasted_at: iso(row.get::<_, i64>("tasted_at_ms").unwrap_or(0)),
                    score_basis_points: row.get("score_basis_points").unwrap_or(None),
                    descriptors: json_column(
                        row.get::<_, Option<String>>("descriptors_json")
                            .unwrap_or(None)
                            .unwrap_or_else(|| "[]".into()),
                    ),
                    notes: row.get("tasting_notes").unwrap_or(None),
                    conclusion: row.get("conclusion").unwrap_or(None),
                    next_action: row.get("next_action").unwrap_or(None),
                }),
                events: Vec::new(),
                annotations: Vec::new(),
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
            })
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("roast", reference))?;
    let mut resource = resource;
    let mut events = connection
        .prepare("SELECT * FROM roast_events WHERE roast_id=? ORDER BY elapsed_ms, id")?;
    resource.events = events
        .query_map([&id], |row| {
            Ok(RoastEvent {
                id: row.get("id")?,
                kind: row.get("event_kind")?,
                elapsed_ms: row.get("elapsed_ms")?,
                temperature_milli_c: row.get("temperature_milli_c")?,
                source: row.get("source")?,
                created_at: iso(row.get("created_at_ms")?),
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut annotations = connection.prepare(
        "SELECT * FROM annotations WHERE roast_id=? ORDER BY coalesce(elapsed_ms, 2147483647), id",
    )?;
    resource.annotations = annotations
        .query_map([&id], |row| {
            Ok(RoastAnnotation {
                id: row.get("id")?,
                revision: row.get("revision")?,
                elapsed_ms: row.get("elapsed_ms")?,
                temperature_milli_c: row.get("temperature_milli_c")?,
                r#type: row.get("annotation_type")?,
                text: row.get("text")?,
                created_at: iso(row.get("created_at_ms")?),
                updated_at: iso(row.get("updated_at_ms")?),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(resource)
}

fn map_series_point(row: &Row<'_>, channels: &HashSet<&str>) -> rusqlite::Result<SeriesPoint> {
    Ok(SeriesPoint {
        sample_seq: row.get(0)?,
        elapsed_ms: row.get(1)?,
        temperature_milli_c: channels
            .contains("temperature")
            .then(|| row.get(2))
            .transpose()?,
        profile_temperature_milli_c: channels
            .contains("profileTemperature")
            .then(|| row.get(3))
            .transpose()?,
        ror_milli_c_per_min: channels.contains("ror").then(|| row.get(4)).transpose()?,
        spot_temperature_milli_c: channels
            .contains("spotTemperature")
            .then(|| row.get(5))
            .transpose()?,
        mean_temperature_milli_c: channels
            .contains("meanTemperature")
            .then(|| row.get(6))
            .transpose()?,
        profile_ror_milli_c_per_min: channels
            .contains("profileRor")
            .then(|| row.get(7))
            .transpose()?,
        desired_ror_milli_c_per_min: channels
            .contains("desiredRor")
            .then(|| row.get(8))
            .transpose()?,
        power_milli_kw: channels.contains("power").then(|| row.get(9)).transpose()?,
        motor_voltage_trace_milli: channels
            .contains("motorVoltageTrace")
            .then(|| row.get(10))
            .transpose()?,
        kp_milli: channels.contains("kp").then(|| row.get(11)).transpose()?,
        ki_milli: channels.contains("ki").then(|| row.get(12)).transpose()?,
        kd_milli: channels.contains("kd").then(|| row.get(13)).transpose()?,
        actual_fan_rpm: channels
            .contains("actualFanRpm")
            .then(|| row.get(14))
            .transpose()?,
        values: if channels.contains("native") {
            Some(json_column(row.get::<_, String>(15)?))
        } else {
            None
        },
    })
}

fn compile_filter(
    filter: &RoastFilter,
    params: &mut Vec<rusqlite::types::Value>,
    depth: usize,
) -> ApiResult<String> {
    if depth > 5 {
        return Err(ApiError::validation(
            "Filter trees may be at most five levels deep.",
        ));
    }
    match filter {
        RoastFilter::Logical { op, clauses } => {
            if !matches!(op.as_str(), "and" | "or") || clauses.len() > 100 {
                return Err(ApiError::validation("Logical filter is invalid."));
            }
            if clauses.is_empty() {
                return Ok(if op == "and" { "1" } else { "0" }.into());
            }
            let compiled = clauses
                .iter()
                .map(|clause| compile_filter(clause, params, depth + 1))
                .collect::<ApiResult<Vec<_>>>()?;
            Ok(format!(
                "({})",
                compiled.join(if op == "and" { " AND " } else { " OR " })
            ))
        }
        RoastFilter::Not { op, clause } => {
            if op != "not" {
                return Err(ApiError::validation("Not filter is invalid."));
            }
            Ok(format!(
                "(NOT {})",
                compile_filter(clause, params, depth + 1)?
            ))
        }
        RoastFilter::Search { op, query } => {
            if op != "search" || query.trim().is_empty() || query.len() > 512 {
                return Err(ApiError::validation("Search filter is invalid."));
            }
            let terms = query
                .split_whitespace()
                .take(32)
                .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" AND ");
            params.push(rusqlite::types::Value::Text(terms));
            Ok("roast_id IN (SELECT roast_id FROM roast_library_fts WHERE roast_library_fts MATCH ?)".into())
        }
        RoastFilter::Field {
            op,
            field,
            operator,
            value,
        } => {
            if op != "field" {
                return Err(ApiError::validation("Field filter is invalid."));
            }
            let column = field_column(field).ok_or_else(|| {
                ApiError::validation(format!("Unsupported filter field: {field}"))
            })?;
            if operator == "is_null" {
                return Ok(format!("{column} IS NULL"));
            }
            if operator == "is_not_null" {
                return Ok(format!("{column} IS NOT NULL"));
            }
            if matches!(field.as_str(), "varieties" | "tastingDescriptors" | "tags") {
                if operator == "is_empty" {
                    return Ok(format!("json_array_length({column})=0"));
                }
                if operator == "is_not_empty" {
                    return Ok(format!("json_array_length({column})>0"));
                }
                let items = value
                    .as_ref()
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| value.clone().into_iter().collect());
                if items.is_empty()
                    || !matches!(
                        operator.as_str(),
                        "contains_any" | "contains_all" | "contains_none"
                    )
                {
                    return Err(ApiError::validation("Set filter is invalid."));
                }
                let mut clauses = Vec::new();
                for item in items {
                    let text = item
                        .as_str()
                        .ok_or_else(|| ApiError::validation("Set filter values must be text."))?;
                    params.push(rusqlite::types::Value::Text(text.into()));
                    clauses.push(format!("EXISTS (SELECT 1 FROM json_each({column}) j WHERE lower(j.value)=lower(?))"));
                }
                return Ok(match operator.as_str() {
                    "contains_any" => format!("({})", clauses.join(" OR ")),
                    "contains_all" => format!("({})", clauses.join(" AND ")),
                    _ => format!("(NOT ({}))", clauses.join(" OR ")),
                });
            }
            let convert = |value: &Value| -> ApiResult<rusqlite::types::Value> {
                if field == "roastedAt" {
                    return value
                        .as_str()
                        .map(parse_instant)
                        .transpose()?
                        .map(rusqlite::types::Value::Integer)
                        .ok_or_else(|| {
                            ApiError::validation("Date filter must be an RFC3339 instant.")
                        });
                }
                if field == "needsTasting" {
                    return value
                        .as_bool()
                        .map(|value| rusqlite::types::Value::Integer(i64::from(value)))
                        .ok_or_else(|| ApiError::validation("Boolean filter is invalid."));
                }
                json_to_sql(value)
            };
            match operator.as_str() {
                "eq" | "neq" | "lt" | "lte" | "gt" | "gte" => {
                    let value = value
                        .as_ref()
                        .ok_or_else(|| ApiError::validation("Filter value is required."))?;
                    params.push(convert(value)?);
                    let symbol = match operator.as_str() {
                        "eq" => "=",
                        "neq" => "!=",
                        "lt" => "<",
                        "lte" => "<=",
                        "gt" => ">",
                        _ => ">=",
                    };
                    Ok(format!("{column} {symbol} ?"))
                }
                "between" => {
                    let items = value
                        .as_ref()
                        .and_then(Value::as_array)
                        .filter(|items| items.len() == 2)
                        .ok_or_else(|| ApiError::validation("between requires two values."))?;
                    params.push(convert(&items[0])?);
                    params.push(convert(&items[1])?);
                    Ok(format!("{column} BETWEEN ? AND ?"))
                }
                "in" | "not_in" => {
                    let items = value
                        .as_ref()
                        .and_then(Value::as_array)
                        .filter(|items| !items.is_empty())
                        .ok_or_else(|| ApiError::validation("in requires a non-empty array."))?;
                    for item in items {
                        params.push(convert(item)?);
                    }
                    Ok(format!(
                        "{column} {}IN ({})",
                        if operator == "not_in" { "NOT " } else { "" },
                        vec!["?"; items.len()].join(",")
                    ))
                }
                "contains" | "not_contains" | "starts_with" => {
                    let text = value
                        .as_ref()
                        .and_then(Value::as_str)
                        .ok_or_else(|| ApiError::validation("Text filter requires a string."))?;
                    params.push(rusqlite::types::Value::Text(format!(
                        "{}{}%",
                        if operator == "starts_with" { "" } else { "%" },
                        escape_like(&text.to_lowercase())
                    )));
                    Ok(format!(
                        "{}(lower(coalesce({column},'')) LIKE ? ESCAPE '\\')",
                        if operator == "not_contains" {
                            "NOT "
                        } else {
                            ""
                        }
                    ))
                }
                _ => Err(ApiError::validation(format!(
                    "Unsupported filter operator: {operator}"
                ))),
            }
        }
    }
}

fn field_column(field: &str) -> Option<&'static str> {
    Some(match field {
        "roastId" => "roast_id",
        "roastNumber" => "serial_number",
        "nativeLogNumber" => "native_log_number",
        "roastedAt" => "CASE WHEN roasted_at_source='unknown' THEN NULL ELSE roasted_at_ms END",
        "roastedAtSource" => "roasted_at_source",
        "durationMs" => "duration_ms",
        "coffeeId" => "coffee_id",
        "coffeeName" => "coffee_name",
        "providerId" => "provider_id",
        "providerName" => "provider_name",
        "purchaseId" => "purchase_id",
        "purchaseReference" => "purchase_reference",
        "greenLotId" => "green_lot_id",
        "lotCode" => "lot_code",
        "countryCode" => "country_code",
        "region" => "region",
        "farmProducer" => "farm_producer",
        "process" => "process",
        "varieties" => "varieties_json",
        "profileRevisionId" => "profile_revision_id",
        "profileName" => "profile_name",
        "profileRevisionNumber" => "profile_revision_number",
        "roastLevelThousandths" => "roast_level_thousandths",
        "greenInputMassMg" => "green_input_mass_mg",
        "roastedYieldMassMg" => "roasted_yield_mass_mg",
        "roastLossBasisPoints" => "roast_loss_basis_points",
        "developmentBasisPoints" => "development_basis_points",
        "tastingScoreBasisPoints" => "tasting_score_basis_points",
        "tastingDescriptors" => "tasting_descriptors_json",
        "tastingNotes" => "tasting_notes",
        "tastingConclusion" => "tasting_conclusion",
        "tags" => "tags_json",
        "result" => "result",
        "status" => "status",
        "needsTasting" => "needs_tasting",
        "readyPlanStatus" => "ready_plan_status",
        _ => return None,
    })
}

fn public_sql_value(field: &str, value: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef;
    let basic = match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    };
    if field == "roastedAt" {
        return basic
            .as_i64()
            .map(|value| json!(iso(value)))
            .unwrap_or(Value::Null);
    }
    if field == "needsTasting" {
        return basic
            .as_i64()
            .map(|value| json!(value == 1))
            .unwrap_or(Value::Null);
    }
    if matches!(field, "varieties" | "tastingDescriptors" | "tags") {
        return basic
            .as_str()
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_else(|| json!([]));
    }
    basic
}

fn json_to_sql(value: &Value) -> ApiResult<rusqlite::types::Value> {
    Ok(match value {
        Value::String(value) => rusqlite::types::Value::Text(value.clone()),
        Value::Number(value) if value.is_i64() => {
            rusqlite::types::Value::Integer(value.as_i64().unwrap())
        }
        Value::Number(value) if value.is_f64() => {
            rusqlite::types::Value::Real(value.as_f64().unwrap())
        }
        Value::Bool(value) => rusqlite::types::Value::Integer(i64::from(*value)),
        _ => return Err(ApiError::validation("Filter scalar is invalid.")),
    })
}

fn expected_revision(headers: &HeaderMap) -> ApiResult<i64> {
    let value = headers
        .get(header::IF_MATCH)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(ApiError::revision)?;
    value
        .strip_prefix("\"revision:")
        .and_then(|value| value.strip_suffix('"'))
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .ok_or_else(ApiError::revision)
}

fn resolve_roast_id(connection: &rusqlite::Connection, reference: &str) -> ApiResult<String> {
    if let Some(number) = numeric_reference(reference) {
        return connection
            .query_row(
                "SELECT id FROM roasts WHERE serial_number=?",
                [number],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| ApiError::not_found("roast", reference));
    }
    connection
        .query_row("SELECT id FROM roasts WHERE id=?", [reference], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| ApiError::not_found("roast", reference))
}

fn numeric_reference(value: &str) -> Option<i64> {
    if value.is_empty()
        || value.len() > 9
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        None
    } else {
        value.parse().ok()
    }
}

fn page_info(
    state: &ApiState,
    scope: &str,
    offset: i64,
    first: i64,
    has_next_page: bool,
) -> ApiResult<PageInfo> {
    Ok(PageInfo {
        has_next_page,
        end_cursor: has_next_page
            .then(|| issue_cursor(state, scope, offset + first))
            .transpose()?,
    })
}

fn issue_cursor(state: &ApiState, scope: &str, offset: i64) -> ApiResult<String> {
    let payload = format!("{}:{scope}:{offset}", state.session_id);
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.cursor_key).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "cursor_error",
            "Cursor error",
            "Cursor signing failed.",
        )
    })?;
    mac.update(payload.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    Ok(URL_SAFE_NO_PAD.encode(format!("{payload}:{signature}")))
}

fn read_cursor(state: &ApiState, cursor: Option<&str>, scope: &str) -> ApiResult<i64> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let decoded = URL_SAFE_NO_PAD
        .decode(cursor)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .ok_or_else(|| ApiError::validation("Cursor is invalid."))?;
    let mut parts = decoded.rsplitn(2, ':');
    let signature = parts.next().unwrap_or_default();
    let payload = parts.next().unwrap_or_default();
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.cursor_key)
        .map_err(|_| ApiError::validation("Cursor is invalid."))?;
    mac.update(payload.as_bytes());
    if hex::decode(signature)
        .ok()
        .is_none_or(|signature| mac.verify_slice(&signature).is_err())
    {
        return Err(ApiError::validation("Cursor is invalid or expired."));
    }
    let prefix = format!("{}:{scope}:", state.session_id);
    payload
        .strip_prefix(&prefix)
        .and_then(|value| value.parse().ok())
        .filter(|value| *value >= 0)
        .ok_or_else(|| ApiError::validation("Cursor is invalid or expired."))
}

fn constraint_error(error: rusqlite::Error) -> ApiError {
    if matches!(error, rusqlite::Error::SqliteFailure(ref details, _) if details.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
    {
        ApiError::new(
            StatusCode::CONFLICT,
            "resource_conflict",
            "Resource already exists",
            "A resource already uses this unique value.",
        )
    } else if matches!(error, rusqlite::Error::SqliteFailure(ref details, _) if details.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY)
    {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_relationship",
            "Invalid relationship",
            "A referenced catalog resource does not exist.",
        )
    } else {
        error.into()
    }
}

fn normalize_country(value: Option<String>) -> ApiResult<Option<String>> {
    value
        .map(|value| {
            let value = value.trim().to_ascii_uppercase();
            if value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_alphabetic()) {
                Ok(value)
            } else {
                Err(ApiError::validation(
                    "countryCode must contain two letters.",
                ))
            }
        })
        .transpose()
}

fn validate_name(value: &str) -> ApiResult<()> {
    if value.trim().is_empty() || value.trim().chars().count() > 200 {
        Err(ApiError::validation(
            "Display name must contain 1 to 200 characters.",
        ))
    } else {
        Ok(())
    }
}

fn validate_coffee(name: &str, minimum: Option<i64>, maximum: Option<i64>) -> ApiResult<()> {
    validate_name(name)?;
    if minimum.is_some_and(|value| !(-500..=10_000).contains(&value))
        || maximum.is_some_and(|value| !(-500..=10_000).contains(&value))
        || minimum
            .zip(maximum)
            .is_some_and(|(minimum, maximum)| maximum < minimum)
    {
        return Err(ApiError::validation("Coffee altitude range is invalid."));
    }
    Ok(())
}

fn normalize_name(value: &str) -> String {
    value.trim().to_lowercase()
}
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
fn new_id() -> String {
    Uuid::now_v7().to_string()
}
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn iso(value: i64) -> String {
    chrono::DateTime::from_timestamp_millis(value)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn optional_iso(value: Option<i64>) -> Option<String> {
    value.map(iso)
}
fn parse_instant(value: &str) -> ApiResult<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|_| ApiError::validation("Timestamp must be RFC3339 with an offset."))
}
fn json_string<T: serde::Serialize>(value: &T) -> ApiResult<String> {
    serde_json::to_string(value)
        .map_err(|_| ApiError::validation("JSON value could not be represented."))
}
fn json_column<T: serde::de::DeserializeOwned + Default>(value: String) -> T {
    serde_json::from_str(&value).unwrap_or_default()
}
fn object(entries: &[(&str, Value)]) -> BTreeMap<String, Value> {
    entries
        .iter()
        .map(|(key, value)| ((*key).into(), value.clone()))
        .collect()
}
fn nullable_json(value: Option<String>) -> Value {
    value.map(Value::String).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, http::Request};
    use serde_json::Value;
    use tempfile::tempdir;
    use tower::ServiceExt;

    #[test]
    fn filter_sql_uses_only_allowlisted_columns() {
        let mut params = Vec::new();
        let filter = RoastFilter::Field {
            op: "field".into(),
            field: "coffeeName".into(),
            operator: "contains".into(),
            value: Some(json!("kenya")),
        };
        assert_eq!(
            compile_filter(&filter, &mut params, 0).unwrap(),
            "(lower(coalesce(coffee_name,'')) LIKE ? ESCAPE '\\')"
        );
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn rejects_injected_field_names() {
        let mut params = Vec::new();
        let filter = RoastFilter::Field {
            op: "field".into(),
            field: "roast_id; DROP TABLE roasts".into(),
            operator: "eq".into(),
            value: Some(json!(1)),
        };
        assert!(compile_filter(&filter, &mut params, 0).is_err());
    }

    async fn api_request(
        app: &Router,
        method: Method,
        path: &str,
        body: Option<Value>,
        revision: Option<i64>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "127.0.0.1:4317")
            .header(header::ORIGIN, "http://127.0.0.1:1420")
            .header(header::AUTHORIZATION, "Bearer test-contract-token")
            .header("x-tan-studio-client", "tan-studio-browser-dev");
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        if let Some(revision) = revision {
            request = request.header(header::IF_MATCH, format!("\"revision:{revision}\""));
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(
                        body.map(|value| Body::from(value.to_string()))
                            .unwrap_or_else(Body::empty),
                    )
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        let payload = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, payload)
    }

    async fn api_binary_request(
        app: &Router,
        method: Method,
        path: &str,
        body: Body,
        revision: Option<i64>,
    ) -> (StatusCode, HeaderMap, axum::body::Bytes) {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "127.0.0.1:4317")
            .header(header::ORIGIN, "http://127.0.0.1:1420")
            .header(header::AUTHORIZATION, "Bearer test-contract-token")
            .header("x-tan-studio-client", "tan-studio-browser-dev")
            .header(header::CONTENT_TYPE, "application/octet-stream");
        if let Some(revision) = revision {
            request = request.header(header::IF_MATCH, format!("\"revision:{revision}\""));
        }
        let response = app
            .clone()
            .oneshot(request.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        (status, headers, bytes)
    }

    #[tokio::test]
    async fn core_api_persists_the_complete_roast_to_brew_workflow() {
        let directory = tempdir().unwrap();
        let database = Database::open(&directory.path().join("studio.sqlite")).unwrap();
        let device = Arc::new(NanoDeviceManager::start(database.clone()));
        let config = ServiceConfig {
            mode: LaunchMode::Desktop,
            bind_host: "127.0.0.1".into(),
            port: 4317,
            bridge_port: None,
            database_path: directory.path().join("studio.sqlite"),
            web_root: None,
            launch_token: "test-contract-token".into(),
            allowed_origins: vec!["http://127.0.0.1:1420".into()],
            allowed_hosts: vec![],
            allowed_client_ids: vec!["tan-studio-browser-dev".into()],
            allow_originless_requests: false,
            application_version: "test".into(),
            development: true,
        };
        let app = build_router(ApiState::new(config, database.clone(), device.clone()).unwrap());

        let (status, profile) = api_request(
            &app,
            Method::POST,
            "/api/v1/profiles",
            Some(json!({
                "parentProfileId": null,
                "name": "Test profile",
                "recommendedLevelThousandths": 2800,
                "referenceLoadMg": 100000,
                "profile": {"temperaturePoints": []}
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{profile}");
        let profile_id = profile["id"].as_i64().unwrap();

        let (status, coffee) = api_request(
            &app,
            Method::POST,
            "/api/v1/coffees",
            Some(json!({
                "name": "Test coffee",
                "provider": "Test provider",
                "purchasedMassMg": 500000,
                "remainingMassMg": 500000,
                "country": "Kenya"
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{coffee}");
        let coffee_id = coffee["id"].as_i64().unwrap();

        let (status, roast) = api_request(
            &app,
            Method::POST,
            "/api/v1/roasts",
            Some(json!({
                "profileId": profile_id,
                "coffeeId": coffee_id,
                "levelThousandths": 3100,
                "greenInputMassMg": 100000,
                "adjustments": {"boost": 0.2}
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{roast}");
        let roast_id = roast["id"].as_i64().unwrap();
        let (status, duplicate) = api_request(
            &app,
            Method::POST,
            "/api/v1/roasts",
            Some(json!({"profileId": profile_id})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{duplicate}");
        assert_eq!(duplicate["code"], "active_roast_exists");

        let (status, brew) = api_request(
            &app,
            Method::POST,
            "/api/v1/brews",
            Some(json!({
                "roastId": roast_id,
                "method": "V60",
                "grinder": "Test grinder",
                "grinderSetting": "5.4.1",
                "coffeeMassMg": 16000,
                "waterMassMg": 250000,
                "waterTemperatureMilliC": 96000,
                "note": "Bright citrus and a clean finish",
                "ratingBasisPoints": 8700
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{brew}");
        let brew_id = brew["id"].as_i64().unwrap();
        assert_eq!(brew["notes"][0]["links"][0]["resourceType"], "brew");

        let (status, note) = api_request(
            &app,
            Method::POST,
            "/api/v1/notes",
            Some(json!({
                "kind": "recommendation",
                "body": "Reduce the boost for the next roast.",
                "source": "agent",
                "links": [
                    {"resourceType": "profile", "resourceId": profile_id},
                    {"resourceType": "coffee", "resourceId": coffee_id},
                    {"resourceType": "roast", "resourceId": roast_id},
                    {"resourceType": "brew", "resourceId": brew_id}
                ]
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{note}");
        assert_eq!(note["links"].as_array().unwrap().len(), 4);

        let (status, attachment) = api_request(
            &app,
            Method::POST,
            "/api/v1/attachments",
            Some(json!({
                "title": "Finished beans",
                "filename": "beans.jpg",
                "mediaType": "image/jpeg",
                "sourceUrl": "https://example.test/beans",
                "links": [
                    {"resourceType": "coffee", "resourceId": coffee_id},
                    {"resourceType": "roast", "resourceId": roast_id},
                    {"resourceType": "brew", "resourceId": brew_id}
                ]
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{attachment}");
        let attachment_id = attachment["id"].as_i64().unwrap();
        let attachment_revision = attachment["revision"].as_i64().unwrap();
        let content = b"not-a-real-jpeg-but-deterministic";
        let (status, _, uploaded) = api_binary_request(
            &app,
            Method::PUT,
            &format!("/api/v1/attachments/{attachment_id}/content"),
            Body::from(content.as_slice()),
            Some(attachment_revision),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let uploaded: Value = serde_json::from_slice(&uploaded).unwrap();
        assert_eq!(uploaded["byteLength"], content.len() as i64);
        assert_eq!(uploaded["sha256"].as_str().unwrap().len(), 64);

        let (status, listed) = api_request(
            &app,
            Method::GET,
            &format!("/api/v1/attachments?resourceType=coffee&resourceId={coffee_id}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        assert_eq!(listed["items"].as_array().unwrap().len(), 1);

        let (status, headers, downloaded) = api_binary_request(
            &app,
            Method::GET,
            &format!("/api/v1/attachments/{attachment_id}/content"),
            Body::empty(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(downloaded.as_ref(), content);

        let (status, label) = api_request(
            &app,
            Method::POST,
            "/api/v1/labels",
            Some(json!({
                "roastId": roast_id,
                "copies": 1,
                "widthMicrometers": 50000,
                "heightMicrometers": 30000,
                "content": {"qrPayload": format!("tan:roast:{roast_id}")}
            })),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{label}");
        assert_eq!(label["status"], "generated");

        let (status, context) = api_request(
            &app,
            Method::GET,
            &format!("/api/v1/roasts/{roast_id}/context"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{context}");
        assert_eq!(context["brews"].as_array().unwrap().len(), 1);
        assert_eq!(context["notes"].as_array().unwrap().len(), 2);

        let roast_revision = context["roast"]["revision"].as_i64().unwrap();
        let (status, _) = api_request(
            &app,
            Method::PATCH,
            &format!("/api/v1/roasts/{roast_id}"),
            Some(json!({"status": "completed", "roastedYieldMassMg": 85000})),
            Some(roast_revision),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, stale) = api_request(
            &app,
            Method::PATCH,
            &format!("/api/v1/roasts/{roast_id}"),
            Some(json!({"result": "success"})),
            Some(roast_revision),
        )
        .await;
        assert_eq!(status, StatusCode::PRECONDITION_FAILED, "{stale}");

        let (status, pantry) = api_request(&app, Method::GET, "/api/v1/pantry", None, None).await;
        assert_eq!(status, StatusCode::OK, "{pantry}");
        assert_eq!(pantry["items"][0]["estimatedRemainingMassMg"], 69000);
        assert!(database.quick_check().unwrap());
        device.stop();
    }
}
