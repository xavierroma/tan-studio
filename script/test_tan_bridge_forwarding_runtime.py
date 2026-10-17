"""Compile actual ESP adapter functions against deterministic failure stubs.

No device/network access. The production C functions, not copies or a Python
model, execute with failed mutex, failed socket, saturated USB and reconnects.
"""
from pathlib import Path
import subprocess
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "firmware/tan-bridge-setup/main"
source = (MAIN / "setup_main.c").read_text()

def function(name):
    start = re.search(r"static (?:void|bool) " + name + r"\(", source).start()
    opening = source.index("{", start)
    depth, end = 1, opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]

stubs = r'''
#include "forwarding.h"
#include "tunnel_policy.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
#define SETUP_RX_CHUNK_BYTES 512U
#define TUNNEL_BACKEND_TO_USB 2U
#define TUNNEL_MAX_PAYLOAD_BYTES 8192U
#define pdTRUE 1
#define pdMS_TO_TICKS(n) (n)
#define portMAX_DELAY (-1)
#define ESP_OK 0
#define TINYUSB_CDC_ACM_0 0
#define DIAGNOSTIC_USB_BUFFERING 1
#define DIAGNOSTIC_USB_IDLE 2
#define DIAGNOSTIC_USB_TRANSMITTING 3
#define DIAGNOSTIC_USB_RECEIVING 4
typedef void *esp_websocket_client_handle_t;
typedef int cdcacm_event_t;
typedef struct { size_t length; uint8_t bytes[512]; } setup_rx_event_t;
static tan_forwarder_t forwarder;
static int forwarding_mux, bridge_mutex, critical_depth;
static bool usb_reconnect_requested, mutex_ok = true, send_ok = true;
static bool setup_protocol_active, usb_write_ok = true;
static bool write_line(const char *data, size_t length) { (void)data; (void)length; return usb_write_ok; }
static void *bridge_client;
static unsigned signals, sends, disconnects, connects, delay_calls;
static uint8_t usb_input[512], sent_bytes[512];
static size_t usb_length, sent_length;
static void portENTER_CRITICAL(int *m) { (void)m; assert(!critical_depth); critical_depth++; }
static void portEXIT_CRITICAL(int *m) { (void)m; assert(critical_depth==1); critical_depth--; }
static int xSemaphoreTake(int m, int timeout) {
    (void)m; assert(!critical_depth);
    return timeout == portMAX_DELAY || mutex_ok ? pdTRUE : 0;
}
static void xSemaphoreGive(int m) { (void)m; assert(!critical_depth); }
static void set_usb_stage(int stage) { (void)stage; }
static void signal_websocket_failure(void) { assert(!critical_depth); signals++; }
static bool send_tunnel_frame(void *client, const uint8_t *bytes, size_t n) {
    assert(!critical_depth && client && n<=512); sends++;
    memcpy(sent_bytes,bytes,n); sent_length=n; return send_ok;
}
static int tinyusb_cdcacm_read(int interface, uint8_t *out, size_t cap, size_t *n) {
    (void)interface; assert(!critical_depth); *n=usb_length<cap?usb_length:cap;
    memcpy(out,usb_input,*n); usb_length-=*n; return ESP_OK;
}
static void tud_disconnect(void) { assert(!critical_depth); disconnects++; }
static void tud_connect(void) { assert(!critical_depth); connects++; }
static void vTaskDelay(int ticks) { assert(!critical_depth && ticks==250); delay_calls++; }
'''
names = ["fail_forwarding", "set_bridge_client", "clear_bridge_client",
         "bridge_send_usb", "recover_usb_session", "cdc_rx_callback", "deliver_backend_record"]
tests = r'''
static void reset(void) {
    memset(&forwarder,0,sizeof(forwarder));
    forwarder.peer=TAN_PEER_NANO;
    bridge_client=(void *)1; mutex_ok=send_ok=true;
    signals=sends=disconnects=connects=delay_calls=0;
    usb_length=sent_length=0; usb_reconnect_requested=false;
}
int main(void) {
    uint8_t bytes[512]; memset(bytes,'x',sizeof(bytes));
    reset(); bridge_send_usb(bytes,512,0);
    assert(sends==1 && !signals && sent_length==512 && !memcmp(bytes,sent_bytes,512));
    reset(); mutex_ok=false; bridge_send_usb(bytes,512,0);
    assert(!sends && signals==1 && forwarder.failed);
    reset(); send_ok=false; bridge_send_usb(bytes,512,0);
    assert(sends==1 && signals==1 && forwarder.failed);
    reset(); bridge_send_usb(bytes,512,99);
    assert(!sends && forwarder.stats.discarded==512);
    reset();
    for(unsigned i=0;i<65;i++) {
        memcpy(usb_input,bytes,512); usb_length=512; cdc_rx_callback(0,NULL);
    }
    assert(forwarder.failed && forwarder.stats.overflows==1 && signals==1);
    assert(forwarder.length==0);
    set_bridge_client((void *)2);
    assert(usb_reconnect_requested && forwarder.recovering);
    /* Stale bytes during re-enumeration cannot enter the next session. */
    memcpy(usb_input,bytes,512); usb_length=512; cdc_rx_callback(0,NULL);
    assert(forwarder.length==0);
    recover_usb_session();
    assert(disconnects==1 && connects==1 && delay_calls==1);
    assert(!forwarder.failed && !forwarder.recovering);
    memcpy(usb_input,bytes,512); usb_length=512; cdc_rx_callback(0,NULL);
    uint32_t generation; uint8_t out[512];
    assert(tan_forward_pop(&forwarder,out,512,&generation)==512);
    bridge_send_usb(out,512,generation);
    assert(sends==1 && !memcmp(bytes,sent_bytes,512));
    clear_bridge_client((void *)2);
    assert(!bridge_client && forwarder.failed);
    reset(); forwarder.peer=TAN_PEER_SETUP;
    set_bridge_client((void *)2); recover_usb_session();
    assert(!disconnects && !connects);
    reset();
    const uint8_t record[] = {2,0,12,'K','L','*','1','|','0','|','e','c','e','2','\r'};
    assert(deliver_backend_record(record,sizeof(record)));
    usb_write_ok=false;
    assert(!deliver_backend_record(record,sizeof(record)));
    assert(forwarder.failed && signals==1);
    assert(!critical_depth);
    puts("actual ESP adapter C: mutex/send failure, saturation, stale-generation isolation, USB recovery and setup isolation passed");
}
'''
with tempfile.TemporaryDirectory(prefix="tan-forwarding-runtime-") as directory:
    root = Path(directory)
    c = root / "runtime.c"
    c.write_text(stubs + "\n".join(function(name) for name in names) + tests)
    binary = root / "runtime"
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-pedantic",
                    "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
                    "-I", str(MAIN), str(MAIN / "forwarding.c"), str(MAIN / "tunnel_policy.c"), str(c),
                    "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
