#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

#include "cJSON.h"
#include "esp_attr.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "tinyusb.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_default_config.h"

#define SETUP_SCHEMA_VERSION 1
#define SETUP_LINE_BYTES 4096U
#define SETUP_RX_CHUNK_BYTES 512U
#define SETUP_REQUEST_ID_BYTES 37U
#define SETUP_RECENT_REQUESTS 8U
#define SETUP_MAX_NETWORKS 12U
#define SETUP_BACKEND_HOST "xrc.local"
#define SETUP_BACKEND_PORT 8081U
#define SETUP_FIRMWARE_VERSION "0.2.6-local"
#define SETUP_BUILD_ID "local-lan-v7-coredump"
#define SETUP_NETWORK_START_DELAY_MS 2500U
#define SETUP_NETWORK_TASK_CORE 0
#define SETUP_WIFI_MAX_TX_POWER_QDBM 44
#define SETUP_TOKEN_BYTES 65U
#define SETUP_SSID_BYTES 33U
#define SETUP_CREDENTIAL_BYTES 64U
#define TUNNEL_MAX_PAYLOAD_BYTES 8192U
#define TUNNEL_USB_TO_BACKEND 1U
#define TUNNEL_BACKEND_TO_USB 2U
#define DIAGNOSTIC_RTC_MAGIC 0x54414e44U

typedef enum {
    DIAGNOSTIC_USB_BOOT = 0,
    DIAGNOSTIC_USB_INITIALIZING = 1,
    DIAGNOSTIC_USB_IDLE = 2,
    DIAGNOSTIC_USB_RECEIVING = 3,
    DIAGNOSTIC_USB_SETUP = 4,
    DIAGNOSTIC_USB_BUFFERING = 5,
    DIAGNOSTIC_USB_REPLAYING = 6,
    DIAGNOSTIC_USB_TRANSMITTING = 7,
} diagnostic_usb_stage_t;

typedef enum {
    DIAGNOSTIC_NETWORK_NOT_STARTED = 0,
    DIAGNOSTIC_NETWORK_DELAYING = 1,
    DIAGNOSTIC_NETWORK_WIFI = 2,
    DIAGNOSTIC_NETWORK_RESOLVING = 3,
    DIAGNOSTIC_NETWORK_CONNECTING = 4,
    DIAGNOSTIC_NETWORK_AUTHENTICATING = 5,
    DIAGNOSTIC_NETWORK_TUNNEL = 6,
    DIAGNOSTIC_NETWORK_BACKOFF = 7,
} diagnostic_network_stage_t;

typedef struct {
    size_t length;
    uint8_t bytes[SETUP_RX_CHUNK_BYTES];
} setup_rx_event_t;

static QueueHandle_t rx_queue;
static char line_buffer[SETUP_LINE_BYTES];
static size_t line_length;
static bool discarding_oversized_line;
static char bridge_id[27];
static char recent_request_ids[SETUP_RECENT_REQUESTS][SETUP_REQUEST_ID_BYTES];
static size_t recent_request_count;
static size_t recent_request_cursor;
static const char *lifecycle_state = "unprovisioned";
static const char *wifi_state = "disabled";
static const char *backend_state = "offline";
static bool wifi_initialized;
static esp_netif_t *wifi_netif;
static volatile bool setup_protocol_active;
static SemaphoreHandle_t socket_mutex;
static int bridge_socket = -1;
static uint8_t pending_usb_bytes[TUNNEL_MAX_PAYLOAD_BYTES];
static size_t pending_usb_length;
static bool usb_bootstrap_confirmed;
static char configured_ssid[SETUP_SSID_BYTES];
static char configured_credential[SETUP_CREDENTIAL_BYTES];
static char claim_token[SETUP_TOKEN_BYTES];
static char device_token[SETUP_TOKEN_BYTES];
static uint32_t configuration_generation;
static uint32_t diagnostic_boot_count;
static uint32_t diagnostic_brownout_count;
static uint32_t diagnostic_watchdog_count;
static uint32_t diagnostic_interrupt_watchdog_count;
static uint32_t diagnostic_task_watchdog_count;
static uint32_t diagnostic_other_watchdog_count;
static const char *diagnostic_last_reset_reason = "unknown";
static const char *diagnostic_previous_reset_reason = "unknown";
static uint32_t diagnostic_watchdog_usb_stage = DIAGNOSTIC_USB_BOOT;
static uint32_t diagnostic_watchdog_network_stage =
    DIAGNOSTIC_NETWORK_NOT_STARTED;
static bool diagnostics_persisted;
RTC_NOINIT_ATTR static uint32_t diagnostic_rtc_magic;
RTC_NOINIT_ATTR static uint32_t diagnostic_rtc_usb_stage;
RTC_NOINIT_ATTR static uint32_t diagnostic_rtc_network_stage;

static const char malformed_request_id[] =
    "00000000-0000-4000-8000-000000000000";

static void set_usb_stage(diagnostic_usb_stage_t stage);
static void set_network_stage(diagnostic_network_stage_t stage);

static bool object_has_exact_properties(
    const cJSON *object, const char *const *properties, size_t property_count)
{
    if (!cJSON_IsObject(object)) {
        return false;
    }

    size_t actual_count = 0U;
    const cJSON *child = NULL;
    cJSON_ArrayForEach(child, object)
    {
        bool allowed = false;
        for (size_t index = 0U; index < property_count; index++) {
            if (child->string != NULL &&
                strcmp(child->string, properties[index]) == 0) {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            return false;
        }
        actual_count++;
    }

    if (actual_count != property_count) {
        return false;
    }
    for (size_t index = 0U; index < property_count; index++) {
        if (cJSON_GetObjectItemCaseSensitive(object, properties[index]) ==
            NULL) {
            return false;
        }
    }
    return true;
}

static bool is_lower_hex(char value)
{
    return (value >= '0' && value <= '9') ||
           (value >= 'a' && value <= 'f');
}

static bool is_canonical_uuid(const char *value)
{
    if (value == NULL || strlen(value) != 36U) {
        return false;
    }
    for (size_t index = 0U; index < 36U; index++) {
        bool hyphen = index == 8U || index == 13U || index == 18U ||
                      index == 23U;
        if ((hyphen && value[index] != '-') ||
            (!hyphen && !is_lower_hex(value[index]))) {
            return false;
        }
    }
    return value[14] >= '1' && value[14] <= '8' &&
           strchr("89ab", value[19]) != NULL;
}

static bool is_token(const char *value)
{
    if (value == NULL || strlen(value) != 64U) {
        return false;
    }
    for (size_t index = 0U; index < 64U; index++) {
        if (!is_lower_hex(value[index])) {
            return false;
        }
    }
    return true;
}

static bool request_id_was_seen(const char *request_id)
{
    for (size_t index = 0U; index < recent_request_count; index++) {
        if (strcmp(recent_request_ids[index], request_id) == 0) {
            return true;
        }
    }

    snprintf(recent_request_ids[recent_request_cursor],
             SETUP_REQUEST_ID_BYTES, "%s", request_id);
    recent_request_cursor =
        (recent_request_cursor + 1U) % SETUP_RECENT_REQUESTS;
    if (recent_request_count < SETUP_RECENT_REQUESTS) {
        recent_request_count++;
    }
    return false;
}

static bool write_line(const char *line, size_t length)
{
    set_usb_stage(DIAGNOSTIC_USB_TRANSMITTING);
    size_t offset = 0U;
    while (offset < length) {
        size_t queued = tinyusb_cdcacm_write_queue(
            TINYUSB_CDC_ACM_0, (const uint8_t *)&line[offset],
            length - offset);
        if (queued == 0U ||
            tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0,
                                       pdMS_TO_TICKS(250)) != ESP_OK) {
            set_usb_stage(DIAGNOSTIC_USB_IDLE);
            return false;
        }
        offset += queued;
    }
    set_usb_stage(DIAGNOSTIC_USB_IDLE);
    return true;
}

static void send_json(cJSON *response)
{
    char *encoded = cJSON_PrintUnformatted(response);
    cJSON_Delete(response);
    if (encoded == NULL) {
        return;
    }

    size_t length = strlen(encoded);
    if (length + 1U <= SETUP_LINE_BYTES) {
        write_line(encoded, length);
        write_line("\n", 1U);
    }
    cJSON_free(encoded);
}

static cJSON *new_response(const char *request_id)
{
    cJSON *response = cJSON_CreateObject();
    if (response == NULL) {
        return NULL;
    }
    cJSON_AddNumberToObject(response, "schemaVersion", SETUP_SCHEMA_VERSION);
    cJSON_AddStringToObject(response, "requestId", request_id);
    return response;
}

static const char *reset_reason_name(esp_reset_reason_t reason)
{
    switch (reason) {
    case ESP_RST_POWERON:
        return "powerOn";
    case ESP_RST_EXT:
        return "external";
    case ESP_RST_SW:
        return "software";
    case ESP_RST_PANIC:
        return "panic";
    case ESP_RST_INT_WDT:
        return "interruptWatchdog";
    case ESP_RST_TASK_WDT:
        return "taskWatchdog";
    case ESP_RST_WDT:
        return "otherWatchdog";
    case ESP_RST_DEEPSLEEP:
        return "deepSleep";
    case ESP_RST_BROWNOUT:
        return "brownout";
    case ESP_RST_SDIO:
        return "sdio";
    default:
        return "unknown";
    }
}

static const char *usb_stage_name(uint32_t stage)
{
    switch (stage) {
    case DIAGNOSTIC_USB_INITIALIZING:
        return "initializing";
    case DIAGNOSTIC_USB_IDLE:
        return "idle";
    case DIAGNOSTIC_USB_RECEIVING:
        return "receiving";
    case DIAGNOSTIC_USB_SETUP:
        return "setup";
    case DIAGNOSTIC_USB_BUFFERING:
        return "buffering";
    case DIAGNOSTIC_USB_REPLAYING:
        return "replaying";
    case DIAGNOSTIC_USB_TRANSMITTING:
        return "transmitting";
    default:
        return "boot";
    }
}

static const char *network_stage_name(uint32_t stage)
{
    switch (stage) {
    case DIAGNOSTIC_NETWORK_DELAYING:
        return "delaying";
    case DIAGNOSTIC_NETWORK_WIFI:
        return "wifi";
    case DIAGNOSTIC_NETWORK_RESOLVING:
        return "resolving";
    case DIAGNOSTIC_NETWORK_CONNECTING:
        return "connecting";
    case DIAGNOSTIC_NETWORK_AUTHENTICATING:
        return "authenticating";
    case DIAGNOSTIC_NETWORK_TUNNEL:
        return "tunnel";
    case DIAGNOSTIC_NETWORK_BACKOFF:
        return "backoff";
    default:
        return "notStarted";
    }
}

static void set_usb_stage(diagnostic_usb_stage_t stage)
{
    diagnostic_rtc_usb_stage = (uint32_t)stage;
}

static void set_network_stage(diagnostic_network_stage_t stage)
{
    diagnostic_rtc_network_stage = (uint32_t)stage;
}

static bool reset_reason_is_watchdog(esp_reset_reason_t reason)
{
    return reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT ||
           reason == ESP_RST_WDT;
}

static uint32_t increment_saturating(uint32_t value)
{
    return value == UINT32_MAX ? value : value + 1U;
}

static void initialize_diagnostics(void)
{
    esp_reset_reason_t reset_reason = esp_reset_reason();
    diagnostic_last_reset_reason = reset_reason_name(reset_reason);

    nvs_handle_t store = 0;
    if (nvs_open("tan_diag", NVS_READWRITE, &store) != ESP_OK) {
        return;
    }
    if (nvs_get_u32(store, "boot_count", &diagnostic_boot_count) != ESP_OK) {
        diagnostic_boot_count = 0U;
    }
    if (nvs_get_u32(store, "brownout_count", &diagnostic_brownout_count) !=
        ESP_OK) {
        diagnostic_brownout_count = 0U;
    }
    if (nvs_get_u32(store, "watchdog_count", &diagnostic_watchdog_count) !=
        ESP_OK) {
        diagnostic_watchdog_count = 0U;
    }
    uint32_t previous_reset_reason = (uint32_t)ESP_RST_UNKNOWN;
    if (nvs_get_u32(store, "last_reset", &previous_reset_reason) == ESP_OK) {
        diagnostic_previous_reset_reason =
            reset_reason_name((esp_reset_reason_t)previous_reset_reason);
    }
    if (nvs_get_u32(store, "int_wdt", &diagnostic_interrupt_watchdog_count) !=
        ESP_OK) {
        diagnostic_interrupt_watchdog_count = 0U;
    }
    if (nvs_get_u32(store, "task_wdt", &diagnostic_task_watchdog_count) !=
        ESP_OK) {
        diagnostic_task_watchdog_count = 0U;
    }
    if (nvs_get_u32(store, "other_wdt", &diagnostic_other_watchdog_count) !=
        ESP_OK) {
        diagnostic_other_watchdog_count = 0U;
    }
    (void)nvs_get_u32(store, "wd_usb", &diagnostic_watchdog_usb_stage);
    (void)nvs_get_u32(store, "wd_net", &diagnostic_watchdog_network_stage);
    diagnostic_boot_count = increment_saturating(diagnostic_boot_count);
    if (reset_reason == ESP_RST_BROWNOUT) {
        diagnostic_brownout_count =
            increment_saturating(diagnostic_brownout_count);
    }
    if (reset_reason_is_watchdog(reset_reason)) {
        diagnostic_watchdog_count =
            increment_saturating(diagnostic_watchdog_count);
        if (reset_reason == ESP_RST_INT_WDT) {
            diagnostic_interrupt_watchdog_count =
                increment_saturating(diagnostic_interrupt_watchdog_count);
        } else if (reset_reason == ESP_RST_TASK_WDT) {
            diagnostic_task_watchdog_count =
                increment_saturating(diagnostic_task_watchdog_count);
        } else {
            diagnostic_other_watchdog_count =
                increment_saturating(diagnostic_other_watchdog_count);
        }
        if (diagnostic_rtc_magic == DIAGNOSTIC_RTC_MAGIC) {
            diagnostic_watchdog_usb_stage = diagnostic_rtc_usb_stage;
            diagnostic_watchdog_network_stage = diagnostic_rtc_network_stage;
        }
    }
    diagnostic_rtc_magic = DIAGNOSTIC_RTC_MAGIC;
    set_usb_stage(DIAGNOSTIC_USB_BOOT);
    set_network_stage(DIAGNOSTIC_NETWORK_NOT_STARTED);
    esp_err_t result = nvs_set_u32(store, "boot_count", diagnostic_boot_count);
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "brownout_count",
                             diagnostic_brownout_count);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "watchdog_count",
                             diagnostic_watchdog_count);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "last_reset", (uint32_t)reset_reason);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "int_wdt",
                             diagnostic_interrupt_watchdog_count);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "task_wdt",
                             diagnostic_task_watchdog_count);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "other_wdt",
                             diagnostic_other_watchdog_count);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "wd_usb", diagnostic_watchdog_usb_stage);
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "wd_net",
                             diagnostic_watchdog_network_stage);
    }
    if (result == ESP_OK) {
        result = nvs_commit(store);
    }
    diagnostics_persisted = result == ESP_OK;
    nvs_close(store);
}

static void send_error(const char *request_id, const char *code,
                       const char *message, bool retryable)
{
    cJSON *response = new_response(request_id);
    cJSON *error = cJSON_CreateObject();
    if (response == NULL || error == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(error);
        return;
    }
    cJSON_AddStringToObject(error, "code", code);
    cJSON_AddStringToObject(error, "message", message);
    cJSON_AddBoolToObject(error, "retryable", retryable);
    cJSON_AddItemToObject(response, "error", error);
    send_json(response);
}

static void send_status(const char *request_id)
{
    cJSON *response = new_response(request_id);
    cJSON *result = cJSON_CreateObject();
    cJSON *firmware = cJSON_CreateObject();
    cJSON *wifi = cJSON_CreateObject();
    cJSON *backend = cJSON_CreateObject();
    cJSON *claim = cJSON_CreateObject();
    cJSON *diagnostics = cJSON_CreateObject();
    if (response == NULL || result == NULL || firmware == NULL ||
        wifi == NULL || backend == NULL || claim == NULL ||
        diagnostics == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(result);
        cJSON_Delete(firmware);
        cJSON_Delete(wifi);
        cJSON_Delete(backend);
        cJSON_Delete(claim);
        cJSON_Delete(diagnostics);
        return;
    }

    cJSON_AddNumberToObject(result, "protocolVersion", SETUP_SCHEMA_VERSION);
    cJSON_AddStringToObject(result, "bridgeId", bridge_id);
    cJSON_AddStringToObject(firmware, "version", SETUP_FIRMWARE_VERSION);
    cJSON_AddStringToObject(firmware, "build", SETUP_BUILD_ID);
    cJSON_AddItemToObject(result, "firmware", firmware);
    cJSON_AddStringToObject(result, "lifecycle", lifecycle_state);
    cJSON_AddStringToObject(wifi, "state", wifi_state);
    cJSON_AddItemToObject(result, "wifi", wifi);
    cJSON_AddStringToObject(backend, "state", backend_state);
    cJSON_AddStringToObject(backend, "host", SETUP_BACKEND_HOST);
    cJSON_AddNumberToObject(backend, "port", SETUP_BACKEND_PORT);
    cJSON_AddItemToObject(result, "backend", backend);
    cJSON_AddStringToObject(
        claim, "state",
        device_token[0] != '\0' ? "claimed" :
        (claim_token[0] != '\0' ? "pending" : "unclaimed"));
    cJSON_AddItemToObject(result, "claim", claim);
    cJSON_AddNumberToObject(diagnostics, "bootCount", diagnostic_boot_count);
    cJSON_AddNumberToObject(diagnostics, "brownoutCount",
                            diagnostic_brownout_count);
    cJSON_AddNumberToObject(diagnostics, "watchdogCount",
                            diagnostic_watchdog_count);
    cJSON_AddStringToObject(diagnostics, "lastResetReason",
                            diagnostic_last_reset_reason);
    cJSON_AddStringToObject(diagnostics, "previousResetReason",
                            diagnostic_previous_reset_reason);
    cJSON_AddNumberToObject(diagnostics, "interruptWatchdogCount",
                            diagnostic_interrupt_watchdog_count);
    cJSON_AddNumberToObject(diagnostics, "taskWatchdogCount",
                            diagnostic_task_watchdog_count);
    cJSON_AddNumberToObject(diagnostics, "otherWatchdogCount",
                            diagnostic_other_watchdog_count);
    cJSON_AddStringToObject(diagnostics, "watchdogUsbStage",
                            usb_stage_name(diagnostic_watchdog_usb_stage));
    cJSON_AddStringToObject(
        diagnostics, "watchdogNetworkStage",
        network_stage_name(diagnostic_watchdog_network_stage));
    cJSON_AddBoolToObject(diagnostics, "persisted", diagnostics_persisted);
    cJSON_AddNumberToObject(diagnostics, "networkStartDelayMs",
                            SETUP_NETWORK_START_DELAY_MS);
    cJSON_AddNumberToObject(diagnostics, "wifiMaxTxPowerQuarterDbm",
                            SETUP_WIFI_MAX_TX_POWER_QDBM);
    cJSON_AddItemToObject(result, "diagnostics", diagnostics);
    cJSON_AddItemToObject(response, "result", result);
    send_json(response);
}

static const char *auth_mode_name(wifi_auth_mode_t mode)
{
    switch (mode) {
    case WIFI_AUTH_OPEN:
        return "open";
    case WIFI_AUTH_WEP:
        return "wep";
    case WIFI_AUTH_WPA_PSK:
        return "wpa-personal";
    case WIFI_AUTH_WPA2_PSK:
        return "wpa2-personal";
    case WIFI_AUTH_WPA_WPA2_PSK:
        return "wpa-wpa2-personal";
    case WIFI_AUTH_WPA3_PSK:
        return "wpa3-personal";
    case WIFI_AUTH_WPA2_WPA3_PSK:
        return "wpa2-wpa3-personal";
    case WIFI_AUTH_WPA2_ENTERPRISE:
        return "enterprise";
    default:
        return "unknown";
    }
}

static void sanitized_ssid(const uint8_t *source, char output[33])
{
    size_t length = strnlen((const char *)source, 32U);
    for (size_t index = 0U; index < length; index++) {
        uint8_t value = source[index];
        output[index] = value >= 0x20U && value <= 0x7eU ? (char)value : '?';
    }
    output[length] = '\0';
}

static esp_err_t initialize_wifi(void)
{
    if (wifi_initialized) {
        return ESP_OK;
    }

    esp_err_t result = esp_netif_init();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        return result;
    }
    result = esp_event_loop_create_default();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        return result;
    }
    wifi_netif = esp_netif_create_default_wifi_sta();
    if (wifi_netif == NULL) {
        return ESP_ERR_NO_MEM;
    }

    wifi_init_config_t configuration = WIFI_INIT_CONFIG_DEFAULT();
    result = esp_wifi_init(&configuration);
    if (result != ESP_OK) {
        return result;
    }
    result = esp_wifi_set_storage(WIFI_STORAGE_RAM);
    if (result != ESP_OK) {
        return result;
    }
    result = esp_wifi_set_mode(WIFI_MODE_STA);
    if (result != ESP_OK) {
        return result;
    }
    wifi_initialized = true;
    return ESP_OK;
}

static void random_hex_id(char output[17])
{
    snprintf(output, 17U, "%08lx%08lx", (unsigned long)esp_random(),
             (unsigned long)esp_random());
}

static void send_wifi_scan(const char *request_id)
{
    lifecycle_state = "provisioning";
    wifi_state = "scanning";

    esp_err_t result = initialize_wifi();
    if (result == ESP_OK) {
        result = esp_wifi_start();
    }
    if (result == ESP_OK) {
        const wifi_scan_config_t scan_configuration = {
            .ssid = NULL,
            .bssid = NULL,
            .channel = 0,
            .show_hidden = false,
            .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        };
        result = esp_wifi_scan_start(&scan_configuration, true);
    }

    uint16_t network_count = SETUP_MAX_NETWORKS;
    wifi_ap_record_t records[SETUP_MAX_NETWORKS] = {0};
    if (result == ESP_OK) {
        result = esp_wifi_scan_get_ap_records(&network_count, records);
    }
    esp_err_t stop_result = esp_wifi_stop();
    (void)stop_result;
    wifi_state = "disabled";
    lifecycle_state = "unprovisioned";

    if (result != ESP_OK) {
        send_error(request_id, "wifi_scan_failed",
                   "The bridge could not complete a Wi-Fi scan.", true);
        return;
    }

    cJSON *response = new_response(request_id);
    cJSON *scan = cJSON_CreateObject();
    cJSON *networks = cJSON_CreateArray();
    if (response == NULL || scan == NULL || networks == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(scan);
        cJSON_Delete(networks);
        send_error(request_id, "internal_error",
                   "The bridge could not encode the scan result.", true);
        return;
    }

    char scan_id[17];
    random_hex_id(scan_id);
    cJSON_AddStringToObject(scan, "scanId", scan_id);
    for (uint16_t index = 0U; index < network_count; index++) {
        cJSON *network = cJSON_CreateObject();
        if (network == NULL) {
            cJSON_Delete(response);
            cJSON_Delete(scan);
            cJSON_Delete(networks);
            send_error(request_id, "internal_error",
                       "The bridge could not encode the scan result.", true);
            return;
        }
        char network_id[17];
        char ssid[33];
        random_hex_id(network_id);
        sanitized_ssid(records[index].ssid, ssid);
        cJSON_AddStringToObject(network, "networkId", network_id);
        cJSON_AddStringToObject(network, "ssid", ssid);
        cJSON_AddStringToObject(network, "authMode",
                                auth_mode_name(records[index].authmode));
        cJSON_AddNumberToObject(network, "channel", records[index].primary);
        cJSON_AddNumberToObject(network, "rssi", records[index].rssi);
        cJSON_AddItemToArray(networks, network);
    }
    cJSON_AddItemToObject(scan, "networks", networks);
    cJSON_AddItemToObject(response, "result", scan);
    send_json(response);
}

static void restart_after_configuration(void *context)
{
    (void)context;
    vTaskDelay(pdMS_TO_TICKS(750));
    esp_restart();
}

static void send_configuration_result(const char *request_id,
                                      const cJSON *payload)
{
    static const char *const properties[] = {
        "ssid", "credential", "claimToken"};
    if (!object_has_exact_properties(payload, properties, 3U)) {
        send_error(request_id, "invalid_request",
                   "The Wi-Fi configuration payload is invalid.", false);
        return;
    }
    const cJSON *ssid = cJSON_GetObjectItemCaseSensitive(payload, "ssid");
    const cJSON *credential =
        cJSON_GetObjectItemCaseSensitive(payload, "credential");
    const cJSON *claim =
        cJSON_GetObjectItemCaseSensitive(payload, "claimToken");
    if (!cJSON_IsString(ssid) || !cJSON_IsString(credential) ||
        !cJSON_IsString(claim) || strlen(ssid->valuestring) == 0U ||
        strlen(ssid->valuestring) > 32U ||
        strlen(credential->valuestring) > 63U ||
        !is_token(claim->valuestring)) {
        send_error(request_id, "invalid_request",
                   "The Wi-Fi configuration payload is invalid.", false);
        return;
    }

    nvs_handle_t store = 0;
    esp_err_t result = nvs_open("tan_setup", NVS_READWRITE, &store);
    configuration_generation++;
    if (result == ESP_OK) {
        result = nvs_set_str(store, "wifi_ssid", ssid->valuestring);
    }
    if (result == ESP_OK) {
        result = nvs_set_str(store, "wifi_pass", credential->valuestring);
    }
    if (result == ESP_OK) {
        result = nvs_set_str(store, "claim", claim->valuestring);
    }
    if (result == ESP_OK) {
        result = nvs_erase_key(store, "device_token");
        if (result == ESP_ERR_NVS_NOT_FOUND) {
            result = ESP_OK;
        }
    }
    if (result == ESP_OK) {
        result = nvs_set_u32(store, "generation", configuration_generation);
    }
    if (result == ESP_OK) {
        result = nvs_commit(store);
    }
    if (store != 0) {
        nvs_close(store);
    }
    if (result != ESP_OK) {
        send_error(request_id, "wifi_configuration_failed",
                   "The bridge could not persist the Wi-Fi configuration.",
                   true);
        return;
    }

    snprintf(configured_ssid, sizeof(configured_ssid), "%s",
             ssid->valuestring);
    snprintf(configured_credential, sizeof(configured_credential), "%s",
             credential->valuestring);
    snprintf(claim_token, sizeof(claim_token), "%s", claim->valuestring);
    device_token[0] = '\0';
    lifecycle_state = "provisioning";

    cJSON *response = new_response(request_id);
    cJSON *configuration = cJSON_CreateObject();
    if (response == NULL || configuration == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(configuration);
        send_error(request_id, "internal_error",
                   "The bridge could not encode the configuration result.",
                   true);
        return;
    }
    cJSON_AddBoolToObject(configuration, "accepted", true);
    cJSON_AddNumberToObject(configuration, "configurationGeneration",
                           configuration_generation);
    cJSON_AddItemToObject(response, "result", configuration);
    send_json(response);
    (void)xTaskCreate(restart_after_configuration, "tan_config_restart", 2048,
                      NULL, 4, NULL);
}

static void process_request(const char *line)
{
    static const char *const envelope_properties[] = {
        "schemaVersion", "requestId", "type", "payload"};

    cJSON *request = cJSON_Parse(line);
    if (request == NULL || !cJSON_IsObject(request)) {
        cJSON_Delete(request);
        send_error(malformed_request_id, "invalid_request",
                   "Expected one strict setup request object.", false);
        return;
    }

    const cJSON *request_id_item =
        cJSON_GetObjectItemCaseSensitive(request, "requestId");
    bool valid_request_id = cJSON_IsString(request_id_item) &&
                            is_canonical_uuid(request_id_item->valuestring);
    const char *request_id =
        valid_request_id ? request_id_item->valuestring : malformed_request_id;
    if (!object_has_exact_properties(request, envelope_properties, 4U)) {
        send_error(request_id, "invalid_request",
                   "Expected one strict setup request object.", false);
        cJSON_Delete(request);
        return;
    }

    const cJSON *schema =
        cJSON_GetObjectItemCaseSensitive(request, "schemaVersion");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(request, "type");
    const cJSON *payload =
        cJSON_GetObjectItemCaseSensitive(request, "payload");

    if (!cJSON_IsNumber(schema) || schema->valuedouble != 1.0 ||
        !valid_request_id ||
        !cJSON_IsString(type) || !cJSON_IsObject(payload)) {
        send_error(request_id, "invalid_request",
                   "The setup request envelope is invalid.", false);
        cJSON_Delete(request);
        return;
    }
    if (request_id_was_seen(request_id)) {
        send_error(request_id, "invalid_request",
                   "The requestId was already used.", false);
        cJSON_Delete(request);
        return;
    }
    if (strcmp(type->valuestring, "setup.getStatus") == 0) {
        if (payload->child == NULL) {
            send_status(request_id);
        } else {
            send_error(request_id, "invalid_request",
                       "This operation requires an empty payload.", false);
        }
    } else if (strcmp(type->valuestring, "setup.scanWifi") == 0) {
        if (payload->child == NULL) {
            send_wifi_scan(request_id);
        } else {
            send_error(request_id, "invalid_request",
                       "This operation requires an empty payload.", false);
        }
    } else if (strcmp(type->valuestring, "setup.configure") == 0) {
        send_configuration_result(request_id, payload);
    } else {
        send_error(request_id, "unsupported_operation",
                   "This setup operation is not implemented by this build.",
                   false);
    }
    cJSON_Delete(request);
}

static void consume_bytes(const uint8_t *bytes, size_t length)
{
    for (size_t index = 0U; index < length; index++) {
        uint8_t value = bytes[index];
        if (value == '\r') {
            continue;
        }
        if (value == '\n') {
            if (discarding_oversized_line) {
                send_error(malformed_request_id, "invalid_request",
                           "The setup request exceeded 4096 bytes.", false);
            } else if (line_length > 0U) {
                line_buffer[line_length] = '\0';
                process_request(line_buffer);
            }
            line_length = 0U;
            discarding_oversized_line = false;
            continue;
        }
        if (discarding_oversized_line) {
            continue;
        }
        if (line_length + 1U >= SETUP_LINE_BYTES) {
            line_length = 0U;
            discarding_oversized_line = true;
            continue;
        }
        line_buffer[line_length++] = (char)value;
    }
}

static bool send_all(int socket_fd, const uint8_t *bytes, size_t length)
{
    size_t offset = 0U;
    while (offset < length) {
        ssize_t sent = send(socket_fd, bytes + offset, length - offset, 0);
        if (sent <= 0) {
            return false;
        }
        offset += (size_t)sent;
    }
    return true;
}

static bool receive_exact(int socket_fd, uint8_t *bytes, size_t length)
{
    size_t offset = 0U;
    while (offset < length) {
        ssize_t received = recv(socket_fd, bytes + offset, length - offset, 0);
        if (received <= 0) {
            return false;
        }
        offset += (size_t)received;
    }
    return true;
}

static bool receive_json_line(int socket_fd, char *line, size_t capacity)
{
    size_t length = 0U;
    while (length + 1U < capacity) {
        uint8_t value;
        if (!receive_exact(socket_fd, &value, 1U)) {
            return false;
        }
        if (value == '\n') {
            if (length > 0U && line[length - 1U] == '\r') {
                length--;
            }
            line[length] = '\0';
            return true;
        }
        line[length++] = (char)value;
    }
    return false;
}

static bool allowed_backend_sassi_frame(const uint8_t *bytes, size_t length)
{
    if (length < 5U || bytes[0] != 'K' || bytes[1] != 'L' ||
        bytes[length - 1U] != '\r') {
        return false;
    }
    uint32_t message_type = 0U;
    size_t index = 2U;
    bool has_digit = false;
    while (index < length && bytes[index] >= '0' && bytes[index] <= '9') {
        has_digit = true;
        message_type = message_type * 10U + (uint32_t)(bytes[index] - '0');
        index++;
    }
    if (!has_digit || index >= length || bytes[index] != ',') {
        return false;
    }
    return message_type == 1U || message_type == 3U ||
           message_type == 5U || message_type == 7U ||
           message_type == 13U;
}

static bool send_tunnel_frame(int socket_fd, const uint8_t *bytes,
                              size_t length)
{
    uint8_t header[3] = {
        TUNNEL_USB_TO_BACKEND,
        (uint8_t)(length >> 8U),
        (uint8_t)(length & 0xffU),
    };
    return send_all(socket_fd, header, sizeof(header)) &&
           send_all(socket_fd, bytes, length);
}

static void set_bridge_socket(int socket_fd)
{
    if (xSemaphoreTake(socket_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        bridge_socket = socket_fd;
        if (pending_usb_length > 0U) {
            set_usb_stage(DIAGNOSTIC_USB_REPLAYING);
            if (!send_tunnel_frame(socket_fd, pending_usb_bytes,
                                   pending_usb_length)) {
                shutdown(socket_fd, SHUT_RDWR);
            }
            set_usb_stage(DIAGNOSTIC_USB_IDLE);
        }
        xSemaphoreGive(socket_mutex);
    }
}

static void clear_bridge_socket(int socket_fd)
{
    if (xSemaphoreTake(socket_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        if (bridge_socket == socket_fd) {
            bridge_socket = -1;
        }
        xSemaphoreGive(socket_mutex);
    }
}

static void bridge_send_usb(const uint8_t *bytes, size_t length)
{
    set_usb_stage(DIAGNOSTIC_USB_BUFFERING);
    if (length == 0U || length > UINT16_MAX ||
        xSemaphoreTake(socket_mutex, pdMS_TO_TICKS(250)) != pdTRUE) {
        set_usb_stage(DIAGNOSTIC_USB_IDLE);
        return;
    }
    int socket_fd = bridge_socket;
    if (!usb_bootstrap_confirmed &&
        length <= sizeof(pending_usb_bytes) - pending_usb_length) {
        memcpy(pending_usb_bytes + pending_usb_length, bytes, length);
        pending_usb_length += length;
    }
    if (socket_fd >= 0) {
        if (!send_tunnel_frame(socket_fd, bytes, length)) {
            shutdown(socket_fd, SHUT_RDWR);
        }
    }
    xSemaphoreGive(socket_mutex);
    set_usb_stage(DIAGNOSTIC_USB_IDLE);
}

static void confirm_usb_session_started(void)
{
    if (xSemaphoreTake(socket_mutex, pdMS_TO_TICKS(250)) == pdTRUE) {
        usb_bootstrap_confirmed = true;
        xSemaphoreGive(socket_mutex);
    }
}

static bool associate_wifi(void)
{
    set_network_stage(DIAGNOSTIC_NETWORK_WIFI);
    wifi_state = "associating";
    if (initialize_wifi() != ESP_OK) {
        return false;
    }
    esp_err_t result = esp_wifi_start();
    if (result != ESP_OK && result != ESP_ERR_WIFI_CONN) {
        return false;
    }
    if (esp_wifi_set_ps(WIFI_PS_NONE) != ESP_OK ||
        esp_wifi_set_max_tx_power(SETUP_WIFI_MAX_TX_POWER_QDBM) != ESP_OK) {
        return false;
    }
    wifi_config_t configuration = {0};
    memcpy(configuration.sta.ssid, configured_ssid,
           strlen(configured_ssid));
    memcpy(configuration.sta.password, configured_credential,
           strlen(configured_credential));
    configuration.sta.threshold.authmode = WIFI_AUTH_OPEN;
    result = esp_wifi_set_config(WIFI_IF_STA, &configuration);
    if (result != ESP_OK) {
        return false;
    }
    (void)esp_wifi_disconnect();
    result = esp_wifi_connect();
    if (result != ESP_OK) {
        return false;
    }
    wifi_state = "obtainingAddress";
    for (size_t attempt = 0U; attempt < 60U; attempt++) {
        esp_netif_ip_info_t address = {0};
        if (esp_netif_get_ip_info(wifi_netif, &address) == ESP_OK &&
            address.ip.addr != 0U) {
            wifi_state = "online";
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    return false;
}

static int connect_backend(void)
{
    set_network_stage(DIAGNOSTIC_NETWORK_RESOLVING);
    backend_state = "resolving";
    char service[6];
    snprintf(service, sizeof(service), "%u", SETUP_BACKEND_PORT);
    const struct addrinfo hints = {
        .ai_family = AF_INET,
        .ai_socktype = SOCK_STREAM,
    };
    struct addrinfo *addresses = NULL;
    if (getaddrinfo(SETUP_BACKEND_HOST, service, &hints, &addresses) != 0 ||
        addresses == NULL) {
        if (addresses != NULL) {
            freeaddrinfo(addresses);
        }
        return -1;
    }
    backend_state = "connecting";
    set_network_stage(DIAGNOSTIC_NETWORK_CONNECTING);
    int socket_fd = socket(addresses->ai_family, addresses->ai_socktype,
                           addresses->ai_protocol);
    if (socket_fd < 0 ||
        connect(socket_fd, addresses->ai_addr, addresses->ai_addrlen) != 0) {
        if (socket_fd >= 0) {
            close(socket_fd);
        }
        freeaddrinfo(addresses);
        return -1;
    }
    freeaddrinfo(addresses);
    return socket_fd;
}

static bool persist_device_token(const char *token)
{
    nvs_handle_t store;
    if (nvs_open("tan_setup", NVS_READWRITE, &store) != ESP_OK) {
        return false;
    }
    esp_err_t result = nvs_set_str(store, "device_token", token);
    if (result == ESP_OK) {
        result = nvs_erase_key(store, "claim");
        if (result == ESP_ERR_NVS_NOT_FOUND) {
            result = ESP_OK;
        }
    }
    if (result == ESP_OK) {
        result = nvs_commit(store);
    }
    nvs_close(store);
    if (result == ESP_OK) {
        snprintf(device_token, sizeof(device_token), "%s", token);
        claim_token[0] = '\0';
    }
    return result == ESP_OK;
}

static bool authenticate_backend(int socket_fd)
{
    set_network_stage(DIAGNOSTIC_NETWORK_AUTHENTICATING);
    backend_state = "authenticating";
    cJSON *hello = cJSON_CreateObject();
    if (hello == NULL) {
        return false;
    }
    cJSON_AddNumberToObject(hello, "schemaVersion", SETUP_SCHEMA_VERSION);
    cJSON_AddStringToObject(hello, "bridgeId", bridge_id);
    cJSON_AddStringToObject(hello, "firmwareVersion",
                            SETUP_FIRMWARE_VERSION);
    cJSON_AddStringToObject(hello, "buildId", SETUP_BUILD_ID);
    if (device_token[0] != '\0') {
        cJSON_AddStringToObject(hello, "deviceToken", device_token);
    } else {
        cJSON_AddStringToObject(hello, "claimToken", claim_token);
    }
    char *encoded = cJSON_PrintUnformatted(hello);
    cJSON_Delete(hello);
    if (encoded == NULL) {
        return false;
    }
    bool sent = send_all(socket_fd, (const uint8_t *)encoded, strlen(encoded)) &&
                send_all(socket_fd, (const uint8_t *)"\n", 1U);
    cJSON_free(encoded);
    if (!sent) {
        return false;
    }

    char response_line[2048];
    if (!receive_json_line(socket_fd, response_line, sizeof(response_line))) {
        return false;
    }
    cJSON *response = cJSON_Parse(response_line);
    const cJSON *schema =
        cJSON_GetObjectItemCaseSensitive(response, "schemaVersion");
    const cJSON *accepted =
        cJSON_GetObjectItemCaseSensitive(response, "accepted");
    const cJSON *issued =
        cJSON_GetObjectItemCaseSensitive(response, "deviceToken");
    bool valid = response != NULL && cJSON_IsNumber(schema) &&
                 schema->valuedouble == SETUP_SCHEMA_VERSION &&
                 cJSON_IsTrue(accepted);
    if (valid && device_token[0] == '\0') {
        valid = cJSON_IsString(issued) && is_token(issued->valuestring) &&
                persist_device_token(issued->valuestring);
    }
    cJSON_Delete(response);
    return valid;
}

static void tunnel_backend(int socket_fd)
{
    set_network_stage(DIAGNOSTIC_NETWORK_TUNNEL);
    backend_state = "online";
    lifecycle_state = "operational";
    set_bridge_socket(socket_fd);
    uint8_t payload[TUNNEL_MAX_PAYLOAD_BYTES];
    while (true) {
        uint8_t header[3];
        if (!receive_exact(socket_fd, header, sizeof(header))) {
            break;
        }
        size_t length = ((size_t)header[1] << 8U) | header[2];
        if (header[0] != TUNNEL_BACKEND_TO_USB || length == 0U ||
            length > sizeof(payload) ||
            !receive_exact(socket_fd, payload, length) ||
            !allowed_backend_sassi_frame(payload, length)) {
            break;
        }
        if (!setup_protocol_active &&
            write_line((const char *)payload, length)) {
            confirm_usb_session_started();
        }
    }
    clear_bridge_socket(socket_fd);
    shutdown(socket_fd, SHUT_RDWR);
    close(socket_fd);
    backend_state = "backoff";
}

static void network_task(void *context)
{
    (void)context;
    set_network_stage(DIAGNOSTIC_NETWORK_DELAYING);
    vTaskDelay(pdMS_TO_TICKS(SETUP_NETWORK_START_DELAY_MS));
    while (true) {
        if (!associate_wifi()) {
            wifi_state = "backoff";
            backend_state = "offline";
            set_network_stage(DIAGNOSTIC_NETWORK_BACKOFF);
            vTaskDelay(pdMS_TO_TICKS(3000));
            continue;
        }
        int socket_fd = connect_backend();
        if (socket_fd < 0 || !authenticate_backend(socket_fd)) {
            if (socket_fd >= 0) {
                close(socket_fd);
            }
            backend_state = "backoff";
            set_network_stage(DIAGNOSTIC_NETWORK_BACKOFF);
            vTaskDelay(pdMS_TO_TICKS(3000));
            continue;
        }
        tunnel_backend(socket_fd);
        set_network_stage(DIAGNOSTIC_NETWORK_BACKOFF);
        vTaskDelay(pdMS_TO_TICKS(1500));
    }
}

static void cdc_rx_callback(int interface, cdcacm_event_t *event)
{
    (void)event;
    set_usb_stage(DIAGNOSTIC_USB_RECEIVING);
    setup_rx_event_t message = {0};
    if (tinyusb_cdcacm_read(interface, message.bytes, sizeof(message.bytes),
                            &message.length) == ESP_OK &&
        message.length > 0U) {
        (void)xQueueSend(rx_queue, &message, 0);
    }
    set_usb_stage(DIAGNOSTIC_USB_IDLE);
}

static void cdc_line_state_callback(int interface, cdcacm_event_t *event)
{
    (void)interface;
    /*
     * Both a browser serial session and the Nano can assert DTR. DTR therefore
     * cannot identify the peer. A setup session is selected only after the
     * first JSON request byte is observed; Nano traffic begins with "KL" and
     * must remain available to the bridge even while DTR is asserted.
     */
    if (!event->line_state_changed_data.dtr) {
        setup_protocol_active = false;
        line_length = 0U;
        discarding_oversized_line = false;
    }
}

static void encode_base32(const uint8_t input[16], char output[27])
{
    static const char alphabet[] = "abcdefghijklmnopqrstuvwxyz234567";
    uint32_t accumulator = 0U;
    unsigned int bits = 0U;
    size_t output_index = 0U;
    for (size_t input_index = 0U; input_index < 16U; input_index++) {
        accumulator = (accumulator << 8U) | input[input_index];
        bits += 8U;
        while (bits >= 5U) {
            bits -= 5U;
            output[output_index++] =
                alphabet[(accumulator >> bits) & 0x1fU];
        }
    }
    if (bits > 0U) {
        output[output_index++] =
            alphabet[(accumulator << (5U - bits)) & 0x1fU];
    }
    output[output_index] = '\0';
}

static void initialize_identity(void)
{
    nvs_handle_t identity_store;
    ESP_ERROR_CHECK(nvs_open("tan_setup", NVS_READWRITE, &identity_store));
    size_t length = sizeof(bridge_id);
    esp_err_t result = nvs_get_str(identity_store, "bridge_id", bridge_id,
                                   &length);
    if (result != ESP_OK || length != sizeof(bridge_id)) {
        uint8_t random_bytes[16];
        esp_fill_random(random_bytes, sizeof(random_bytes));
        encode_base32(random_bytes, bridge_id);
        ESP_ERROR_CHECK(nvs_set_str(identity_store, "bridge_id", bridge_id));
        ESP_ERROR_CHECK(nvs_commit(identity_store));
    }
    length = sizeof(configured_ssid);
    if (nvs_get_str(identity_store, "wifi_ssid", configured_ssid, &length) !=
        ESP_OK) {
        configured_ssid[0] = '\0';
    }
    length = sizeof(configured_credential);
    if (nvs_get_str(identity_store, "wifi_pass", configured_credential,
                    &length) != ESP_OK) {
        configured_credential[0] = '\0';
    }
    length = sizeof(claim_token);
    if (nvs_get_str(identity_store, "claim", claim_token, &length) != ESP_OK ||
        !is_token(claim_token)) {
        claim_token[0] = '\0';
    }
    length = sizeof(device_token);
    if (nvs_get_str(identity_store, "device_token", device_token, &length) !=
            ESP_OK ||
        !is_token(device_token)) {
        device_token[0] = '\0';
    }
    if (nvs_get_u32(identity_store, "generation", &configuration_generation) !=
        ESP_OK) {
        configuration_generation = 0U;
    }
    nvs_close(identity_store);
    if (configured_ssid[0] != '\0' &&
        (claim_token[0] != '\0' || device_token[0] != '\0')) {
        lifecycle_state = device_token[0] != '\0' ? "operational" : "claiming";
        wifi_state = "associating";
    }
}

void app_main(void)
{
    esp_err_t nvs_result = nvs_flash_init();
    if (nvs_result == ESP_ERR_NVS_NO_FREE_PAGES ||
        nvs_result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_result);
    initialize_diagnostics();
    initialize_identity();

    rx_queue = xQueueCreate(16U, sizeof(setup_rx_event_t));
    socket_mutex = xSemaphoreCreateMutex();
    if (rx_queue == NULL || socket_mutex == NULL) {
        abort();
    }

    const tinyusb_config_t usb_configuration = TINYUSB_DEFAULT_CONFIG();
    set_usb_stage(DIAGNOSTIC_USB_INITIALIZING);
    ESP_ERROR_CHECK(tinyusb_driver_install(&usb_configuration));
    const tinyusb_config_cdcacm_t cdc_configuration = {
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = cdc_line_state_callback,
        .callback_line_coding_changed = NULL,
    };
    ESP_ERROR_CHECK(tinyusb_cdcacm_init(&cdc_configuration));
    set_usb_stage(DIAGNOSTIC_USB_IDLE);

    if (configured_ssid[0] != '\0' &&
        (claim_token[0] != '\0' || device_token[0] != '\0')) {
        if (xTaskCreatePinnedToCore(network_task, "tan_bridge_network", 8192,
                                    NULL, 5, NULL,
                                    SETUP_NETWORK_TASK_CORE) != pdPASS) {
            abort();
        }
    }

    setup_rx_event_t event;
    while (true) {
        if (xQueueReceive(rx_queue, &event, portMAX_DELAY) == pdTRUE) {
            bool setup_bytes = setup_protocol_active || event.bytes[0] == '{';
            if (setup_bytes) {
                set_usb_stage(DIAGNOSTIC_USB_SETUP);
                setup_protocol_active = true;
                consume_bytes(event.bytes, event.length);
                set_usb_stage(DIAGNOSTIC_USB_IDLE);
            } else {
                bridge_send_usb(event.bytes, event.length);
            }
        }
    }
}
