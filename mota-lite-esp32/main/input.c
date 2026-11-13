// input.c —— 触摸与按键输入。
// 触摸按「按下沿」触发，避免按住不放连续走格。
// Created by Davis

#include "input.h"

#include "esp_log.h"

#include "board.h"
#include "game.h"
#include "gfx.h"

static const char *TAG = "input";

static bool s_touch_down = false;
static bool s_key_down = false;

bool input_poll(void)
{
    bool changed = false;
    int x = 0, y = 0;

    bool down = board_touch_read(&x, &y);
    if (down && !s_touch_down) {
        int col = 0, row = 0;
        bool in_map = game_screen_to_tile(x, y, &col, &row);
        // 触摸链路自检：坐标 -> 格子，确认 swap_xy/mirror 配置是否正确
        if (in_map) {
            ESP_LOGI(TAG, "触摸 (%d,%d) -> 格(%d,%d)", x, y, col, row);
            game_tap_tile(col, row);
            changed = true;
        } else {
            ESP_LOGI(TAG, "触摸 (%d,%d) 落在地图区之外", x, y);
        }
    }
    s_touch_down = down;

    // M1 用板载 Key3 重开一局，方便反复试
    bool key = board_key_pressed();
    if (key && !s_key_down) {
        ESP_LOGI(TAG, "Key3 按下，重开一局");
        game_new();
        changed = true;
    }
    s_key_down = key;

    return changed;
}
