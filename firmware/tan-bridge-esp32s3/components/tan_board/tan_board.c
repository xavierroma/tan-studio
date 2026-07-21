#include "tan_board.h"

#include "esp_app_desc.h"
#include "esp_system.h"

static tan_board_signal_t current_signal = TAN_BOARD_SIGNAL_OFF;

esp_err_t tan_board_init(void)
{
    current_signal = TAN_BOARD_SIGNAL_OFF;
    return ESP_OK;
}

tan_board_info_t tan_board_info(void)
{
    const esp_app_desc_t *description = esp_app_get_description();
    return (tan_board_info_t){
        .project_name = description->project_name,
        .version = description->version,
        .build_date = description->date,
        .build_time = description->time,
        .reset_reason = (uint32_t)esp_reset_reason(),
    };
}

void tan_board_set_signal(tan_board_signal_t signal)
{
    /* Hardware LED pulses are deliberately deferred until current is measured. */
    current_signal = signal;
}
