// 自动生成，勿手改。24x24 点阵字库（simhei 渲染，基线对齐）。
// Created by Davis

#pragma once
#include <stdint.h>

#define FONT_PX      24
#define FONT_STRIDE  96
#define FONT_COUNT   3890

// 取字形位图：24 个 uint32，每个 bit23..bit0 对应 x0..x23；缺字返回 0
const uint32_t *font_glyph(uint32_t codepoint);

// 字形是否存在（缺字返回 0）
int font_width(uint32_t codepoint);

// 推进宽度：汉字 24，ASCII 按墨迹宽度 +2
int font_advance(uint32_t codepoint);
