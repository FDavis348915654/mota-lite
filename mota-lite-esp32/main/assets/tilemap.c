// 自动生成，勿手改。
// Created by Davis

#include "tilemap.h"
#include "sprites.h"

const int16_t g_tilemap_keys[TILEMAP_COUNT] = {
    35,46,49,50,51,52,53,54,55,56,64,65,66,67,68,69,70,71,72,73,77,78,80,82,83,84,85,87,88,89,90,97,98,100,101,103,106,111,112,113,114,115,121,
};

const int16_t g_tilemap_spr[TILEMAP_COUNT] = {
    0,1,20,21,22,23,24,25,26,27,1,0,5,42,29,36,18,7,32,33,34,31,12,6,16,35,28,30,40,4,39,13,9,14,41,17,37,19,11,38,10,15,8,
};

int tile_sprite(int chr)
{
    int lo = 0, hi = TILEMAP_COUNT - 1;
    while (lo <= hi) {
        int mid = (lo + hi) >> 1;
        if (g_tilemap_keys[mid] == chr) return g_tilemap_spr[mid];
        if (g_tilemap_keys[mid] < chr) lo = mid + 1; else hi = mid - 1;
    }
    return SPR_NONE;
}

int tile_sprite_or_fallback(int chr)
{
    int s = tile_sprite(chr);
    return s == SPR_NONE ? SPR_FLOOR : s;
}
