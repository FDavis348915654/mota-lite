// 自动生成，勿手改。来源 mota-lite-web/assets/sprites.{png,json}
// Created by Davis

#pragma once
#include <stdint.h>

// 帧号常量（SPR_WALL 等），供渲染层与 tilemap.c 使用
#include "sprite_index.h"

#define SPRITE_TILE   28
#define SPRITE_COUNT  46
#define SPRITE_PIXELS (28 * 28)
#define SPRITE_ALPHA_BYTES 98

typedef struct { const char *name; uint16_t index; } sprite_named_t;

extern const uint16_t g_sprite_pixels[SPRITE_COUNT * SPRITE_PIXELS];
extern const uint8_t  g_sprite_alpha[SPRITE_COUNT * SPRITE_ALPHA_BYTES];
extern const sprite_named_t g_sprite_names[SPRITE_COUNT];

// 按名字取帧号，未找到返回 -1
int sprite_find(const char *name);
