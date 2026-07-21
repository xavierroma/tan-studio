idf_component_register(
  SRCS "app_main.c"
  INCLUDE_DIRS "."
  REQUIRES
    esp_timer
    tan_board
    tan_bridge_api
    tan_identity
    tan_roaster_session
    tan_sassi
    tan_spool
    tan_update
    tan_usb_device
    tan_wifi
)
