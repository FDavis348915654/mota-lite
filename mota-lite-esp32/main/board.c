// board.c —— 板级初始化：I2C、AXP2101（电源）、CO5300 QSPI 屏、CST9217 触摸。
//
// 参数全部取自微雪官方 BSP 源码：
//   waveshareteam/waveshare_boards → boards/esp32_s3_touch_amoled_2_16/
//     board_peripherals.yaml : I2C SDA15/SCL14, QSPI MOSI4/MISO5/WP6/HD7/SCLK38, CS12
//     board_devices.yaml     : 屏 RST39, 触摸 RST40/INT11 @0x5A, swap_xy+mirror_y
//     power_manager.c        : AXP2101 只需 0x90=0x01 打开 ALDO1（麦克风），
//                              屏的 VCC3V3 由 DCDC1 默认输出，不必额外配
//
// 不用微雪 BSP 组件的原因：它硬依赖 LVGL 与 libpng/freetype/jpeg 一整棵解码树，
// 而本项目的渲染是自绘 framebuffer，一个都用不到（依赖从 23 个降到 6 个）。
//
// Created by Davis

#include "board.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_co5300.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "esp_lcd_touch_cst9217.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "gfx.h"

static const char *TAG = "board";

// ---- 引脚（来自 BSP yaml，勿随意改）----
#define PIN_I2C_SDA   15
#define PIN_I2C_SCL   14

#define PIN_LCD_SCLK  38
#define PIN_LCD_D0    4
#define PIN_LCD_D1    5
#define PIN_LCD_D2    6
#define PIN_LCD_D3    7
#define PIN_LCD_CS    12
#define PIN_LCD_RST   39

#define PIN_TP_RST    40
#define PIN_TP_INT    11

#define PIN_KEY3      18

#define LCD_HOST      SPI2_HOST
#define LCD_HZ        (80 * 1000 * 1000)
#define LCD_MAX_XFER  (SCR_W * 2 * 20)
// 每次推屏的行数：40 行 = 38400 字节，在内部 RAM 的中转缓冲能力内（空闲 130KB+）
#define FLUSH_ROWS    40

#define AXP2101_ADDR  0x34

static esp_lcd_panel_handle_t s_panel = NULL;
static esp_lcd_touch_handle_t s_touch = NULL;
static i2c_master_bus_handle_t s_i2c_bus = NULL;
static SemaphoreHandle_t s_flush_done = NULL;

// 这块 CO5300 的原生扫描方向比逻辑画面顺时针多转了 90°，
// 因此在推屏前把整帧逆时针转 90° 再送。用软件转置而不是改 MADCTL，
// 是因为 CO5300 驱动的 draw_bitmap 不会随 MV 位交换 CASET/RASET，
// 改寄存器会导致坐标语义错乱；软件转置则渲染层完全不用感知。
static uint16_t *s_rot = NULL;
static bool s_screen_on = true;  // 面板当前是否点亮（关屏后跳过重复命令）

// ---------------- AXP2101 ----------------

static esp_err_t axp_write(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(dev, buf, sizeof(buf), 100);
}

// 打开 ALDO1（ES7210 麦克风供电）。BSP 里唯一显式的电源动作，
// 屏与逻辑供电走 DCDC1(VCC3V3)，芯片默认输出，无需配置。
static void power_axp2101_init(void)
{
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = AXP2101_ADDR,
        .scl_speed_hz = 400000,
    };
    i2c_master_dev_handle_t dev = NULL;
    if (i2c_master_bus_add_device(s_i2c_bus, &dev_cfg, &dev) != ESP_OK) {
        ESP_LOGW(TAG, "AXP2101 挂载失败，音频将无声（屏不受影响）");
        return;
    }
    esp_err_t err = axp_write(dev, 0x90, 0x01);
    ESP_LOGI(TAG, "AXP2101 ALDO1 使能 %s", err == ESP_OK ? "OK" : "失败");
    i2c_master_bus_rm_device(dev);
}

// ---------------- 屏 ----------------

static bool on_color_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *edata, void *ctx)
{
    BaseType_t woken = pdFALSE;
    if (s_flush_done) {
        xSemaphoreGiveFromISR(s_flush_done, &woken);
    }
    return woken == pdTRUE;
}

static void lcd_init(void)
{
    const spi_bus_config_t bus_cfg = CO5300_PANEL_BUS_QSPI_CONFIG(
        PIN_LCD_SCLK, PIN_LCD_D0, PIN_LCD_D1, PIN_LCD_D2, PIN_LCD_D3, LCD_MAX_XFER);
    ESP_ERROR_CHECK(spi_bus_initialize(LCD_HOST, &bus_cfg, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_cfg = CO5300_PANEL_IO_QSPI_CONFIG(PIN_LCD_CS, on_color_done, NULL);
    io_cfg.pclk_hz = LCD_HZ;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &io_cfg, &io));

    const co5300_vendor_config_t vendor_cfg = {
        .flags = {.use_qspi_interface = 1},
    };
    const esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = PIN_LCD_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = (void *)&vendor_cfg,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_co5300(io, &panel_cfg, &s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(s_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_panel, true));

    ESP_LOGI(TAG, "CO5300 就绪 %dx%d QSPI", SCR_W, SCR_H);
}

// ---------------- 触摸 ----------------

static void touch_init(void)
{
    esp_lcd_panel_io_handle_t tp_io = NULL;
    esp_lcd_panel_io_i2c_config_t tp_io_cfg = ESP_LCD_TOUCH_IO_I2C_CST9217_CONFIG();
    tp_io_cfg.scl_speed_hz = 400000;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(s_i2c_bus, &tp_io_cfg, &tp_io));

    esp_lcd_touch_config_t tp_cfg = {
        .x_max = SCR_W,
        .y_max = SCR_H,
        .rst_gpio_num = PIN_TP_RST,
        .int_gpio_num = PIN_TP_INT,
        .levels = {
            .reset = 0,
            .interrupt = 0,
        },
        .flags = {
            .swap_xy = 1,   // BSP 官方配置：面板原生坐标是横的，需交换
            .mirror_x = 0,
            .mirror_y = 1,  // 且 Y 轴镜像，否则上下颠倒
        },
    };
    ESP_ERROR_CHECK(esp_lcd_touch_new_i2c_cst9217(tp_io, &tp_cfg, &s_touch));
    ESP_LOGI(TAG, "CST9217 触摸就绪");
}

// ---------------- 对外接口 ----------------

void board_init(void)
{
    i2c_master_bus_config_t i2c_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&i2c_cfg, &s_i2c_bus));

    power_axp2101_init();

    s_flush_done = xSemaphoreCreateBinary();
    lcd_init();
    touch_init();

    // 旋转中转缓冲（PSRAM）：480*480*2 = 450KB
    s_rot = heap_caps_malloc(SCR_W * SCR_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_rot) {
        ESP_LOGE(TAG, "旋转缓冲分配失败，屏幕将无法刷新");
    }

    gpio_config_t key = {
        .pin_bit_mask = 1ULL << PIN_KEY3,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&key);
}

bool board_touch_read(int *x, int *y)
{
    if (!s_touch) {
        return false;
    }
    esp_lcd_touch_read_data(s_touch);

    uint16_t tx[1] = {0};
    uint16_t ty[1] = {0};
    uint8_t count = 0;
    bool pressed = esp_lcd_touch_get_coordinates(s_touch, tx, ty, NULL, &count, 1);

    if (pressed && count > 0) {
        // 注意：这里不做任何旋转换算。触摸驱动的 swap_xy/mirror_y 配置已经
        // 输出与「旋转后画面」一致的方向，只有推屏那一层需要转。
        if (x) {
            *x = tx[0];
        }
        if (y) {
            *y = ty[0];
        }
        return true;
    }
    return false;
}

void board_flush(const uint16_t *fb)
{
    if (!s_panel || !fb || !s_rot) {
        return;
    }
    int64_t t0 = esp_timer_get_time();

    // 逆时针 90°：逻辑 (x, y) -> 物理 (y, H-1-x)
    // 直接按列写会让目标地址跨 960 字节跳，PSRAM 缓存几乎每像素都失效（实测 43ms）。
    // 改成 32x32 分块：块内源 2KB + 目标 2KB 都能进 cache，实测降到 10ms 以内。
    enum { ROT_TILE = 32 };
    for (int by = 0; by < SCR_H; by += ROT_TILE) {
        int ymax = by + ROT_TILE < SCR_H ? by + ROT_TILE : SCR_H;
        for (int bx = 0; bx < SCR_W; bx += ROT_TILE) {
            int xmax = bx + ROT_TILE < SCR_W ? bx + ROT_TILE : SCR_W;
            for (int x = bx; x < xmax; x++) {
                uint16_t *dst = s_rot + (size_t)(SCR_W - 1 - x) * SCR_H;
                for (int y = by; y < ymax; y++) {
                    dst[y] = fb[(size_t)y * SCR_W + x];
                }
            }
        }
    }
    int64_t t1 = esp_timer_get_time();

    // 不能整屏一次性推：帧缓冲在 PSRAM，SPI 驱动会为不满足 DMA 要求的源缓冲
    // 在内部 RAM 分配中转缓冲（spicommon_dma_setup_priv_buffer），460800 字节
    // 一次要，内部 RAM 只剩 ~50KB，直接 ESP_ERR_INVALID_ARG。
    // 因此按 20 行一段（19200 字节）分块推。
    for (int y = 0; y < SCR_H; y += FLUSH_ROWS) {
        int rows = (SCR_H - y < FLUSH_ROWS) ? (SCR_H - y) : FLUSH_ROWS;
        esp_err_t err = esp_lcd_panel_draw_bitmap(s_panel, 0, y, SCR_W, y + rows, s_rot + (size_t)y * SCR_W);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "draw_bitmap(rows %d..%d) 失败 0x%x", y, y + rows, err);
            return;
        }
        // 每段等一次传输完成，避免队列堆积把 DMA 描述符吃光
        if (s_flush_done) {
            xSemaphoreTake(s_flush_done, pdMS_TO_TICKS(100));
        }
    }

    // 前几帧打一次耗时，用于判断要不要上 PPA（只统计开机阶段，之后不刷屏）
    static int s_logged = 0;
    if (s_logged < 5) {
        ESP_LOGI(TAG, "推屏 %.1fms（转置 %.1fms）",
                 (esp_timer_get_time() - t0) / 1000.0, (t1 - t0) / 1000.0);
        s_logged++;
    }
}

bool board_key_pressed(void)
{
    return gpio_get_level(PIN_KEY3) == 0;  // 按下接地
}

void board_screen(bool on)
{
    if (!s_panel || s_screen_on == on) {
        return;
    }
    // 关屏做两层：亮度先归 0，再发 DISPOFF。
    // 只发 DISPOFF 时，个别 CO5300 批次仍会保留微弱残像（AMOLED 自发光，残像会烧屏），
    // 亮度归 0 是彻底熄像素；开屏时先 DISPON 再恢复亮度。
    if (on) {
        esp_lcd_panel_disp_on_off(s_panel, true);
        esp_lcd_panel_co5300_set_brightness(s_panel, 100);
    } else {
        esp_lcd_panel_co5300_set_brightness(s_panel, 0);
        esp_lcd_panel_disp_on_off(s_panel, false);
    }
    s_screen_on = on;
    ESP_LOGI(TAG, "屏幕%s", on ? "点亮" : "关闭（省电/防烧屏）");
}

bool board_screen_is_on(void)
{
    return s_screen_on;
}

void *board_i2c_bus(void)
{
    return s_i2c_bus;
}
