#ifndef TAN_BUILD_CONFIG_H
#define TAN_BUILD_CONFIG_H

/* Safety policy for the image intended for the first Nano connection. */
#define TAN_BRIDGE_FIRST_NANO_BUILD 1
#define TAN_BRIDGE_SASSI_TX_ENABLED 0
#define TAN_BRIDGE_WIFI_ENABLED 0
#define TAN_BRIDGE_API_ENABLED 0
#define TAN_BRIDGE_PAIRING_ENABLED 0
#define TAN_BRIDGE_OTA_ENABLED 0

#if TAN_BRIDGE_FIRST_NANO_BUILD != 1
#error "This workspace currently builds only the first-Nano receive-only image"
#endif

#if TAN_BRIDGE_SASSI_TX_ENABLED != 0
#error "SASSI transmit must be absent from the first-Nano image"
#endif

#if TAN_BRIDGE_WIFI_ENABLED != 0 || TAN_BRIDGE_API_ENABLED != 0
#error "Network features require the passive Nano power and USB gate"
#endif

#if TAN_BRIDGE_PAIRING_ENABLED != 0 || TAN_BRIDGE_OTA_ENABLED != 0
#error "Pairing and OTA are not part of the offline-safe foundation"
#endif

#endif
