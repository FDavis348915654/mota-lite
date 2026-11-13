// input.h —— 输入轮询
// Created by Davis

#pragma once

#include <stdbool.h>

// 轮询一次输入，返回 true 表示游戏状态发生了变化（需要重绘）
bool input_poll(void);
