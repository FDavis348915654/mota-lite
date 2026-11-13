// input.h —— 输入轮询
// Created by Davis

#pragma once

#include <stdbool.h>

// 轮询一次输入，返回 true 表示游戏状态发生了变化（需要重绘）
bool input_poll(void);

// 记一次「有人动过」：刷新空闲计时，必要时点亮屏幕。
// 供串口诊断注入点击时复用，避免自动化操作被空闲熄屏打断。
void input_note_activity(void);
