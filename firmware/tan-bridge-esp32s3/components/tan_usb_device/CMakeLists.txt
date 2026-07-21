idf_component_register(
  SRCS "tan_usb_device.c" "tan_usb_device_policy.c"
  INCLUDE_DIRS "include"
  REQUIRES espressif__esp_tinyusb tan_board
)
