#ifndef TAN_BOARD_H
#define TAN_BOARD_H

#include <stdint.h>

#include "esp_err.h"

typedef enum {
    TAN_BOARD_SIGNAL_OFF,
    TAN_BOARD_SIGNAL_BOOTING,
    TAN_BOARD_SIGNAL_BACKEND_CONNECTED,
    TAN_BOARD_SIGNAL_RECOVERY_WAITING,
    TAN_BOARD_SIGNAL_FAULT,
} tan_board_signal_t;

typedef struct {
    const char *project_name;
    const char *version;
    const char *build_date;
    const char *build_time;
    uint32_t reset_reason;
} tan_board_info_t;

esp_err_t tan_board_init(void);
tan_board_info_t tan_board_info(void);
void tan_board_set_signal(tan_board_signal_t signal);

#endif
