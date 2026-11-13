// 自动生成：地图字符 -> 精灵帧号。勿手改。
// Created by Davis

#pragma once
#include <stdint.h>

#include "sprites.h"

#define TILEMAP_COUNT 43

extern const int16_t g_tilemap_keys[TILEMAP_COUNT];
extern const int16_t g_tilemap_spr[TILEMAP_COUNT];

// 字符取精灵帧号，未映射返回 SPR_NONE
int tile_sprite(int chr);
// 出生点等特殊格：字符不变但用 floor 帧
int tile_sprite_or_fallback(int chr);
