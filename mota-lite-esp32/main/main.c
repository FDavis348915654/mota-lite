// main.c —— 启动流程。
//
// 顺序：NVS -> 板级（电源/屏/触摸）-> 帧缓冲 -> 音频 -> 游戏（QuickJS + 读档）-> 首帧 -> 轮询
// 回合制只在状态变化时重绘；另外在闪烁/特效开始与结束时各补一帧，避免残留在屏幕上。
//
// Created by Davis

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "audio.h"
#include "board.h"
#include "diag.h"
#include "game.h"
#include "gfx.h"
#include "input.h"

static const char *TAG = "main";

void app_main(void)
{
    ESP_LOGI(TAG, "魔塔 Lite · ESP32-S3-Touch-AMOLED-2.16");

    // 存档要写 NVS，使用前必须先初始化；分区不兼容时清一次重来
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS 需要重建（旧存档作废）");
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    board_init();
    gfx_init();

    if (!gfx_fb()) {
        ESP_LOGE(TAG, "帧缓冲不可用，停止");
        return;
    }

    audio_init();

    game_init();
    game_render();
    board_flush(gfx_fb());
    game_dump_stats();
    audio_play("powerup");  // 开机短促提示音，顺便验证 codec 通路
    diag_init();            // USB 命令：cap / tap / newgame / state

    while (true) {
        if (diag_take_restart()) {
            input_note_activity();
            game_restart();
        }
        int dx = 0, dy = 0;
        if (diag_take_tap(&dx, &dy)) {
            input_note_activity();  // 远程注入也算「有人动过」，别被空闲熄屏打断
            game_tap(dx, dy);
        }
        char load_buf[128];
        if (diag_take_load(load_buf, sizeof(load_buf))) {
            input_note_activity();
            game_load_text(load_buf);
        }

        if (diag_capture_locked()) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        game_tick();

        // 行走/战斗动画/弹层由 game 内部置脏；输入与闪烁起止也各补一帧
        if (input_poll() || game_needs_render()) {
            game_render();
            board_flush(gfx_fb());
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
