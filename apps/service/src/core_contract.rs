use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, OpenApi, ToSchema};

use crate::contract::{BridgeClaimResource, BridgePage, BridgeResource};
use crate::error::{FieldError, ProblemDetails};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tan Studio API",
        version = "1.1.0",
        description = "The local-first, LLM-friendly API for profiles, coffees, roasts, brews, notes, attachments, labels and settings. Short integer IDs are stable user references."
    ),
    paths(
        crate::api::system_bootstrap,
        crate::api::device_get,
        crate::api::device_refresh,
        crate::api::device_synchronize,
        crate::api::device_sync_runs,
        crate::api::bridges_list,
        crate::api::bridge_claim_create,
        crate::core_api::openapi_get,
        crate::core_api::profiles_list,
        crate::core_api::profiles_create,
        crate::core_api::profiles_get,
        crate::core_api::profiles_patch,
        crate::core_api::profiles_create_child,
        crate::core_api::profiles_roasts,
        crate::core_api::profiles_context,
        crate::core_api::coffees_list,
        crate::core_api::coffees_create,
        crate::core_api::coffees_get,
        crate::core_api::coffees_patch,
        crate::core_api::coffees_roasts,
        crate::core_api::coffees_context,
        crate::core_api::roasts_list,
        crate::core_api::roasts_create,
        crate::core_api::roasts_get,
        crate::core_api::roasts_patch,
        crate::core_api::roasts_series,
        crate::core_api::roasts_context,
        crate::core_api::pantry_get,
        crate::core_api::brews_list,
        crate::core_api::brews_create,
        crate::core_api::brews_get,
        crate::core_api::brews_patch,
        crate::core_api::notes_list,
        crate::core_api::notes_create,
        crate::core_api::notes_get,
        crate::core_api::notes_patch,
        crate::core_api::notes_put_links,
        crate::core_api::notes_delete,
        crate::core_api::attachments_list,
        crate::core_api::attachments_create,
        crate::core_api::attachments_get,
        crate::core_api::attachments_patch,
        crate::core_api::attachments_put_links,
        crate::core_api::entity_profile_image_put,
        crate::core_api::attachments_put_content,
        crate::core_api::attachments_get_content,
        crate::core_api::labels_list,
        crate::core_api::labels_create,
        crate::core_api::labels_get,
        crate::core_api::settings_get,
        crate::core_api::settings_patch,
        crate::core_api::ui_preferences_get,
        crate::core_api::ui_preferences_patch
    ),
    components(schemas(
        FieldError, ProblemDetails, BridgeClaimResource, BridgeResource, BridgePage,
        ProfileResource, ProfileSummary, ProfileCreate, ProfilePatch, ProfilePage,
        CoffeeResource, CoffeeCreate, CoffeePatch, CoffeePage,
        ResourceReference, RoastResource, RoastSummary, RoastCreate, RoastPatch, RoastPage, RoastEvent,
        SampleStreamResource, SeriesResponse, SeriesPoint, ContextResource,
        RestWindow, PantryResource, PantryRoast,
        BrewResource, BrewCreate, BrewPatch, BrewPage,
        NoteResource, NoteCreate, NotePatch, NoteLinksPut, NoteLink, NotePage,
        AttachmentResource, AttachmentCreate, AttachmentPatch, AttachmentLinksPut, AttachmentLink, AttachmentPage,
        EntityProfileImagePut,
        LabelResource, LabelCreate, LabelPage,
        SettingsResource, SettingsPatch,
        UiPreferencesResource, UiPreferencesPatch,
        SyncRunResource, SyncRunPage
    )),
    tags(
        (name = "system"), (name = "device"), (name = "bridges"), (name = "profiles"),
        (name = "coffees"), (name = "roasts"), (name = "brews"),
        (name = "notes"), (name = "attachments"), (name = "labels"), (name = "settings"),
        (name = "ui-preferences"), (name = "sync"),
        (name = "contract")
    )
)]
pub struct ApiDoc;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourceReference {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileResource {
    pub id: i64,
    pub parent_profile_id: Option<i64>,
    pub name: String,
    pub description: String,
    pub designer: String,
    pub origin: String,
    pub recommended_level_thousandths: Option<i64>,
    pub reference_load_mg: Option<i64>,
    pub profile: Value,
    pub source_hash: Option<String>,
    pub roast_count: i64,
    pub child_count: i64,
    pub profile_image_attachment_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: i64,
    pub parent_profile_id: Option<i64>,
    pub name: String,
    pub origin: String,
    pub recommended_level_thousandths: Option<i64>,
    pub reference_load_mg: Option<i64>,
    pub roast_count: i64,
    pub child_count: i64,
    pub profile_image_attachment_id: Option<i64>,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileCreate {
    pub parent_profile_id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub designer: String,
    pub recommended_level_thousandths: Option<i64>,
    pub reference_load_mg: Option<i64>,
    #[serde(default = "empty_object")]
    pub profile: Value,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfilePatch {
    pub parent_profile_id: Option<Option<i64>>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub designer: Option<String>,
    pub recommended_level_thousandths: Option<Option<i64>>,
    pub reference_load_mg: Option<Option<i64>>,
    pub profile: Option<Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePage {
    pub items: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoffeeResource {
    pub id: i64,
    pub name: String,
    pub provider: String,
    pub provider_url: String,
    pub provider_product_id: String,
    pub purchase_reference: String,
    pub purchased_at: Option<String>,
    pub price_minor: Option<i64>,
    pub currency_code: Option<String>,
    pub purchased_mass_mg: i64,
    pub remaining_mass_mg: i64,
    pub country: String,
    pub region: String,
    pub farm: String,
    pub producer: String,
    pub washing_station: String,
    pub process: String,
    pub variety: String,
    pub altitude_min_m: Option<i64>,
    pub altitude_max_m: Option<i64>,
    pub harvest: String,
    pub storage_location: String,
    pub metadata: Value,
    pub roast_count: i64,
    pub profile_image_attachment_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoffeeCreate {
    pub name: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub provider_url: String,
    #[serde(default)]
    pub provider_product_id: String,
    #[serde(default)]
    pub purchase_reference: String,
    pub purchased_at: Option<String>,
    pub price_minor: Option<i64>,
    pub currency_code: Option<String>,
    #[serde(default)]
    pub purchased_mass_mg: i64,
    #[serde(default)]
    pub remaining_mass_mg: i64,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub farm: String,
    #[serde(default)]
    pub producer: String,
    #[serde(default)]
    pub washing_station: String,
    #[serde(default)]
    pub process: String,
    #[serde(default)]
    pub variety: String,
    pub altitude_min_m: Option<i64>,
    pub altitude_max_m: Option<i64>,
    #[serde(default)]
    pub harvest: String,
    #[serde(default)]
    pub storage_location: String,
    #[serde(default = "empty_object")]
    pub metadata: Value,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoffeePatch {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub provider_url: Option<String>,
    pub provider_product_id: Option<String>,
    pub purchase_reference: Option<String>,
    pub purchased_at: Option<Option<String>>,
    pub price_minor: Option<Option<i64>>,
    pub currency_code: Option<Option<String>>,
    pub purchased_mass_mg: Option<i64>,
    pub remaining_mass_mg: Option<i64>,
    pub country: Option<String>,
    pub region: Option<String>,
    pub farm: Option<String>,
    pub producer: Option<String>,
    pub washing_station: Option<String>,
    pub process: Option<String>,
    pub variety: Option<String>,
    pub altitude_min_m: Option<Option<i64>>,
    pub altitude_max_m: Option<Option<i64>>,
    pub harvest: Option<String>,
    pub storage_location: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoffeePage {
    pub items: Vec<CoffeeResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SampleStreamResource {
    pub stream_version: i64,
    pub row_count: i64,
    pub first_elapsed_ms: i64,
    pub last_elapsed_ms: i64,
    pub reconciliation_state: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastEvent {
    pub id: String,
    pub kind: String,
    pub elapsed_ms: i64,
    pub temperature_milli_c: Option<i64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastResource {
    pub id: i64,
    pub profile: Option<ResourceReference>,
    pub coffee: Option<ResourceReference>,
    pub roasted_at: Option<String>,
    pub roasted_at_source: String,
    pub source_timezone: String,
    pub status: String,
    pub result: String,
    pub level_thousandths: Option<i64>,
    pub green_input_mass_mg: Option<i64>,
    pub roasted_yield_mass_mg: Option<i64>,
    pub development_basis_points: Option<i64>,
    pub duration_ms: Option<i64>,
    pub end_reason: String,
    pub native_log_number: Option<i64>,
    pub profile_snapshot: Value,
    pub adjustments: Value,
    pub roaster_parameters: Value,
    pub native_metadata: Value,
    pub import_warnings: Vec<Value>,
    pub sample_stream: Option<SampleStreamResource>,
    pub events: Vec<RoastEvent>,
    pub brew_count: i64,
    pub note_count: i64,
    pub label_count: i64,
    pub profile_image_attachment_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastSummary {
    pub id: i64,
    pub profile: Option<ResourceReference>,
    pub coffee: Option<ResourceReference>,
    pub roasted_at: Option<String>,
    pub roasted_at_source: String,
    pub status: String,
    pub result: String,
    pub level_thousandths: Option<i64>,
    pub green_input_mass_mg: Option<i64>,
    pub roasted_yield_mass_mg: Option<i64>,
    pub duration_ms: Option<i64>,
    pub brew_count: i64,
    pub note_count: i64,
    pub label_count: i64,
    pub profile_image_attachment_id: Option<i64>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoastCreate {
    pub profile_id: i64,
    pub coffee_id: Option<i64>,
    pub level_thousandths: Option<i64>,
    pub green_input_mass_mg: Option<i64>,
    #[serde(default = "empty_object")]
    pub adjustments: Value,
    #[serde(default = "empty_object")]
    pub roaster_parameters: Value,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoastPatch {
    pub profile_id: Option<Option<i64>>,
    pub coffee_id: Option<Option<i64>>,
    pub roasted_at: Option<Option<String>>,
    pub source_timezone: Option<String>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub level_thousandths: Option<Option<i64>>,
    pub green_input_mass_mg: Option<Option<i64>>,
    pub roasted_yield_mass_mg: Option<Option<i64>>,
    pub development_basis_points: Option<Option<i64>>,
    pub adjustments: Option<Value>,
    pub roaster_parameters: Option<Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoastPage {
    pub items: Vec<RoastSummary>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeriesResponse {
    pub roast_id: i64,
    pub stream_version: i64,
    pub points: Vec<SeriesPoint>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub sample_seq: i64,
    pub elapsed_ms: i64,
    pub temperature_milli_c: i64,
    pub profile_temperature_milli_c: Option<i64>,
    pub ror_milli_c_per_min: Option<i64>,
    pub spot_temperature_milli_c: Option<i64>,
    pub mean_temperature_milli_c: Option<i64>,
    pub profile_ror_milli_c_per_min: Option<i64>,
    pub desired_ror_milli_c_per_min: Option<i64>,
    pub power_milli_kw: Option<i64>,
    pub actual_fan_rpm: Option<i64>,
    pub native: Value,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestWindow {
    pub age_days: Option<i64>,
    pub rest_days: i64,
    pub peak_days: i64,
    pub state: String,
    pub suggested_from: Option<String>,
    pub suggested_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextResource {
    pub profile: Option<ProfileResource>,
    pub coffee: Option<CoffeeResource>,
    pub roast: Option<RoastResource>,
    pub brews: Vec<BrewResource>,
    pub notes: Vec<NoteResource>,
    pub rest: Option<RestWindow>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PantryRoast {
    pub roast: RoastResource,
    pub estimated_remaining_mass_mg: i64,
    pub rest: RestWindow,
    pub latest_tasting: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PantryResource {
    pub items: Vec<PantryRoast>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrewResource {
    pub id: i64,
    pub roast_id: i64,
    pub brewed_at: String,
    pub source_timezone: String,
    pub method: String,
    pub grinder: String,
    pub grinder_setting: String,
    pub kettle: String,
    pub water: String,
    pub coffee_mass_mg: i64,
    pub water_mass_mg: i64,
    pub water_temperature_milli_c: Option<i64>,
    pub recipe: Value,
    pub notes: Vec<NoteResource>,
    pub profile_image_attachment_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewCreate {
    pub roast_id: i64,
    pub brewed_at: Option<String>,
    pub source_timezone: Option<String>,
    pub method: Option<String>,
    pub grinder: Option<String>,
    pub grinder_setting: Option<String>,
    pub kettle: Option<String>,
    pub water: Option<String>,
    pub coffee_mass_mg: Option<i64>,
    pub water_mass_mg: Option<i64>,
    pub water_temperature_milli_c: Option<i64>,
    #[serde(default = "empty_object")]
    pub recipe: Value,
    pub note: Option<String>,
    pub rating_basis_points: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewPatch {
    pub method: Option<String>,
    pub grinder: Option<String>,
    pub grinder_setting: Option<String>,
    pub kettle: Option<String>,
    pub water: Option<String>,
    pub coffee_mass_mg: Option<i64>,
    pub water_mass_mg: Option<i64>,
    pub water_temperature_milli_c: Option<Option<i64>>,
    pub recipe: Option<Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrewPage {
    pub items: Vec<BrewResource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteLink {
    pub resource_type: String,
    pub resource_id: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteResource {
    pub id: i64,
    pub kind: String,
    pub body: String,
    pub rating_basis_points: Option<i64>,
    pub attributes: Value,
    pub source: String,
    pub links: Vec<NoteLink>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCreate {
    #[serde(default = "general_kind")]
    pub kind: String,
    pub body: String,
    pub rating_basis_points: Option<i64>,
    #[serde(default = "empty_object")]
    pub attributes: Value,
    #[serde(default = "user_source")]
    pub source: String,
    pub links: Vec<NoteLink>,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotePatch {
    pub kind: Option<String>,
    pub body: Option<String>,
    pub rating_basis_points: Option<Option<i64>>,
    pub attributes: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteLinksPut {
    pub links: Vec<NoteLink>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotePage {
    pub items: Vec<NoteResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResource {
    pub id: i64,
    pub title: String,
    pub filename: String,
    pub media_type: String,
    pub byte_length: Option<i64>,
    pub sha256: Option<String>,
    pub source_url: Option<String>,
    pub description: String,
    pub captured_at: Option<String>,
    pub links: Vec<AttachmentLink>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentCreate {
    pub title: String,
    pub filename: String,
    pub media_type: String,
    pub source_url: Option<String>,
    #[serde(default)]
    pub description: String,
    pub captured_at: Option<String>,
    pub links: Vec<AttachmentLink>,
}

#[derive(Debug, Clone, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentPatch {
    pub title: Option<String>,
    pub filename: Option<String>,
    pub media_type: Option<String>,
    pub source_url: Option<Option<String>>,
    pub description: Option<String>,
    pub captured_at: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentLinksPut {
    pub links: Vec<AttachmentLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentLink {
    pub resource_type: String,
    pub resource_id: i64,
    #[serde(default = "gallery_role")]
    pub role: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityProfileImagePut {
    pub attachment_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPage {
    pub items: Vec<AttachmentResource>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LabelResource {
    pub id: i64,
    pub roast_id: i64,
    pub copies: i64,
    pub width_micrometers: Option<i64>,
    pub height_micrometers: Option<i64>,
    pub content: Value,
    pub artifact_sha256: Option<String>,
    pub printer: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelCreate {
    pub roast_id: i64,
    #[serde(default = "one")]
    pub copies: i64,
    pub width_micrometers: Option<i64>,
    pub height_micrometers: Option<i64>,
    #[serde(default = "empty_object")]
    pub content: Value,
    #[serde(default)]
    pub printer: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LabelPage {
    pub items: Vec<LabelResource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResource {
    pub default_roaster: String,
    pub default_grinder: String,
    pub default_grinder_setting: String,
    pub default_kettle: String,
    pub default_water: String,
    pub default_brew_method: String,
    pub default_coffee_mass_mg: i64,
    pub default_water_mass_mg: i64,
    pub default_water_temperature_milli_c: i64,
    pub default_rest_days: i64,
    pub default_peak_days: i64,
    pub default_label_width_micrometers: i64,
    pub default_label_height_micrometers: i64,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub default_roaster: Option<String>,
    pub default_grinder: Option<String>,
    pub default_grinder_setting: Option<String>,
    pub default_kettle: Option<String>,
    pub default_water: Option<String>,
    pub default_brew_method: Option<String>,
    pub default_coffee_mass_mg: Option<i64>,
    pub default_water_mass_mg: Option<i64>,
    pub default_water_temperature_milli_c: Option<i64>,
    pub default_rest_days: Option<i64>,
    pub default_peak_days: Option<i64>,
    pub default_label_width_micrometers: Option<i64>,
    pub default_label_height_micrometers: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferencesResource {
    pub default_table_density: String,
    pub table_preferences: Value,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPreferencesPatch {
    pub default_table_density: Option<String>,
    pub table_preferences: Option<Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunResource {
    pub id: i64,
    pub trigger: String,
    pub state: String,
    pub transport: String,
    pub device_model: String,
    pub imported_log_count: i64,
    pub updated_log_count: i64,
    pub import_warning_count: i64,
    pub quarantined_log_count: i64,
    pub imported_profile_count: i64,
    pub profile_warning_count: i64,
    pub quarantined_profile_count: i64,
    pub error_code: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunPage {
    pub items: Vec<SyncRunResource>,
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub q: Option<String>,
    pub profile_id: Option<i64>,
    pub coffee_id: Option<i64>,
    pub roast_id: Option<i64>,
    pub resource_type: Option<String>,
    pub resource_id: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct SeriesQuery {
    pub stream_version: i64,
    pub from_elapsed_ms: Option<i64>,
    pub to_elapsed_ms: Option<i64>,
    pub max_points: Option<usize>,
}

fn empty_object() -> Value {
    serde_json::json!({})
}
fn general_kind() -> String {
    "general".into()
}
fn user_source() -> String {
    "user".into()
}
fn one() -> i64 {
    1
}
fn gallery_role() -> String {
    "gallery".into()
}
