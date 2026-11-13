// 自动生成，勿手改。20x20 ASCII 点阵（simhei 渲染）。
// 用途：HUD 数值与伤害飘字，24px 中文放不下的地方。
// Created by Davis

#pragma once
#include <stdint.h>

#define FONT20_PX     20
#define FONT20_COUNT  95

// 取字形位图：20 个 uint32；缺字返回 0
const uint32_t *font20_glyph(uint32_t codepoint);

// 变宽推进：数字/字母按实际墨迹宽度 + 3px
int font20_advance(uint32_t codepoint);
