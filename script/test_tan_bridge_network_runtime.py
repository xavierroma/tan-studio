"""Execute production clock/Wi-Fi retry functions with deterministic SDK stubs."""
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "firmware/tan-bridge-setup/main/setup_main.c").read_text()

def extract(name):
    start = re.search(r"static bool " + name + r"\(", source).start()
    opening = source.index("{", start)
    depth, end = 1, opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]

stubs = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#define ESP_OK 0
#define ESP_ERR_WIFI_CONN 1
#define WIFI_PS_NONE 0
#define WIFI_IF_STA 0
#define WIFI_AUTH_OPEN 0
#define DIAGNOSTIC_NETWORK_WIFI 0
#define SETUP_WIFI_MAX_TX_POWER_QDBM 44
#define pdMS_TO_TICKS(n) (n)
typedef int esp_err_t;
typedef struct { int unused; } wifi_ap_record_t;
typedef struct { struct { unsigned addr; } ip; } esp_netif_ip_info_t;
typedef struct { struct { char ssid[33], password[64]; struct { int authmode; } threshold; } sta; } wifi_config_t;
typedef struct { const char *server; } esp_sntp_config_t;
#define ESP_NETIF_SNTP_DEFAULT_CONFIG(s) { .server=(s) }
static size_t sntp_server_index;
static void *wifi_netif;
static const char *wifi_state;
static char configured_ssid[33]="fixture", configured_credential[64]="fixture";
static bool associated=true, has_ip=true, sync_ok=false;
static unsigned disconnects, connections, initializations, deinitializations;
static time_t fake_time;
static const char *used_server;
static time_t test_time(time_t *out) { if(out)*out=fake_time; return fake_time; }
#define time test_time
static void set_network_stage(int x) { (void)x; }
static int initialize_wifi(void) { return ESP_OK; }
static int esp_wifi_sta_get_ap_info(wifi_ap_record_t *a) { (void)a; return associated?ESP_OK:2; }
static int esp_netif_get_ip_info(void *n, esp_netif_ip_info_t *a) { (void)n; a->ip.addr=has_ip?1:0; return ESP_OK; }
static int esp_wifi_start(void) { return ESP_OK; }
static int esp_wifi_set_ps(int x) { (void)x; return ESP_OK; }
static int esp_wifi_set_max_tx_power(int x) { (void)x; return ESP_OK; }
static int esp_wifi_set_config(int x, wifi_config_t *c) { (void)x; (void)c; return ESP_OK; }
static int esp_wifi_disconnect(void) { disconnects++; associated=false; return ESP_OK; }
static int esp_wifi_connect(void) { connections++; associated=true; has_ip=true; return ESP_OK; }
static void vTaskDelay(int x) { (void)x; }
static int esp_netif_sntp_init(esp_sntp_config_t *c) { initializations++; used_server=c->server; return ESP_OK; }
static int esp_netif_sntp_sync_wait(int x) { assert(x==15000); if(sync_ok)fake_time=1792263600; return sync_ok?ESP_OK:2; }
static void esp_netif_sntp_deinit(void) { deinitializations++; }
'''
tests = r'''
int main(void) {
    /* The old implementation disconnects here and fails this regression. */
    assert(associate_wifi()); assert(!disconnects && !connections);
    assert(!synchronize_clock()); assert(!strcmp(used_server,"time.cloudflare.com"));
    assert(associate_wifi()); assert(!disconnects && !connections);
    assert(!synchronize_clock()); assert(!strcmp(used_server,"time.google.com"));
    assert(associate_wifi()); assert(!disconnects && !connections);
    sync_ok=true;
    assert(synchronize_clock()); assert(!strcmp(used_server,"pool.ntp.org"));
    assert(initializations==3 && deinitializations==2);
    assert(synchronize_clock()); assert(initializations==3);
    associated=false; has_ip=false;
    assert(associate_wifi()); assert(disconnects==1 && connections==1);
    assert(!strcmp(wifi_state,"online"));
    puts("actual network C: clock fallback preserves Wi-Fi, stops failed clients, keeps periodic sync and reconnects lost Wi-Fi");
}
'''
with tempfile.TemporaryDirectory(prefix="tan-network-runtime-") as directory:
    root = Path(directory)
    c = root / "network.c"
    c.write_text(stubs + extract("associate_wifi") + extract("synchronize_clock") + tests)
    binary = root / "network"
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-pedantic",
                    "-fsanitize=address,undefined", str(c), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
