#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_err.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
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
#define SETUP_BACKEND_HOST "bridge.tanstudio.xroma.dev"
#define SETUP_FIRMWARE_VERSION "0.1.0-dev"
#define SETUP_BUILD_ID "setup-v1"

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
static bool wifi_initialized;

static const char malformed_request_id[] =
    "00000000-0000-4000-8000-000000000000";

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

static void write_line(const char *line, size_t length)
{
    size_t offset = 0U;
    while (offset < length) {
        size_t queued = tinyusb_cdcacm_write_queue(
            TINYUSB_CDC_ACM_0, (const uint8_t *)&line[offset],
            length - offset);
        if (queued == 0U ||
            tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0,
                                       pdMS_TO_TICKS(250)) != ESP_OK) {
            return;
        }
        offset += queued;
    }
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
    if (response == NULL || result == NULL || firmware == NULL ||
        wifi == NULL || backend == NULL || claim == NULL) {
        cJSON_Delete(response);
        cJSON_Delete(result);
        cJSON_Delete(firmware);
        cJSON_Delete(wifi);
        cJSON_Delete(backend);
        cJSON_Delete(claim);
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
    cJSON_AddStringToObject(backend, "state", "offline");
    cJSON_AddStringToObject(backend, "host", SETUP_BACKEND_HOST);
    cJSON_AddItemToObject(result, "backend", backend);
    cJSON_AddStringToObject(claim, "state", "unclaimed");
    cJSON_AddItemToObject(result, "claim", claim);
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
    if (esp_netif_create_default_wifi_sta() == NULL) {
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
    if (payload->child != NULL) {
        send_error(request_id, "invalid_request",
                   "This operation requires an empty payload.", false);
        cJSON_Delete(request);
        return;
    }

    if (strcmp(type->valuestring, "setup.getStatus") == 0) {
        send_status(request_id);
    } else if (strcmp(type->valuestring, "setup.scanWifi") == 0) {
        send_wifi_scan(request_id);
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

static void cdc_rx_callback(int interface, cdcacm_event_t *event)
{
    (void)event;
    setup_rx_event_t message = {0};
    if (tinyusb_cdcacm_read(interface, message.bytes, sizeof(message.bytes),
                            &message.length) == ESP_OK &&
        message.length > 0U) {
        (void)xQueueSend(rx_queue, &message, 0);
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
    nvs_close(identity_store);
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
    initialize_identity();

    rx_queue = xQueueCreate(16U, sizeof(setup_rx_event_t));
    if (rx_queue == NULL) {
        abort();
    }

    const tinyusb_config_t usb_configuration = TINYUSB_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(tinyusb_driver_install(&usb_configuration));
    const tinyusb_config_cdcacm_t cdc_configuration = {
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = NULL,
        .callback_line_coding_changed = NULL,
    };
    ESP_ERROR_CHECK(tinyusb_cdcacm_init(&cdc_configuration));

    setup_rx_event_t event;
    while (true) {
        if (xQueueReceive(rx_queue, &event, portMAX_DELAY) == pdTRUE) {
            consume_bytes(event.bytes, event.length);
        }
    }
}
