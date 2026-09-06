idf_component_register(
  SRCS "setup_main.c" "tunnel_policy.c"
  INCLUDE_DIRS "."
  REQUIRES
    esp_event
    espcoredump
    esp_netif
    esp_websocket_client
    esp_wifi
    json
    lwip
    mbedtls
    nvs_flash
)
