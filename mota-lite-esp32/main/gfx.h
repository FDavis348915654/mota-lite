// gfx.h —— 480x480 RGB565 软件渲染层。
// 不依赖 LVGL：魔塔是回合制，一次操作全屏重绘 450KB 也就二十几毫秒，够用。
// Created by Davis

#pragma once

#include <stdint.h>

#define SCR_W 480
#define SCR_H 480

// RGB565 打包。
// CO5300 走 QSPI 时按「高字节先收」处理，而 ESP32 是小端存放 uint16_t，
// 不做字节交换的话 0x1082 会被读成 0x8210，屏幕上出现偏紫粉的错色。
// 所以统一在写入帧缓冲前交换一次，屏端直接发即可。
static inline uint16_t rgb565_pack(int r, int g, int b)
{
    uint16_t v = (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
    return (uint16_t)((v >> 8) | (v << 8));
}
#define RGB565(r, g, b) rgb565_pack(r, g, b)

// 配色：低饱和冷灰蓝，贴合魔塔的石塔气质；AMOLED 上深底更省电
#define COL_BG        RGB565(0x14, 0x14, 0x1C)
#define COL_FLOOR     RGB565(0x2A, 0x2A, 0x38)
#define COL_WALL      RGB565(0x46, 0x46, 0x60)
#define COL_PANEL     RGB565(0x1C, 0x1C, 0x26)
#define COL_BORDER    RGB565(0x3A, 0x3A, 0x50)
#define COL_TEXT      RGB565(0xD8, 0xD8, 0xE4)
#define COL_TEXT_DIM  RGB565(0x88, 0x88, 0xA0)
#define COL_HP        RGB565(0xD0, 0x60, 0x60)
#define COL_ATK       RGB565(0xD0, 0x98, 0x50)
#define COL_DEF       RGB565(0x60, 0x98, 0xC8)
#define COL_GOLD      RGB565(0xD8, 0xB8, 0x50)
#define COL_KEY_Y     RGB565(0xC8, 0xB0, 0x40)
#define COL_KEY_B     RGB565(0x50, 0x80, 0xC0)
#define COL_KEY_R     RGB565(0xC0, 0x50, 0x50)
#define COL_HILITE    RGB565(0x30, 0x50, 0x70)
#define COL_OK        RGB565(0x60, 0xC0, 0x90)
#define COL_ROW       RGB565(0x24, 0x24, 0x32)
#define COL_BTN       RGB565(0x26, 0x26, 0x36)
#define COL_END_DEAD  RGB565(0x2A, 0x08, 0x0C)
#define COL_END_WIN   RGB565(0x08, 0x24, 0x16)

// 布局（与 480x480 方案一致）
#define MAP_COLS      13
#define MAP_ROWS      15
#define TILE_PX       28
#define MAP_W         (MAP_COLS * TILE_PX)   // 364
#define MAP_H         (MAP_ROWS * TILE_PX)   // 420
#define SIDE_X        MAP_W                  // 364
#define SIDE_W        (SCR_W - MAP_W)        // 116
#define BAR_Y         MAP_H                  // 420
#define BAR_H         (SCR_H - MAP_H)        // 60

void gfx_init(void);

// 帧缓冲首地址，交给 esp_lcd_panel_draw_bitmap 整屏推送
uint16_t *gfx_fb(void);

void gfx_clear(uint16_t color);
void gfx_pixel(int x, int y, uint16_t c);
void gfx_fill(int x, int y, int w, int h, uint16_t c);
void gfx_rect(int x, int y, int w, int h, uint16_t c);

// 画 28x28 精灵帧，alpha=0 的像素跳过
void gfx_sprite(int x, int y, int sprite_index);

// UTF-8 文本，返回实际绘制宽度；超过 max_w 停止（不换行）
int gfx_text(int x, int y, const char *utf8, uint16_t color, int max_w);

// 自动折行：按字符断行（英文也不拆词），最多 max_lines 行，剩余内容以 "..." 收尾。
// 返回实际绘制行数。
int gfx_text_wrap(int x, int y, const char *utf8, uint16_t color,
                  int max_w, int line_h, int max_lines);

// 20px ASCII，用于 HUD 数值与伤害飘字（24px 中文在侧栏放不下 4 位数）
int gfx_text20(int x, int y, const char *ascii, uint16_t color, int max_w);
int gfx_text20_width(const char *ascii);

// 单行居中
void gfx_text_center(int cx, int y, const char *utf8, uint16_t color);

// 测量 UTF-8 字符串像素宽
int gfx_text_width(const char *utf8);

// 解码一个 UTF-8 字符，返回消耗字节数；非法返回 1 且 *cp = 0xFFFD
int gfx_utf8_next(const char *s, uint32_t *cp);
