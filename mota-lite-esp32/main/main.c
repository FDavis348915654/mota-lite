// main.c —— 启动流程。
//
// 顺序：板级（电源/屏/触摸）-> 帧缓冲 -> 游戏（QuickJS + 首局）-> 首帧 -> 轮询
// 回合制只在状态变化时重绘，避免无谓地每帧推 450KB。
//
// Created by Davis

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board.h"
#include "game.h"
#include "gfx.h"
#include "input.h"

static const char *TAG = "main";

// 方向自检图：按「逻辑坐标」在四角画不同颜色 + 中心十字。
// 用户报告实际落位后即可确定屏幕需要旋转多少度。
// 逻辑左上=红 右上=绿 左下=蓝 右下=黄，左上角额外一块小白方块标「起点」
static void draw_orientation_test(void)
{
    gfx_clear(RGB565(0x20, 0x20, 0x28));
    const int B = 140;
    gfx_fill(0, 0, B, B, RGB565(0xE0, 0x20, 0x20));                    // 左上 红
    gfx_fill(SCR_W - B, 0, B, B, RGB565(0x20, 0xE0, 0x20));            // 右上 绿
    gfx_fill(0, SCR_H - B, B, B, RGB565(0x20, 0x40, 0xE0));            // 左下 蓝
    gfx_fill(SCR_W - B, SCR_H - B, B, B, RGB565(0xE0, 0xE0, 0x20));    // 右下 黄
    gfx_fill(SCR_W / 2 - 3, 0, 6, SCR_H, RGB565(0xFF, 0xFF, 0xFF));    // 竖线
    gfx_fill(0, SCR_H / 2 - 3, SCR_W, 6, RGB565(0xFF, 0xFF, 0xFF));    // 横线
    gfx_fill(6, 6, 28, 28, RGB565(0xFF, 0xFF, 0xFF));                  // 左上角小白块
}

void app_main(void)
{
    ESP_LOGI(TAG, "魔塔 Lite · ESP32-S3-Touch-AMOLED-2.16");

    board_init();
    gfx_init();

    if (!gfx_fb()) {
        ESP_LOGE(TAG, "帧缓冲不可用，停止");
        return;
    }

    // 方向自检：显示 5 秒再进游戏，方便确认旋转
    draw_orientation_test();
    board_flush(gfx_fb());
    ESP_LOGI(TAG, "方向自检图已显示 5 秒：逻辑左上=红 右上=绿 左下=蓝 右下=黄");
    vTaskDelay(pdMS_TO_TICKS(5000));

    game_init();
    game_render();
    board_flush(gfx_fb());
    game_dump_stats();

    while (true) {
        if (input_poll()) {
            game_render();
            board_flush(gfx_fb());
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
