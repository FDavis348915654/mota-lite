// input.c —— 触摸与按键输入。
// 触摸按「按下沿」触发，避免按住不放连续走格。
// Key3：进行中切换静音，结算页重开一局。
// 空闲 2 分钟自动熄屏（AMOLED 静态画面长期不灭会烧屏，也省电），任意触摸/按键唤醒。
// Created by Davis

#include "input.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "audio.h"
#include "board.h"
#include "game.h"

static const char *TAG = "input";

// 空闲熄屏阈值：够长，不会在读剧情/想路时突然黑掉
#define SCREEN_IDLE_MS 120000

static bool s_touch_down = false;
static bool s_key_down = false;
static TickType_t s_last_active = 0;

void input_note_activity(void)
{
    s_last_active = xTaskGetTickCount();
    if (!board_screen_is_on()) {
        board_screen(true);
    }
}

bool input_poll(void)
{
    bool changed = false;
    int x = 0, y = 0;

    if (s_last_active == 0) {
        s_last_active = xTaskGetTickCount();
    }

    bool down = board_touch_read(&x, &y);
    if (down && !s_touch_down) {
        if (!board_screen_is_on()) {
            // 熄屏后的第一下只负责点亮，不送进游戏，避免黑屏误触走错格
            ESP_LOGI(TAG, "触摸唤醒 (%d,%d)", x, y);
            input_note_activity();
        } else {
            ESP_LOGD(TAG, "触摸 (%d,%d)", x, y);
            game_tap(x, y);
            input_note_activity();
        }
        changed = true;
    }
    s_touch_down = down;

    // Key3：熄屏时先唤醒；结算页重开，其他时候切换静音
    bool key = board_key_pressed();
    if (key && !s_key_down) {
        if (!board_screen_is_on()) {
            input_note_activity();
        } else if (game_ended()) {
            ESP_LOGI(TAG, "Key3 重开一局");
            game_restart();
        } else {
            bool muted = audio_toggle_mute();
            ESP_LOGI(TAG, "Key3 静音=%d", muted);
        }
        changed = true;
    }
    s_key_down = key;

    // 空闲熄屏：屏幕内容会留在帧缓冲里，唤醒后直接恢复，不需要重绘
    if (board_screen_is_on() &&
        (xTaskGetTickCount() - s_last_active) * portTICK_PERIOD_MS > SCREEN_IDLE_MS) {
        ESP_LOGI(TAG, "空闲 %d 秒，熄屏", SCREEN_IDLE_MS / 1000);
        board_screen(false);
    }

    return changed;
}
