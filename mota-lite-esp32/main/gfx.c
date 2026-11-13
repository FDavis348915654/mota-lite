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
#include "font20.h"
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
        int adv = font_advance(cp);
        if (adv <= 0) {
            adv = FONT_PX / 2;  // 缺字留半个字宽
        }
        if (cx + adv > x + limit + 2) {
            break;
        }

        const uint32_t *glyph = font_glyph(cp);
        if (!glyph) {
            cx += adv;
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
        cx += adv;
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
        int a = font_advance(cp);
        w += a > 0 ? a : FONT_PX / 2;
    }
    return w;
}

// 测量 [a, b) 这段 UTF-8 的像素宽
static int text_width_n(const char *a, const char *b)
{
    int w = 0;
    const char *p = a;
    while (p < b) {
        uint32_t cp = 0;
        int n = gfx_utf8_next(p, &cp);
        int a = font_advance(cp);
        w += a > 0 ? a : FONT_PX / 2;
        p += n;
    }
    return w;
}

// 从 p 开始按宽度取一行，返回行尾指针；has_more 表示后面还有内容
// 中文行首禁则：这些标点不能出现在行首，宁可让它悬在上一行行尾
static bool closing_punct(uint32_t cp)
{
    switch (cp) {
    case 0xFF0C:  // ，
    case 0x3002:  // 。
    case 0x3001:  // 、
    case 0xFF01:  // ！
    case 0xFF1F:  // ？
    case 0xFF1A:  // ：
    case 0xFF1B:  // ；
    case 0xFF09:  // ）
    case 0x300D:  // 」
    case 0x300F:  // 』
    case 0x3011:  // 】
    case 0x300B:  // 》
    case 0x201D:  // ”
    case 0x2019:  // ’
        return true;
    default:
        return false;
    }
}

static const char *wrap_line_end(const char *p, int limit, bool *has_more)
{
    int w = 0;
    const char *last = p;
    while (*p) {
        if (*p == '\n') {
            *has_more = p[1] != '\0';
            return p;
        }
        uint32_t cp = 0;
        int n = gfx_utf8_next(p, &cp);
        int cw = font_advance(cp);
        if (cw <= 0) {
            cw = FONT_PX / 2;
        }
        if (w + cw > limit) {
            if (w > 0 && closing_punct(cp)) {
                // 标点悬尾：超出 limit 一点，但不另起一行
                w += cw;
                p += n;
                last = p;
                continue;
            }
            *has_more = true;
            return last;
        }
        w += cw;
        p += n;
        last = p;
    }
    *has_more = false;
    return p;
}

int gfx_text_wrap(int x, int y, const char *utf8, uint16_t color,
                  int max_w, int line_h, int max_lines)
{
    if (!s_fb || !utf8 || max_lines <= 0) {
        return 0;
    }
    const int limit = max_w <= 0 ? SCR_W : max_w;
    const char *p = utf8;
    int line = 0;

    while (*p && line < max_lines) {
        if (*p == '\n') {
            p++;
            line++;
            continue;
        }
        bool more = false;
        const char *end = wrap_line_end(p, limit, &more);

        // 最后一行的溢出内容用 "..." 提示，先按三字符宽度回退
        bool ellipsis = more && (line == max_lines - 1);
        if (ellipsis) {
            int reserve = 3 * (FONT_PX / 2);
            while (end > p && text_width_n(p, end) + reserve > limit) {
                const char *q = end - 1;
                while (q > p && ((*q & 0xC0) == 0x80)) {
                    q--;
                }
                end = q;
            }
        }

        char buf[192];
        size_t n = (size_t)(end - p);
        if (n >= sizeof(buf)) {
            n = sizeof(buf) - 1;
        }
        memcpy(buf, p, n);
        buf[n] = '\0';
        gfx_text(x, y + line * line_h, buf, color, limit);
        if (ellipsis) {
            gfx_text(x + text_width_n(p, end), y + line * line_h, "...", color, 3 * (FONT_PX / 2));
        }

        line++;
        p = end;
        if (*p == '\n') {
            p++;
        }
    }
    return line;
}

void gfx_text_center(int cx, int y, const char *utf8, uint16_t color)
{
    int w = gfx_text_width(utf8);
    gfx_text(cx - w / 2, y, utf8, color, SCR_W);
}

// ---------------- 20px ASCII ----------------

int gfx_text20(int x, int y, const char *ascii, uint16_t color, int max_w)
{
    if (!s_fb || !ascii) {
        return 0;
    }
    const int limit = max_w <= 0 ? SCR_W : max_w;
    int cx = x;
    for (const unsigned char *p = (const unsigned char *)ascii; *p; p++) {
        if (*p == '\n') {
            break;
        }
        if (cx + FONT20_PX > x + limit) {
            break;
        }
        const uint32_t *glyph = font20_glyph(*p);
        if (!glyph) {
            cx += FONT20_PX / 2;
            continue;
        }
        int adv = font20_advance(*p);
        if (adv <= 0) {
            adv = FONT20_PX / 2;
        }
        if (cx + adv > x + limit + 2) {
            break;
        }
        for (int gy = 0; gy < FONT20_PX; gy++) {
            uint32_t bits = glyph[gy];
            int sy = y + gy;
            if (sy < 0 || sy >= SCR_H || !bits) {
                continue;
            }
            for (int gx = 0; gx < FONT20_PX; gx++) {
                if (!(bits & (1u << (FONT20_PX - 1 - gx)))) {
                    continue;
                }
                int sx = cx + gx;
                if (sx < 0 || sx >= SCR_W) {
                    continue;
                }
                s_fb[sy * SCR_W + sx] = color;
            }
        }
        cx += adv;
    }
    return cx - x;
}

int gfx_text20_width(const char *ascii)
{
    if (!ascii) {
        return 0;
    }
    int w = 0;
    for (const unsigned char *p = (const unsigned char *)ascii; *p; p++) {
        if (*p == '\n') {
            break;
        }
        int adv = font20_advance(*p);
        w += adv > 0 ? adv : FONT20_PX / 2;
    }
    return w;
}
