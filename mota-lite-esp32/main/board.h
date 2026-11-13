// board.h —— 板级抽象：屏、触摸、按键。
// 具体实现放 board.c，这里只暴露游戏层需要的三件事，避免游戏逻辑沾到 BSP 细节。
// Created by Davis

#pragma once

#include <stdbool.h>
#include <stdint.h>

// 初始化 BSP（电源 AXP2101、QSPI 屏、触摸、背光）
void board_init(void);

// 读一次触摸。有按下返回 true 并填屏幕坐标（0..479）
bool board_touch_read(int *x, int *y);

// 把整屏 RGB565 推给面板
void board_flush(const uint16_t *fb);

// 物理按键（GPIO18），按下返回 true
bool board_key_pressed(void);
