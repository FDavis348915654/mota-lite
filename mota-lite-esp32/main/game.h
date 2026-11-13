// game.h —— 游戏主体：QuickJS 里的 logic.js + C 侧渲染。
//
// 状态（state）始终是 JS 对象，由 logic.js 的纯函数产新对象替换；
// C 侧只在需要画的时候把 HUD 与该层地图字符拉出来。
//
// Created by Davis

#pragma once

#include <stdbool.h>
#include <stdint.h>

// 启动 QuickJS、加载 logic_bundle、开新游戏
void game_init(void);

// 重开一局
void game_new(void);

// 走一步。dir: 0=上 1=右 2=下 3=左
void game_step(int dir);

// 把当前状态画进 framebuffer
void game_render(void);

// 屏幕坐标 -> 地图格；越界返回 false
bool game_screen_to_tile(int px, int py, int *col, int *row);

// 点击某一格：相邻则直接走，远则先记为目标（M1 暂只做相邻）
void game_tap_tile(int col, int row);

// 最近一条消息（"前方是墙" 之类），无消息返回 NULL
const char *game_message(void);

// 当前层号（0 基）
int game_floor(void);

// 内存自检信息，供启动日志与 stats 用
void game_dump_stats(void);

// 存档（串行化字符串），M1 先只做内存往返，M2 接 NVS
const char *game_serialize(void);
bool game_deserialize(const char *text);
