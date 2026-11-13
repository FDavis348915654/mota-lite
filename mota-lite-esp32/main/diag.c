// diag.c —— USB 串口命令，用于远程验收：
//   cap            把 480x480 帧缓冲以 base64 分块吐出（host 端转 PNG）
//   tap <x> <y>    注入一次点击（主循环执行，避免与渲染线程抢 framebuffer）
//   newgame        重开一局
//   state          打一行状态
//   off / on       关屏 / 点亮（关屏=亮度0+DISPOFF，彻底熄像素）
//   save           导出当前存档串（备份/迁移）
//
// 走 USB Serial JTAG 的 VFS：安装驱动后 printf 仍然可用，日志不断。
// Created by Davis

#include "diag.h"

#include <stdio.h>
#include <string.h>

#include "driver/usb_serial_jtag.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board.h"
#include "game.h"
#include "font24.h"
#include "gfx.h"

static const char *TAG = "diag";

static volatile int s_tap_x = -1;
static volatile int s_tap_y = -1;
static volatile bool s_restart = false;
static volatile bool s_cap_lock = false;
static char s_load_buf[128];
static volatile bool s_load_pending = false;

bool diag_take_load(char *buf, int n)
{
    if (!s_load_pending) {
        return false;
    }
    snprintf(buf, n, "%s", s_load_buf);
    s_load_pending = false;
    return true;
}

bool diag_capture_locked(void)
{
    return s_cap_lock;
}

bool diag_take_tap(int *x, int *y)
{
    if (s_tap_x < 0) {
        return false;
    }
    *x = s_tap_x;
    *y = s_tap_y;
    s_tap_x = -1;
    s_tap_y = -1;
    return true;
}

bool diag_take_restart(void)
{
    if (!s_restart) {
        return false;
    }
    s_restart = false;
    return true;
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void b64_encode(const uint8_t *in, int n, char *out)
{
    int i = 0, o = 0;
    while (i < n) {
        uint32_t v = (uint32_t)in[i] << 16;
        int rem = n - i;
        if (rem > 1) {
            v |= (uint32_t)in[i + 1] << 8;
        }
        if (rem > 2) {
            v |= in[i + 2];
        }
        out[o++] = B64[(v >> 18) & 63];
        out[o++] = B64[(v >> 12) & 63];
        out[o++] = rem > 1 ? B64[(v >> 6) & 63] : '=';
        out[o++] = rem > 2 ? B64[v & 63] : '=';
        i += 3;
    }
    out[o] = '\0';
}

static void cap_write(const char *s, int n)
{
    // 直接写 USB Serial JTAG：printf 走的是 console 通道，批量输出会把 IDLE 饿死
    int off = 0;
    while (off < n) {
        int w = usb_serial_jtag_write_bytes((const uint8_t *)s + off, n - off, pdMS_TO_TICKS(1000));
        if (w <= 0) {
            break;
        }
        off += w;
    }
}

static void capture(void)
{
    const uint16_t *fb = gfx_fb();
    if (!fb) {
        printf("CAP ERR no fb\n");
        return;
    }
    const int total = SCR_W * SCR_H * 2;

    // 先让待处理的点击/动画推进，再冻结渲染并拷贝稳定快照
    vTaskDelay(pdMS_TO_TICKS(120));
    s_cap_lock = true;
    vTaskDelay(pdMS_TO_TICKS(90));
    uint8_t *copy = heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!copy) {
        s_cap_lock = false;
        printf("CAP ERR no mem\n");
        return;
    }
    memcpy(copy, fb, total);
    s_cap_lock = false;

    char line[540];
    int n = snprintf(line, sizeof(line), "CAP BEGIN %d %d %d\n", SCR_W, SCR_H, total);
    cap_write(line, n);

    char b64[520];
    uint8_t chunk[384];
    int sent = 0;
    for (int off = 0; off < total; off += sizeof(chunk)) {
        int m = total - off;
        if (m > (int)sizeof(chunk)) {
            m = sizeof(chunk);
        }
        memcpy(chunk, copy + off, m);
        b64_encode(chunk, m, b64);
        int len = snprintf(line, sizeof(line), "C %s\n", b64);
        cap_write(line, len);
        if ((++sent & 7) == 0) {
            vTaskDelay(1);
        }
    }
    cap_write("CAP END\n", 8);
    free(copy);
}

static void handle_line(char *line)
{
    line[strcspn(line, "\r\n")] = '\0';
    if (strcmp(line, "cap") == 0) {
        vTaskDelay(pdMS_TO_TICKS(120));  // 等主循环把上一帧画完
        capture();
    } else if (strcmp(line, "newgame") == 0) {
        s_restart = true;
    } else if (strcmp(line, "save") == 0) {
        char sc[256];
        game_debug_save(sc, sizeof(sc));
        printf("SAVE %s\n", sc[0] ? sc : "(empty)");
    } else if (strcmp(line, "state") == 0) {
        char st[256];
        game_debug_state(st, sizeof(st));
        printf("STATE %s\n", st);
    } else if (strncmp(line, "load ", 5) == 0) {
        snprintf(s_load_buf, sizeof(s_load_buf), "%s", line + 5);
        s_load_pending = true;
    } else if (strcmp(line, "off") == 0) {
        board_screen(false);
        printf("SCREEN off\n");
    } else if (strcmp(line, "on") == 0) {
        board_screen(true);
        printf("SCREEN on\n");
    } else if (strcmp(line, "font") == 0) {
        printf("FONT a1=%d ahan=%d w=%d w1=%d\n", font_advance('1'), font_advance(0x7B2C),
               gfx_text_width("第1层"), gfx_text20_width("118"));
    } else if (strncmp(line, "tap ", 4) == 0) {
        int x = -1, y = -1;
        if (sscanf(line + 4, "%d %d", &x, &y) == 2) {
            s_tap_x = x;
            s_tap_y = y;
        } else {
            printf("ERR tap needs x y\n");
        }
    } else if (line[0]) {
        printf("ERR unknown: %s\n", line);
    }
}

// 直接从 USB Serial JTAG 读字节，不走 stdin：
// 本机 console 配在 UART0（GPIO43/44），VFS 的 stdin 读不到 USB 输入。
static void diag_task(void *arg)
{
    (void)arg;
    char line[96];
    int len = 0;
    uint8_t buf[64];
    while (true) {
        int n = usb_serial_jtag_read_bytes(buf, sizeof(buf), pdMS_TO_TICKS(200));
        for (int i = 0; i < n; i++) {
            char c = (char)buf[i];
            if (c == '\r') {
                continue;
            }
            if (c == '\n') {
                line[len] = '\0';
                handle_line(line);
                len = 0;
                continue;
            }
            if (len < (int)sizeof(line) - 1) {
                line[len++] = c;
            }
        }
    }
}

void diag_init(void)
{
    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    cfg.rx_buffer_size = 1024;
    cfg.tx_buffer_size = 4096;
    esp_err_t err = usb_serial_jtag_driver_install(&cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "USB Serial JTAG 驱动安装失败 0x%x，诊断命令不可用", err);
        return;
    }
    // 放 CPU1，避免批量输出时把 CPU0 的 IDLE 饿死触发 task_wdt
    xTaskCreatePinnedToCore(diag_task, "diag", 8192, NULL, 4, NULL, 1);
    ESP_LOGI(TAG, "诊断命令就绪：cap / tap x y / newgame / state / off / on");
}
