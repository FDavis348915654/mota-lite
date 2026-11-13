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
static int s_touch_x = 0, s_touch_y = 0;
static int s_press_x = 0, s_press_y = 0;   // 按下点，用来判断是否算一次点击
static bool s_woke = false;                // 这一下只用于唤醒，抬起时不再触发操作

// 抬手与按下点的允许偏移：约 3.4mm，抖动不会误触，滑动则算拖拽
#define TAP_SLOP 16
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
    if (down) {
        s_touch_x = x;
        s_touch_y = y;
    }
    if (down && !s_touch_down) {
        // 按下：只记录起点并给反馈，不产生操作（对齐 web 的 pointerdown / :active）
        s_press_x = x;
        s_press_y = y;
        s_woke = false;
        input_note_activity();
        if (!board_screen_is_on()) {
            // 熄屏后的第一下只负责点亮，抬起时也不触发操作，避免黑屏误触走错格
            ESP_LOGI(TAG, "触摸唤醒 (%d,%d)", x, y);
            s_woke = true;
        }
        game_touch_state(x, y, true);
        changed = true;
    } else if (!down && s_touch_down) {
        // 抬起：位移在阈值内才算点击（对齐 web 的 click）
        game_touch_state(s_touch_x, s_touch_y, false);
        int dx = s_touch_x - s_press_x;
        int dy = s_touch_y - s_press_y;
        if (dx < 0) {
            dx = -dx;
        }
        if (dy < 0) {
            dy = -dy;
        }
        if (!s_woke && dx <= TAP_SLOP && dy <= TAP_SLOP) {
            ESP_LOGD(TAG, "点击 (%d,%d) 偏移 %d,%d", s_touch_x, s_touch_y, dx, dy);
            game_tap(s_touch_x, s_touch_y);
        }
        s_woke = false;
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
