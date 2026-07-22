idf_component_register(
  SRCS "setup_main.c" "tunnel_policy.c"
  INCLUDE_DIRS "."
  REQUIRES
    esp_event
    espcoredump
    esp_netif
    esp_wifi
    json
    lwip
    nvs_flash
)
