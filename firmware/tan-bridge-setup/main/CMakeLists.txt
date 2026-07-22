idf_component_register(
  SRCS "setup_main.c"
  INCLUDE_DIRS "."
  REQUIRES
    esp_event
    esp_netif
    esp_wifi
    json
    lwip
    nvs_flash
)
