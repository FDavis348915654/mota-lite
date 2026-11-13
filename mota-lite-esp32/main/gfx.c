// gfx.c —— 480x480 RGB565 软件渲染层实现。
//
// 帧缓冲放 PSRAM：480*480*2 = 450 KB，内部 RAM 装不下也没必要。
// 精灵来自 assets/sprites.c（46 帧 28x28，RGB565 + 1bit alpha 位流）。
// 文字来自 assets/font24.c（24x24 点阵，每行一个 uint32）。
//
// Created by Davis

#include "gfx.h"

#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"

#include "font24.h"
#include "sprites.h"

static const char *TAG = "gfx";

static uint16_t *s_fb = NULL;

void gfx_init(void)
{
    if (s_fb) {
        return;
    }
    // 整屏缓冲放 PSRAM；QSPI 屏异步 DMA 需要能访问的连续内存
    s_fb = heap_caps_malloc(SCR_W * SCR_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_fb) {
        ESP_LOGE(TAG, "帧缓冲分配失败，需要 %d 字节 PSRAM", SCR_W * SCR_H * 2);
        return;
    }
    gfx_clear(COL_BG);
    ESP_LOGI(TAG, "帧缓冲就绪 %dx%d @ %p", SCR_W, SCR_H, s_fb);
}

uint16_t *gfx_fb(void)
{
    return s_fb;
}

void gfx_pixel(int x, int y, uint16_t c)
{
    if (!s_fb || x < 0 || y < 0 || x >= SCR_W || y >= SCR_H) {
        return;
    }
    s_fb[y * SCR_W + x] = c;
}

void gfx_fill(int x, int y, int w, int h, uint16_t c)
{
    if (!s_fb) {
        return;
    }
    int x0 = x < 0 ? 0 : x;
    int y0 = y < 0 ? 0 : y;
    int x1 = x + w > SCR_W ? SCR_W : x + w;
    int y1 = y + h > SCR_H ? SCR_H : y + h;
    if (x0 >= x1 || y0 >= y1) {
        return;
    }
    for (int yy = y0; yy < y1; yy++) {
        uint16_t *row = s_fb + yy * SCR_W;
        for (int xx = x0; xx < x1; xx++) {
            row[xx] = c;
        }
    }
}

void gfx_clear(uint16_t color)
{
    gfx_fill(0, 0, SCR_W, SCR_H, color);
}

void gfx_rect(int x, int y, int w, int h, uint16_t c)
{
    gfx_fill(x, y, w, 1, c);
    gfx_fill(x, y + h - 1, w, 1, c);
    gfx_fill(x, y, 1, h, c);
    gfx_fill(x + w - 1, y, 1, h, c);
}

void gfx_sprite(int x, int y, int sprite_index)
{
    if (!s_fb || sprite_index < 0 || sprite_index >= SPRITE_COUNT) {
        return;
    }
    if (x + SPRITE_TILE <= 0 || y + SPRITE_TILE <= 0 || x >= SCR_W || y >= SCR_H) {
        return;
    }

    const uint16_t *src = g_sprite_pixels + sprite_index * SPRITE_PIXELS;
    const uint8_t *mask = g_sprite_alpha + sprite_index * SPRITE_ALPHA_BYTES;

    for (int ty = 0; ty < SPRITE_TILE; ty++) {
        int sy = y + ty;
        if (sy < 0 || sy >= SCR_H) {
            continue;
        }
        uint16_t *dst = s_fb + sy * SCR_W;
        for (int tx = 0; tx < SPRITE_TILE; tx++) {
            int sx = x + tx;
            if (sx < 0 || sx >= SCR_W) {
                continue;
            }
            // alpha 是连续位流（跨行不断字节对齐）：像素序号 = ty*28+tx
            int pix = ty * SPRITE_TILE + tx;
            if (!((mask[pix >> 3] >> (7 - (pix & 7))) & 1)) {
                continue;
            }
            dst[sx] = src[pix];
        }
    }
}

int gfx_utf8_next(const char *s, uint32_t *cp)
{
    const unsigned char *p = (const unsigned char *)s;
    if (p[0] < 0x80) {
        *cp = p[0];
        return 1;
    }
    if ((p[0] & 0xE0) == 0xC0 && (p[1] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(p[0] & 0x1F) << 6) | (p[1] & 0x3F);
        return 2;
    }
    if ((p[0] & 0xF0) == 0xE0 && (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(p[0] & 0x0F) << 12) | ((uint32_t)(p[1] & 0x3F) << 6) | (p[2] & 0x3F);
        return 3;
    }
    if ((p[0] & 0xF8) == 0xF0 && (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80 && (p[3] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(p[0] & 0x07) << 18) | ((uint32_t)(p[1] & 0x3F) << 12) |
              ((uint32_t)(p[2] & 0x3F) << 6) | (p[3] & 0x3F);
        return 4;
    }
    *cp = 0xFFFD;
    return 1;
}

int gfx_text(int x, int y, const char *utf8, uint16_t color, int max_w)
{
    if (!s_fb || !utf8) {
        return 0;
    }
    int limit = max_w <= 0 ? SCR_W : max_w;
    int cx = x;
    const char *p = utf8;

    while (*p) {
        uint32_t cp = 0;
        int n = gfx_utf8_next(p, &cp);
        p += n;

        if (cp == '\n') {
            break;
        }
        if (cx + FONT_PX > x + limit) {
            break;
        }

        const uint32_t *glyph = font_glyph(cp);
        if (!glyph) {
            cx += FONT_PX / 2;  // 缺字留半个字宽，避免整句挤成一坨
            continue;
        }

        for (int gy = 0; gy < FONT_PX; gy++) {
            uint32_t bits = glyph[gy];
            int sy = y + gy;
            if (sy < 0 || sy >= SCR_H) {
                continue;
            }
            if (!bits) {
                continue;
            }
            for (int gx = 0; gx < FONT_PX; gx++) {
                if (!(bits & (1u << (FONT_PX - 1 - gx)))) {
                    continue;
                }
                int sx = cx + gx;
                if (sx < 0 || sx >= SCR_W) {
                    continue;
                }
                s_fb[sy * SCR_W + sx] = color;
            }
        }
        cx += FONT_PX;
    }
    return cx - x;
}

int gfx_text_width(const char *utf8)
{
    if (!utf8) {
        return 0;
    }
    int w = 0;
    const char *p = utf8;
    while (*p) {
        uint32_t cp = 0;
        p += gfx_utf8_next(p, &cp);
        w += font_width(cp) ? FONT_PX : FONT_PX / 2;
    }
    return w;
}

void gfx_text_center(int cx, int y, const char *utf8, uint16_t color)
{
    int w = gfx_text_width(utf8);
    gfx_text(cx - w / 2, y, utf8, color, SCR_W);
}
