// 自动生成，勿手改。22050Hz / 16bit / mono PCM。
// Created by Davis

#pragma once
#include <stdint.h>

#define SFX_RATE 22050
#define SFX_COUNT 12

typedef struct { const char *name; const int16_t *data; uint32_t samples; } sfx_t;
extern const sfx_t g_sfx[SFX_COUNT];

// 按名字取音效，未找到返回 -1
int sfx_find(const char *name);
