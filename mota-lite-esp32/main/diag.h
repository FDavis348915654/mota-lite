// diag.h —— USB 串口诊断命令（截图 / 点击注入 / 状态），用于无实物时验收 UI。
// Created by Davis

#pragma once

#include <stdbool.h>

// 安装 USB Serial JTAG 驱动并启动命令任务。必须在 gfx/game 初始化之后调用。
void diag_init(void);

// 主循环取一条待处理的点击；有则返回 true 并填坐标。
bool diag_take_tap(int *x, int *y);

// 主循环取一次「重开」请求。
bool diag_take_restart(void);

// 截图期间主循环应暂停渲染，避免抓到半帧
bool diag_capture_locked(void);

// 主循环取一条待载入的存档串（JS 只能在主循环线程调用）
bool diag_take_load(char *buf, int n);
