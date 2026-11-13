// audio.h —— ES8311 + I2S 音效播放。
//
// 12 段 PCM 由 tools/export_assets.py 从 assets/audio/*.wav 转成 C 数组
// （22050Hz / 16bit / 单声道），播放走独立任务，不阻塞渲染与输入。
//
// Created by Davis

#pragma once

#include <stdbool.h>

// 初始化 I2S + ES8311。失败只打日志，游戏照常运行（静音）。
void audio_init(void);

// 按名字播一段音效（见 sfx.h 的 g_sfx），重名取第一个。未找到或静音时忽略。
void audio_play(const char *name);

// 切换静音，返回切换后的状态（true = 已静音）
bool audio_toggle_mute(void);

bool audio_muted(void);
