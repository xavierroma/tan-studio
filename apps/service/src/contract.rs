use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{OpenApi, ToSchema};

use crate::error::{FieldError, ProblemDetails};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tan Studio Service API",
        version = "1.0.0",
        description = "Versioned local API shared by the Tan Studio macOS and Raspberry Pi clients. The Rust service is the source of truth for this document."
    ),
    paths(
        crate::api::system_bootstrap,
        crate::api::device_get,
        crate::api::device_refresh,
        crate::api::device_synchronize,
        crate::api::bridges_list,
        crate::api::bridge_claim_create,
        crate::api::profiles_list,
        crate::api::providers_list,
        crate::api::providers_create,
        crate::api::providers_get,
        crate::api::providers_patch,
        crate::api::providers_delete,
        crate::api::coffees_list,
        crate::api::coffees_create,
        crate::api::coffees_get,
        crate::api::coffees_patch,
        crate::api::coffees_delete,
        crate::api::lots_list,
        crate::api::lots_create,
        crate::api::lots_get,
        crate::api::lots_patch,
        crate::api::acquisitions_create,
        crate::api::preferences_get,
        crate::api::preferences_patch,
        crate::api::brews_list,
        crate::api::brews_create,
        crate::api::brews_get,
        crate::api::labels_list,
        crate::api::labels_create,
        crate::api::labels_get,
        crate::api::print_jobs_create,
        crate::api::roast_library_query,
        crate::api::roast_get,
        crate::api::roast_assign_coffee,
        crate::api::roast_series,
        crate::api::openapi_get
    ),
    components(schemas(
        FieldError,
        ProblemDetails,
        BootstrapResponse,
        FeatureSet,
        AdapterSet,
        SimpleAdapter,
        DeviceSnapshot,
        BridgeClaimResource,
        BridgeResource,
        BridgePage,
        ProfilePage,
        ProfileResource,
        RoastProfileCurvePoint,
        FanProfileCurvePoint,
        PageInfo,
        ProviderContact,
        ProviderResource,
        ProviderCreate,
        ProviderPatch,
        ProviderPage,
        CoffeeResource,
        CoffeeCreate,
        CoffeePatch,
        CoffeePage,
        LotReference,
        PurchaseReference,
        LotSummary,
        LotResource,
        LotCreate,
        LotPatch,
        LotPage,
        AcquisitionCreate,
        AcquisitionResource,
        ResourceMutationProvider,
        ResourceMutationCoffee,
        ResourceMutationLot,
        PreferencesResource,
        PreferencesPatch,
        RoastReference,
        BrewResource,
        BrewCreate,
        BrewPage,
        LabelResource,
        LabelCreate,
        LabelPage,
        PrintJobCreate,
        PrintJobResource,
        RoastLibraryQuery,
        RoastSort,
        RoastPageRequest,
        RoastLibraryResult,
        RoastLibraryRow,
        RoastLibraryGroup,
        GroupPathEntry,
        GroupKey,
        RoastDetail,
        RoastLineage,
        RoastProfileReference,
        RoastSampleStream,
        RoastTasting,
        RoastEvent,
        RoastAnnotation,
        RoastCoffeePatch,
        RoastMutation,
        SeriesResponse,
        SeriesPoint
    )),
    tags(
        (name = "system"),
        (name = "device"),
        (name = "bridges"),
        (name = "profiles"),
        (name = "catalog"),
        (name = "brews"),
        (name = "labels"),
        (name = "roasts"),
        (name = "contract")
    )
)]
pub struct ApiDoc;

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResponse {
    pub api_version: String,
    pub application_version: String,
    pub schema_version: i64,
    pub projection_version: i64,
    pub session_id: String,
    pub server_time: String,
    pub recovery_state: String,
    pub user_units: BTreeMap<String, String>,
    pub features: FeatureSet,
    pub adapters: AdapterSet,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSet {
    pub catalog: bool,
    pub roast_library: bool,
    pub roast_detail: bool,
    pub series_json: bool,
    pub device_connection: bool,
    pub profile_editing: bool,
    pub printing: bool,
    pub ai_proposals: bool,
    pub remote_monitoring: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterSet {
    pub database: SimpleAdapter,
    pub usb: DeviceSnapshot,
    pub printing: SimpleAdapter,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SimpleAdapter {
    pub state: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub state: String,
    pub reason: Option<String>,
    pub connection: String,
    pub transport: Option<String>,
    pub bridge_id: Option<String>,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub protocol: Option<String>,
    pub packet_limit_bytes: Option<u32>,
    pub busy: Option<bool>,
    pub profile_count: Option<u32>,
    pub log_count: Option<u32>,
    pub sync_state: String,
    pub imported_log_count: u32,
    pub updated_log_count: u32,
    pub import_warning_count: u32,
    pub quarantined_log_count: u32,
    pub imported_profile_count: u32,
    pub profile_warning_count: u32,
    pub quarantined_profile_count: u32,
    pub last_synced_at: Option<String>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BridgeClaimResource {
    pub claim_token: String,
    pub expires_at: String,
    pub backend_host: String,
    pub backend_port: u16,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BridgeResource {
    pub id: String,
    pub bridge_id: String,
    pub firmware_version: String,
    pub build_id: String,
    pub state: String,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BridgePage {
    pub items: Vec<BridgeResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastProfileCurvePoint {
    pub elapsed_ms: i64,
    pub temperature_milli_c: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FanProfileCurvePoint {
    pub elapsed_ms: i64,
    pub fan_rpm: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileResource {
    pub kind: String,
    pub id: String,
    pub profile_id: String,
    pub revision_number: i64,
    pub file_name: String,
    pub display_name: String,
    pub designer: String,
    pub description: String,
    pub schema_version: String,
    pub source_modified_at: Option<String>,
    pub profile_modified_at: Option<String>,
    pub recommended_level_thousandths: Option<i64>,
    pub reference_load_mg: Option<i64>,
    pub roast_levels_milli_c: Vec<i64>,
    pub roast_curve: Vec<RoastProfileCurvePoint>,
    pub fan_curve: Vec<FanProfileCurvePoint>,
    pub source_hash: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePage {
    pub items: Vec<ProfileResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub has_next_page: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderContact {
    pub website_url: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderResource {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub contact: ProviderContact,
    pub reference_notes: Option<String>,
    pub default_currency_code: Option<String>,
    pub notes: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderCreate {
    pub display_name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub contact: ProviderContact,
    pub reference_notes: Option<String>,
    pub default_currency_code: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderPatch {
    pub display_name: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub contact: Option<ProviderContact>,
    pub reference_notes: Option<String>,
    pub default_currency_code: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPage {
    pub items: Vec<ProviderResource>,
    pub page_info: PageInfo,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoffeeResource {
    pub kind: String,
    pub id: String,
    pub serial_number: Option<i64>,
    pub revision: i64,
    pub display_name: String,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub farm_producer: Option<String>,
    pub station_cooperative: Option<String>,
    pub process: Option<String>,
    pub varieties: Vec<String>,
    pub altitude_min_metres: Option<i64>,
    pub altitude_max_metres: Option<i64>,
    pub harvest_label: Option<String>,
    pub notes: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoffeeCreate {
    pub display_name: String,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub farm_producer: Option<String>,
    pub station_cooperative: Option<String>,
    pub process: Option<String>,
    #[serde(default)]
    pub varieties: Vec<String>,
    pub altitude_min_metres: Option<i64>,
    pub altitude_max_metres: Option<i64>,
    pub harvest_label: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoffeePatch {
    pub display_name: Option<String>,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub farm_producer: Option<String>,
    pub station_cooperative: Option<String>,
    pub process: Option<String>,
    pub varieties: Option<Vec<String>>,
    pub altitude_min_metres: Option<i64>,
    pub altitude_max_metres: Option<i64>,
    pub harvest_label: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoffeePage {
    pub items: Vec<CoffeeResource>,
    pub page_info: PageInfo,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LotReference {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReference {
    pub id: String,
    pub supplier_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LotSummary {
    pub roast_count: i64,
    pub latest_score_basis_points: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LotResource {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub purchase_line_id: String,
    pub coffee_id: String,
    pub supplier_code: Option<String>,
    pub internal_code: String,
    pub received_mass_mg: i64,
    pub on_hand_mass_mg: i64,
    pub balance_mg: i64,
    pub received_at: String,
    pub source_timezone: String,
    pub storage_location: Option<String>,
    pub storage_notes: String,
    pub state: String,
    pub coffee: LotReference,
    pub purchase: PurchaseReference,
    pub provider: LotReference,
    pub summary: LotSummary,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LotCreate {
    pub purchase_line_id: String,
    pub supplier_code: Option<String>,
    pub internal_code: String,
    pub received_mass_mg: i64,
    pub on_hand_mass_mg: Option<i64>,
    pub received_at: String,
    pub source_timezone: String,
    pub storage_location: Option<String>,
    pub storage_notes: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LotPatch {
    pub supplier_code: Option<String>,
    pub internal_code: Option<String>,
    pub storage_location: Option<String>,
    pub storage_notes: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LotPage {
    pub items: Vec<LotResource>,
    pub page_info: PageInfo,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcquisitionCreate {
    pub provider_name: String,
    pub coffee_name: String,
    pub supplier_reference: Option<String>,
    pub received_mass_mg: i64,
    pub cost_per_kg_minor: Option<i64>,
    pub currency_code: Option<String>,
    pub received_at: String,
    pub source_timezone: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionResource {
    pub kind: String,
    pub provider_created: bool,
    pub coffee_created: bool,
    pub lot: LotResource,
}

macro_rules! mutation {
    ($name:ident, $resource:ty) => {
        #[derive(Debug, Clone, Serialize, ToSchema)]
        pub struct $name {
            pub resource: $resource,
        }
    };
}
mutation!(ResourceMutationProvider, ProviderResource);
mutation!(ResourceMutationCoffee, CoffeeResource);
mutation!(ResourceMutationLot, LotResource);

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResource {
    pub kind: String,
    pub revision: i64,
    pub default_roaster_name: String,
    pub default_grinder_name: String,
    pub default_grinder_setting: String,
    pub default_kettle_name: String,
    pub default_water_name: String,
    pub default_brew_method: String,
    pub default_coffee_mass_mg: i64,
    pub default_water_mass_mg: i64,
    pub default_water_temperature_milli_c: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferencesPatch {
    pub default_roaster_name: Option<String>,
    pub default_grinder_name: Option<String>,
    pub default_grinder_setting: Option<String>,
    pub default_kettle_name: Option<String>,
    pub default_water_name: Option<String>,
    pub default_brew_method: Option<String>,
    pub default_coffee_mass_mg: Option<i64>,
    pub default_water_mass_mg: Option<i64>,
    pub default_water_temperature_milli_c: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastReference {
    pub id: String,
    pub serial_number: i64,
    pub coffee_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrewResource {
    pub kind: String,
    pub id: String,
    pub serial_number: i64,
    pub revision: i64,
    pub roast: RoastReference,
    pub brewed_at: String,
    pub source_timezone: String,
    pub method: String,
    pub grinder_name: String,
    pub grinder_setting: String,
    pub kettle_name: String,
    pub water_name: String,
    pub coffee_mass_mg: i64,
    pub water_mass_mg: i64,
    pub ratio: f64,
    pub water_temperature_milli_c: Option<i64>,
    pub bloom_water_mass_mg: Option<i64>,
    pub bloom_duration_ms: Option<i64>,
    pub brew_duration_ms: Option<i64>,
    pub score_basis_points: Option<i64>,
    pub descriptors: Vec<String>,
    pub tasting_notes: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewCreate {
    pub roast_number: i64,
    pub brewed_at: Option<String>,
    pub source_timezone: Option<String>,
    pub method: Option<String>,
    pub grinder_name: Option<String>,
    pub grinder_setting: Option<String>,
    pub kettle_name: Option<String>,
    pub water_name: Option<String>,
    pub coffee_mass_mg: Option<i64>,
    pub water_mass_mg: Option<i64>,
    pub water_temperature_milli_c: Option<i64>,
    pub bloom_water_mass_mg: Option<i64>,
    pub bloom_duration_ms: Option<i64>,
    pub brew_duration_ms: Option<i64>,
    pub score_basis_points: Option<i64>,
    #[serde(default)]
    pub descriptors: Vec<String>,
    pub tasting_notes: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BrewPage {
    pub items: Vec<BrewResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LabelResource {
    pub kind: String,
    pub id: String,
    pub serial_number: i64,
    pub roast_id: String,
    pub roast_number: i64,
    pub qr_payload: String,
    pub copies: i64,
    pub artifact_sha256: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelCreate {
    pub roast_number: i64,
    #[serde(default = "one")]
    pub copies: i64,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LabelPage {
    pub items: Vec<LabelResource>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintJobCreate {
    pub roast_id: Option<String>,
    pub printer_id: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub copies: i64,
    pub artifact: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PrintJobResource {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoastLibraryQuery {
    pub view_version: i64,
    pub filters: Value,
    #[serde(default)]
    pub groups: Vec<Value>,
    #[serde(default)]
    pub group_path: Vec<GroupPathEntry>,
    #[serde(default)]
    pub sorts: Vec<RoastSort>,
    pub columns: Vec<String>,
    #[serde(default)]
    pub aggregates: Vec<Value>,
    pub page: RoastPageRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RoastFilter {
    Logical {
        op: String,
        clauses: Vec<RoastFilter>,
    },
    Not {
        op: String,
        clause: Box<RoastFilter>,
    },
    Search {
        op: String,
        query: String,
    },
    Field {
        op: String,
        field: String,
        operator: String,
        value: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RoastSort {
    pub field: String,
    pub direction: String,
    #[serde(default = "nulls_last")]
    pub nulls: String,
}

fn nulls_last() -> String {
    "last".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RoastPageRequest {
    pub first: i64,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RoastLibraryResult {
    Rows {
        scope: Vec<GroupPathEntry>,
        rows: Vec<RoastLibraryRow>,
        aggregates: BTreeMap<String, Value>,
        #[schema(rename = "pageInfo")]
        page_info: PageInfo,
    },
    Groups {
        scope: Vec<GroupPathEntry>,
        groups: Vec<RoastLibraryGroup>,
        #[schema(rename = "pageInfo")]
        page_info: PageInfo,
    },
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastLibraryRow {
    pub roast_id: String,
    pub revision: i64,
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RoastLibraryGroup {
    pub path: Vec<GroupPathEntry>,
    pub key: GroupKey,
    pub label: String,
    pub count: i64,
    pub aggregates: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GroupPathEntry {
    pub field: String,
    pub key: GroupKey,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GroupKey {
    Value {
        value: Option<Value>,
    },
    Range {
        #[schema(rename = "startInclusive")]
        start_inclusive: Value,
        #[schema(rename = "endExclusive")]
        end_exclusive: Value,
    },
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastDetail {
    pub kind: String,
    pub id: String,
    pub serial_number: Option<i64>,
    pub native_log_number: Option<i64>,
    pub revision: i64,
    pub green_lot_id: Option<String>,
    pub coffee_id: Option<String>,
    pub profile_revision_id: Option<String>,
    pub roasted_at: Option<String>,
    pub roasted_at_source: String,
    pub source_timezone: String,
    pub roast_level_thousandths: Option<i64>,
    pub development_basis_points: Option<i64>,
    pub green_input_mass_mg: Option<i64>,
    pub roasted_yield_mass_mg: Option<i64>,
    pub end_reason: Option<String>,
    pub result: String,
    pub status: String,
    pub notes: String,
    pub duration_ms: Option<i64>,
    pub cooldown_end_ms: Option<i64>,
    pub native_metadata: BTreeMap<String, Value>,
    pub import_warnings: Vec<Value>,
    pub source_file_id: Option<String>,
    pub promoted_tasting_id: Option<String>,
    pub lineage: RoastLineage,
    pub profile: Option<RoastProfileReference>,
    pub sample_stream: Option<RoastSampleStream>,
    pub promoted_tasting: Option<RoastTasting>,
    pub events: Vec<RoastEvent>,
    pub annotations: Vec<RoastAnnotation>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RoastLineage {
    pub coffee: Option<BTreeMap<String, Value>>,
    pub lot: Option<BTreeMap<String, Value>>,
    pub provider: Option<BTreeMap<String, Value>>,
    pub purchase: Option<BTreeMap<String, Value>>,
    pub origin: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastProfileReference {
    pub id: Option<String>,
    pub revision_id: String,
    pub display_name: Option<String>,
    pub revision_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastSampleStream {
    pub stream_version: i64,
    pub channels: Vec<Value>,
    pub row_count: Option<i64>,
    pub first_elapsed_ms: Option<i64>,
    pub last_elapsed_ms: Option<i64>,
    pub reconciliation_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastTasting {
    pub id: String,
    pub tasted_at: String,
    pub score_basis_points: Option<i64>,
    pub descriptors: Vec<String>,
    pub notes: Option<String>,
    pub conclusion: Option<String>,
    pub next_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastEvent {
    pub id: String,
    pub kind: String,
    pub elapsed_ms: i64,
    pub temperature_milli_c: Option<i64>,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastAnnotation {
    pub id: String,
    pub revision: i64,
    pub elapsed_ms: Option<i64>,
    pub temperature_milli_c: Option<i64>,
    pub r#type: String,
    pub text: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoastCoffeePatch {
    pub coffee_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RoastMutation {
    pub resource: RoastDetail,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeriesResponse {
    pub roast_id: String,
    pub stream_version: i64,
    pub reconciliation_state: String,
    pub source_row_count: usize,
    pub downsampled: bool,
    pub through_sample_seq: Option<i64>,
    pub points: Vec<SeriesPoint>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub sample_seq: i64,
    pub elapsed_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_milli_c: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spot_temperature_milli_c: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_temperature_milli_c: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_temperature_milli_c: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_ror_milli_c_per_min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ror_milli_c_per_min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_ror_milli_c_per_min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_milli_kw: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motor_voltage_trace_milli: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kp_milli: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ki_milli: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kd_milli: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_fan_rpm: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<BTreeMap<String, Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_schema_uses_the_same_enum_field_names_as_json() {
        let response = RoastLibraryResult::Rows {
            scope: Vec::new(),
            rows: Vec::new(),
            aggregates: BTreeMap::new(),
            page_info: PageInfo {
                has_next_page: false,
                end_cursor: None,
            },
        };
        let json = serde_json::to_value(response).unwrap();
        assert!(json.get("pageInfo").is_some());
        assert!(json.get("page_info").is_none());

        let specification = ApiDoc::openapi().to_pretty_json().unwrap();
        assert!(specification.contains("\"pageInfo\""));
        assert!(specification.contains("\"startInclusive\""));
        assert!(!specification.contains("\"page_info\""));
        assert!(!specification.contains("\"start_inclusive\""));
    }
}
