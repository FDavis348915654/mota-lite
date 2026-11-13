// game.c —— QuickJS 承载 logic.js，C 侧负责渲染、输入、动画与弹层。
//
// 与 web 版对齐的行为（2026-11-14 重做）：
//   * 点远处格子 = 逐格行走（150ms/步），不是瞬移
//   * 战斗有 460ms 动画：保留战前网格、英雄冲刺、命中特效、-NHP 飘字
//   * 动作栏 7 项：升层/降层/炸弹/购买/图鉴/新游戏/设置（炸弹与购买按 flags 解锁）
//   * 剧情弹层：序章、首次进层、暗格/暗门/飞行器/老者/封印门/小精灵/法师/盗贼/通关/阵亡
//   * 底栏提示常驻到下一次操作，不再 3 秒消失
//   * 步数、经验、通关记录（NVS）
//
// Created by Davis

#include "game.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "quickjs.h"

#include "audio.h"
#include "font24.h"
#include "gfx.h"
#include "sprites.h"
#include "tilemap.h"

static const char *TAG = "game";

extern const uint8_t bundle_start[] asm("_binary_logic_bundle_js_start");
extern const uint8_t bundle_end[] asm("_binary_logic_bundle_js_end");

#define GRID_COLS 13
#define GRID_ROWS 15

#define NVS_NAMESPACE "mota"
#define NVS_KEY_SAVE  "save"
#define NVS_KEY_BEST  "rbest"
#define NVS_KEY_WINS  "rwins"
#define NVS_KEY_MIN   "rmin"

// ---- 布局（480x480：7x9 地图视口 + 186px 侧栏 + 102px 底栏）----
#define HUD_X         (SIDE_X + 4)     // 298
#define HUD_R         (SCR_W - 26)     // 454 圆角安全线：实测 476 处会被切
#define HUD_W         (HUD_R - HUD_X)  // 156
#define BTN_X0        (SIDE_X + 4)     // 298
#define BTN_W         ((HUD_W - 6) / 2) // 75
#define BTN_H         52
#define BTN_GAP_X     6
#define BTN_GAP_Y     6
#define BTN_Y0        150
#define BTN_COLS      2

// ---- 覆盖层 ----
#define OV_X 24
#define OV_Y 48
#define OV_W 432
#define OV_H 384
#define ROW_X 44
#define ROW_W 392
#define ROW_H 46
#define ROW_Y0 112

// ---- 时序 ----
#define STEP_MS 150
#define ANIM_MS 460
#define ANIM_FRAME_MS 40
#define ANIM_DASH_MS 170

// hero.flags 位（与 logic.js FLAG 一致）
#define FLAG_SHOP_SEEN   1
#define FLAG_BOMB_UNLOCK 2
#define FLAG_MAGE_FREED  16
#define FLAG_CORE_HELD   128
#define FLAG_FAY_CHARGED 256

enum { ACT_FLYUP = 0, ACT_FLYDN, ACT_BOMB, ACT_SHOP, ACT_CODEX, ACT_NEWGAME, ACT_SETTINGS, ACT_COUNT };

typedef struct {
    int floor, x, y;
    int hp, atk, def, gold, exp;
    int key_y, key_b, key_r;
    int fly, bomb, book;
    int flags;
    int ended;
} hud_t;

typedef struct {
    char kind[12];
    char label[24];
} good_t;

typedef struct {
    char label[24];
    char effect[24];
    char cost[20];
    bool affordable;
} menu_row_t;

typedef enum { OV_NONE = 0, OV_STORY, OV_SHOP, OV_MAGE, OV_CODEX, OV_SETTINGS, OV_CONFIRM } ov_kind_t;

typedef struct {
    ov_kind_t kind;
    char title[64];
    char body[640];
    int rows;
    menu_row_t row[6];
    int confirm_action;
} overlay_t;

typedef struct {
    char name[24];
    int hp, atk, def;
    int alive;
    int hpCost;
    int reason;
    bool ok;
} codex_row_t;

typedef struct {
    bool active;
    TickType_t start;
    int from_x, from_y, to_x, to_y;
    int dmg;
    char grid[GRID_ROWS][GRID_COLS + 1];
} anim_t;

static JSRuntime *s_rt = NULL;
static JSContext *s_ctx = NULL;
static JSValue s_logic = {0};
static JSValue s_state = {0};
static JSValue s_fn_new = {0};
static JSValue s_fn_step = {0};
static JSValue s_fn_floor = {0};
static JSValue s_fn_ser = {0};
static JSValue s_fn_deser = {0};
static JSValue s_fn_hint = {0};
static JSValue s_fn_mon = {0};
static JSValue s_fn_scaled = {0};
static JSValue s_fn_fly = {0};
static JSValue s_fn_bomb = {0};
static JSValue s_fn_shop_offer = {0};
static JSValue s_fn_shop_buy = {0};
static JSValue s_fn_mage_buy = {0};
static JSValue s_fn_hidden = {0};
static JSValue s_fn_secret = {0};
static JSValue s_fn_thief = {0};
static JSValue s_story_obj = {0};

static hud_t s_hud;
static char s_grid[GRID_ROWS][GRID_COLS + 1];
static char s_msg[256];
static char s_act_text[320];

static bool s_dirty_save = false;
static bool s_dirty_frame = false;
static bool s_anim_on = true;
static int s_hero_frame = 0;
static int s_steps = 0;
static bool s_win_counted = false;

static TickType_t s_flash_until = 0;
static bool s_flash_was = false;

static overlay_t s_ov;
static anim_t s_anim;

static int8_t s_path[256];
static int s_path_n = 0;
static int s_path_i = 0;
static TickType_t s_next_step = 0;
static struct {
    bool active;
    int x, y;
    TickType_t at;
} s_pending;

// 卷轴相机：像素级平滑跟随，目标由英雄位置决定并夹在塔边界内
static int s_cam_px = 0, s_cam_py = 0;
static int s_cam_tx = 0, s_cam_ty = 0;
static int s_cam_floor = -1;      // -1 表示下一帧强制对齐（换层/读档/新局）

// 选中格：点过的格子留一个框，直到下一次操作（对应 web 的点击反馈）
static int s_sel_c = -1, s_sel_r = -1;

// 按钮按下态：触发后 180ms 内高亮，对应 web 的 .action-btn:active
static int s_btn_hot = -1;
static TickType_t s_btn_hot_until = 0;

// 当前按下点（只用于按钮的"按住"高亮，不再画圆圈）
static struct {
    bool down;
    int x, y;
} s_touch;

// 刚点过的按钮矩形：抬手后保持 260ms 高亮，快速轻点也看得见
static int s_hot_x, s_hot_y, s_hot_w, s_hot_h;
static TickType_t s_hot_until = 0;
static bool s_hot_valid = false;

static good_t s_shop_goods[6];
static int s_shop_n = 0;
static good_t s_mage_goods[4];
static int s_mage_n = 0;
static int s_exp_cost = 30;

static codex_row_t s_codex[6];
static int s_codex_n = 0;

static int s_rec_best = 1, s_rec_wins = 0, s_rec_min = 0;

#define STORY_QMAX 10
#define STORY_SEEN_MAX 64
static char s_story_q[STORY_QMAX][24];
static int s_story_qn = 0;
static char s_story_seen[STORY_SEEN_MAX][24];
static int s_story_seen_n = 0;

// 前置声明（相互引用）
static void stop_auto(void);
static void show_next_story(void);
static void queue_story(const char *key);
static void step_once(int dir);
static void open_shop(void);
static void open_mage(void);

// ---------------- 基础 ----------------

static void mark_dirty(void) { s_dirty_frame = true; }

// ---- 按钮交互：按住即亮，抬手后保持 260ms ----
static bool rect_has(int x, int y, int w, int h, int px, int py)
{
    return px >= x && px < x + w && py >= y && py < y + h;
}

static void flash_btn(int x, int y, int w, int h)
{
    s_hot_x = x;
    s_hot_y = y;
    s_hot_w = w;
    s_hot_h = h;
    s_hot_until = xTaskGetTickCount() + pdMS_TO_TICKS(260);
    s_hot_valid = true;
}

// 这个矩形当前是否该画成"按下"
static bool btn_hot(int x, int y, int w, int h)
{
    if (s_touch.down && rect_has(x, y, w, h, s_touch.x, s_touch.y)) {
        return true;
    }
    if (!s_hot_valid || xTaskGetTickCount() >= s_hot_until) {
        return false;
    }
    return s_hot_x == x && s_hot_y == y && s_hot_w == w && s_hot_h == h;
}

// 画一块按钮底板，按住/刚点过时高亮
static void draw_btn(int x, int y, int w, int h, uint16_t border)
{
    bool hot = btn_hot(x, y, w, h);
    gfx_fill(x, y, w, h, hot ? COL_HILITE : COL_BTN);
    gfx_rect(x, y, w, h, hot ? COL_TEXT : border);
}

// 列表行底板（商店/法师/设置），同样有按下态
static void draw_row(int x, int y, int w, int h)
{
    gfx_fill(x, y, w, h, btn_hot(x, y, w, h) ? COL_HILITE : COL_ROW);
}

static void set_msg(const char *text)
{
    snprintf(s_msg, sizeof(s_msg), "%s", text ? text : "");
}

static void act_text_append(const char *text)
{
    if (!text || !text[0]) {
        return;
    }
    size_t used = strlen(s_act_text);
    if (used + 1 >= sizeof(s_act_text)) {
        return;
    }
    if (used) {
        s_act_text[used++] = ' ';
        s_act_text[used] = '\0';
    }
    snprintf(s_act_text + used, sizeof(s_act_text) - used, "%s", text);
}

// ---------------- JS 辅助 ----------------

static void js_dump_error(const char *where)
{
    JSValue e = JS_GetException(s_ctx);
    const char *s = JS_ToCString(s_ctx, e);
    ESP_LOGE(TAG, "%s: %s", where, s ? s : "(no message)");
    if (s) {
        JS_FreeCString(s_ctx, s);
    }
    JS_FreeValue(s_ctx, e);
}

static int js_get_int(JSValue obj, const char *name)
{
    if (!JS_IsObject(obj)) {
        return 0;
    }
    JSValue v = JS_GetPropertyStr(s_ctx, obj, name);
    int32_t n = 0;
    JS_ToInt32(s_ctx, &n, v);
    JS_FreeValue(s_ctx, v);
    return n;
}

static void read_hud(void)
{
    s_hud.floor = js_get_int(s_state, "floor");
    s_hud.x = js_get_int(s_state, "x");
    s_hud.y = js_get_int(s_state, "y");

    JSValue hero = JS_GetPropertyStr(s_ctx, s_state, "hero");
    s_hud.hp = js_get_int(hero, "hp");
    s_hud.atk = js_get_int(hero, "atk");
    s_hud.def = js_get_int(hero, "def");
    s_hud.gold = js_get_int(hero, "gold");
    s_hud.exp = js_get_int(hero, "exp");
    s_hud.fly = js_get_int(hero, "fly");
    s_hud.bomb = js_get_int(hero, "bomb");
    s_hud.book = js_get_int(hero, "book");
    s_hud.flags = js_get_int(hero, "flags");

    JSValue keys = JS_GetPropertyStr(s_ctx, hero, "keys");
    s_hud.key_y = js_get_int(keys, "y");
    s_hud.key_b = js_get_int(keys, "b");
    s_hud.key_r = js_get_int(keys, "r");
    JS_FreeValue(s_ctx, keys);
    JS_FreeValue(s_ctx, hero);

    JSValue ended = JS_GetPropertyStr(s_ctx, s_state, "ended");
    if (JS_IsNull(ended) || JS_IsUndefined(ended)) {
        s_hud.ended = 0;
    } else {
        const char *e = JS_ToCString(s_ctx, ended);
        s_hud.ended = 0;
        if (e) {
            if (strcmp(e, "dead") == 0) {
                s_hud.ended = 1;
            } else if (strcmp(e, "win") == 0) {
                s_hud.ended = 2;
            }
            JS_FreeCString(s_ctx, e);
        }
    }
    JS_FreeValue(s_ctx, ended);
}

static void read_grid(void)
{
    JSValue args[1] = {s_state};
    JSValue v = JS_Call(s_ctx, s_fn_floor, s_logic, 1, args);
    if (JS_IsException(v)) {
        js_dump_error("floorString");
        return;
    }
    const char *s = JS_ToCString(s_ctx, v);
    if (!s) {
        JS_FreeValue(s_ctx, v);
        return;
    }

    memset(s_grid, 0, sizeof(s_grid));
    int row = 0, col = 0;
    for (const char *p = s; *p && row < GRID_ROWS; p++) {
        if (*p == '\n') {
            s_grid[row][col] = '\0';
            row++;
            col = 0;
            continue;
        }
        if (col < GRID_COLS) {
            s_grid[row][col++] = *p;
        }
    }
    if (row < GRID_ROWS && col > 0) {
        s_grid[row][col] = '\0';
    }

    JS_FreeCString(s_ctx, s);
    JS_FreeValue(s_ctx, v);
}

static void load_goods_array(const char *name, good_t *out, int *n, int max)
{
    *n = 0;
    JSValue arr = JS_GetPropertyStr(s_ctx, s_logic, name);
    if (!JS_IsArray(arr)) {
        JS_FreeValue(s_ctx, arr);
        return;
    }
    JSValue lenv = JS_GetPropertyStr(s_ctx, arr, "length");
    uint32_t len = 0;
    JS_ToUint32(s_ctx, &len, lenv);
    JS_FreeValue(s_ctx, lenv);

    for (uint32_t i = 0; i < len && *n < max; i++) {
        JSValue o = JS_GetPropertyUint32(s_ctx, arr, i);
        JSValue kv = JS_GetPropertyStr(s_ctx, o, "kind");
        JSValue lv = JS_GetPropertyStr(s_ctx, o, "label");
        const char *k = JS_ToCString(s_ctx, kv);
        const char *l = JS_ToCString(s_ctx, lv);
        snprintf(out[*n].kind, sizeof(out[*n].kind), "%s", k ? k : "atk");
        snprintf(out[*n].label, sizeof(out[*n].label), "%s", l ? l : "?");
        if (k) {
            JS_FreeCString(s_ctx, k);
        }
        if (l) {
            JS_FreeCString(s_ctx, l);
        }
        JS_FreeValue(s_ctx, kv);
        JS_FreeValue(s_ctx, lv);
        JS_FreeValue(s_ctx, o);
        (*n)++;
    }
    JS_FreeValue(s_ctx, arr);
}

// ---------------- 剧情 ----------------

static bool story_seen(const char *key)
{
    for (int i = 0; i < s_story_seen_n; i++) {
        if (strcmp(s_story_seen[i], key) == 0) {
            return true;
        }
    }
    return false;
}

static void story_mark(const char *key)
{
    if (s_story_seen_n >= STORY_SEEN_MAX || story_seen(key)) {
        return;
    }
    snprintf(s_story_seen[s_story_seen_n++], sizeof(s_story_seen[0]), "%s", key);
}

static bool story_text(const char *key)
{
    if (!s_ctx || !JS_IsObject(s_story_obj)) {
        return false;
    }
    JSValue item = JS_GetPropertyStr(s_ctx, s_story_obj, key);
    if (!JS_IsObject(item)) {
        JS_FreeValue(s_ctx, item);
        return false;
    }
    JSValue tv = JS_GetPropertyStr(s_ctx, item, "title");
    JSValue bv = JS_GetPropertyStr(s_ctx, item, "body");
    const char *t = JS_ToCString(s_ctx, tv);
    const char *b = JS_ToCString(s_ctx, bv);
    snprintf(s_ov.title, sizeof(s_ov.title), "%s", t ? t : "");
    snprintf(s_ov.body, sizeof(s_ov.body), "%s", b ? b : "");
    s_ov.rows = 0;
    if (t) {
        JS_FreeCString(s_ctx, t);
    }
    if (b) {
        JS_FreeCString(s_ctx, b);
    }
    JS_FreeValue(s_ctx, tv);
    JS_FreeValue(s_ctx, bv);
    JS_FreeValue(s_ctx, item);
    return s_ov.title[0] != '\0';
}

static void show_next_story(void)
{
    if (s_ov.kind != OV_NONE || s_anim.active || s_story_qn <= 0) {
        return;
    }
    char key[24];
    snprintf(key, sizeof(key), "%s", s_story_q[0]);
    for (int i = 1; i < s_story_qn; i++) {
        memcpy(s_story_q[i - 1], s_story_q[i], sizeof(s_story_q[0]));
    }
    s_story_qn--;

    if (!story_text(key)) {
        show_next_story();
        return;
    }
    s_ov.kind = OV_STORY;
    audio_play("story");
    mark_dirty();
}

static void queue_story(const char *key)
{
    if (!key || !key[0] || story_seen(key)) {
        return;
    }
    story_mark(key);
    if (s_story_qn < STORY_QMAX) {
        snprintf(s_story_q[s_story_qn++], sizeof(s_story_q[0]), "%s", key);
    }
    if (s_ov.kind == OV_NONE && !s_anim.active) {
        show_next_story();
    }
}

static void queue_floor_story(void)
{
    if (!s_ctx) {
        return;
    }
    JSValue floors = JS_GetPropertyStr(s_ctx, s_logic, "FLOORS");
    JSValue f = JS_GetPropertyUint32(s_ctx, floors, s_hud.floor);
    JSValue sv = JS_GetPropertyStr(s_ctx, f, "story");
    const char *k = JS_ToCString(s_ctx, sv);
    if (k) {
        queue_story(k);
        JS_FreeCString(s_ctx, k);
    }
    JS_FreeValue(s_ctx, sv);
    JS_FreeValue(s_ctx, f);
    JS_FreeValue(s_ctx, floors);
}

static void queue_hidden_story(char ch, int x, int y)
{
    JSValue fn = (ch == 'H') ? s_fn_hidden : s_fn_secret;
    if (!JS_IsObject(fn)) {
        return;
    }
    JSValue args[3] = {JS_NewInt32(s_ctx, s_hud.floor), JS_NewInt32(s_ctx, x), JS_NewInt32(s_ctx, y)};
    JSValue o = JS_Call(s_ctx, fn, s_logic, 3, args);
    for (int i = 0; i < 3; i++) {
        JS_FreeValue(s_ctx, args[i]);
    }
    if (!JS_IsException(o) && JS_IsObject(o)) {
        JSValue sv = JS_GetPropertyStr(s_ctx, o, "story");
        const char *k = JS_ToCString(s_ctx, sv);
        if (k) {
            queue_story(k);
            JS_FreeCString(s_ctx, k);
        }
        JS_FreeValue(s_ctx, sv);
    }
    JS_FreeValue(s_ctx, o);
}

static int js_thief_stage(void)
{
    if (!JS_IsObject(s_fn_thief) || !JS_IsObject(s_state)) {
        return 0;
    }
    JSValue hero = JS_GetPropertyStr(s_ctx, s_state, "hero");
    JSValue v = JS_Call(s_ctx, s_fn_thief, s_logic, 1, &hero);
    JS_FreeValue(s_ctx, hero);
    if (JS_IsException(v)) {
        return 0;
    }
    int32_t n = 0;
    JS_ToInt32(s_ctx, &n, v);
    JS_FreeValue(s_ctx, v);
    return n;
}

// ---------------- 事件 ----------------

static void handle_events(JSValue events)
{
    uint32_t n = 0;
    JSValue len = JS_GetPropertyStr(s_ctx, events, "length");
    JS_ToUint32(s_ctx, &n, len);
    JS_FreeValue(s_ctx, len);

    for (uint32_t i = 0; i < n; i++) {
        JSValue e = JS_GetPropertyUint32(s_ctx, events, i);
        JSValue tv = JS_GetPropertyStr(s_ctx, e, "t");
        const char *type = JS_ToCString(s_ctx, tv);

        if (type && strcmp(type, "msg") == 0) {
            JSValue xv = JS_GetPropertyStr(s_ctx, e, "text");
            const char *text = JS_ToCString(s_ctx, xv);
            if (text) {
                set_msg(text);
                act_text_append(text);
                JS_FreeCString(s_ctx, text);
            }
            JS_FreeValue(s_ctx, xv);
        } else if (type && strcmp(type, "save") == 0) {
            s_dirty_save = true;
        } else if (type && strcmp(type, "vibrate") == 0) {
            s_flash_until = xTaskGetTickCount() + pdMS_TO_TICKS(110);
        }

        if (type) {
            JS_FreeCString(s_ctx, type);
        }
        JS_FreeValue(s_ctx, tv);
        JS_FreeValue(s_ctx, e);
    }
}

// ---------------- 存档与记录 ----------------

static void save_to_nvs(void)
{
    const char *text = game_serialize();
    if (!text || !text[0]) {
        return;
    }
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK) {
        ESP_LOGW(TAG, "打开 NVS 失败，存档未落盘");
        return;
    }
    esp_err_t err = nvs_set_str(h, NVS_KEY_SAVE, text);
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    ESP_LOGI(TAG, "存档 %s（%d 字节，第%d层 %d,%d）", err == ESP_OK ? "OK" : "失败",
             (int)strlen(text), s_hud.floor + 1, s_hud.x, s_hud.y);
}

static void clear_save(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_key(h, NVS_KEY_SAVE);
        nvs_commit(h);
        nvs_close(h);
    }
}

static bool load_from_nvs(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) {
        return false;
    }
    size_t len = 0;
    if (nvs_get_str(h, NVS_KEY_SAVE, NULL, &len) != ESP_OK || len == 0 || len > 8192) {
        nvs_close(h);
        return false;
    }
    char *buf = malloc(len);
    if (!buf) {
        nvs_close(h);
        return false;
    }
    bool ok = false;
    if (nvs_get_str(h, NVS_KEY_SAVE, buf, &len) == ESP_OK) {
        ok = game_deserialize(buf);
    }
    free(buf);
    nvs_close(h);
    return ok;
}

static void records_load(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) {
        return;
    }
    uint8_t b = 1;
    uint16_t w = 0, m = 0;
    nvs_get_u8(h, NVS_KEY_BEST, &b);
    nvs_get_u16(h, NVS_KEY_WINS, &w);
    nvs_get_u16(h, NVS_KEY_MIN, &m);
    nvs_close(h);
    s_rec_best = b < 1 ? 1 : b;
    s_rec_wins = w;
    s_rec_min = m;
}

static void records_save(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK) {
        return;
    }
    nvs_set_u8(h, NVS_KEY_BEST, (uint8_t)(s_rec_best > 255 ? 255 : s_rec_best));
    nvs_set_u16(h, NVS_KEY_WINS, (uint16_t)(s_rec_wins > 65535 ? 65535 : s_rec_wins));
    nvs_set_u16(h, NVS_KEY_MIN, (uint16_t)(s_rec_min > 65535 ? 65535 : s_rec_min));
    nvs_commit(h);
    nvs_close(h);
}

static void records_update(void)
{
    bool changed = false;
    if (s_hud.floor + 1 > s_rec_best) {
        s_rec_best = s_hud.floor + 1;
        changed = true;
    }
    if (s_hud.ended == 2 && !s_win_counted) {
        s_win_counted = true;
        s_rec_wins++;
        if (s_rec_min == 0 || s_steps < s_rec_min) {
            s_rec_min = s_steps;
        }
        changed = true;
    }
    if (changed) {
        records_save();
    }
}

// ---------------- 生命周期 ----------------

static void sprite_info_init(void);

void game_init(void)
{
    sprite_info_init();
    s_rt = JS_NewRuntime();
    if (!s_rt) {
        ESP_LOGE(TAG, "JS_NewRuntime 失败");
        return;
    }
    JS_SetMemoryLimit(s_rt, 8 * 1024 * 1024);
    JS_SetMaxStackSize(s_rt, 128 * 1024);

    s_ctx = JS_NewContext(s_rt);
    if (!s_ctx) {
        ESP_LOGE(TAG, "JS_NewContext 失败");
        return;
    }

    size_t len = (size_t)(bundle_end - bundle_start);
    if (len == 0) {
        ESP_LOGE(TAG, "逻辑包为空");
        return;
    }
    len--;

    JSValue r = JS_Eval(s_ctx, (const char *)bundle_start, len, "logic_bundle.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) {
        js_dump_error("eval bundle");
        return;
    }
    JS_FreeValue(s_ctx, r);

    JSValue global = JS_GetGlobalObject(s_ctx);
    s_logic = JS_GetPropertyStr(s_ctx, global, "MotaLogic");
    JS_FreeValue(s_ctx, global);
    if (!JS_IsObject(s_logic)) {
        ESP_LOGE(TAG, "全局没有 MotaLogic");
        return;
    }

    s_fn_new = JS_GetPropertyStr(s_ctx, s_logic, "newGame");
    s_fn_step = JS_GetPropertyStr(s_ctx, s_logic, "stepByIndex");
    s_fn_floor = JS_GetPropertyStr(s_ctx, s_logic, "floorString");
    s_fn_ser = JS_GetPropertyStr(s_ctx, s_logic, "serialize");
    s_fn_deser = JS_GetPropertyStr(s_ctx, s_logic, "deserialize");
    s_fn_hint = JS_GetPropertyStr(s_ctx, s_logic, "battleHint");
    s_fn_mon = JS_GetPropertyStr(s_ctx, s_logic, "monsterByCh");
    s_fn_scaled = JS_GetPropertyStr(s_ctx, s_logic, "scaledMon");
    s_fn_fly = JS_GetPropertyStr(s_ctx, s_logic, "useFly");
    s_fn_bomb = JS_GetPropertyStr(s_ctx, s_logic, "useBomb");
    s_fn_shop_offer = JS_GetPropertyStr(s_ctx, s_logic, "shopOffer");
    s_fn_shop_buy = JS_GetPropertyStr(s_ctx, s_logic, "shopBuy");
    s_fn_mage_buy = JS_GetPropertyStr(s_ctx, s_logic, "mageBuy");
    s_fn_hidden = JS_GetPropertyStr(s_ctx, s_logic, "hiddenAt");
    s_fn_secret = JS_GetPropertyStr(s_ctx, s_logic, "secretAt");
    s_fn_thief = JS_GetPropertyStr(s_ctx, s_logic, "thiefStage");

    JSValue texts = JS_GetPropertyStr(s_ctx, s_logic, "TEXTS");
    s_story_obj = JS_GetPropertyStr(s_ctx, texts, "story");
    JS_FreeValue(s_ctx, texts);

    load_goods_array("SHOP_GOODS", s_shop_goods, &s_shop_n, 6);
    load_goods_array("MAGE_GOODS", s_mage_goods, &s_mage_n, 4);
    JSValue cfg = JS_GetPropertyStr(s_ctx, s_logic, "CONFIG");
    s_exp_cost = js_get_int(cfg, "EXP_COST");
    JS_FreeValue(s_ctx, cfg);

    records_load();

    ESP_LOGI(TAG, "QuickJS 就绪，逻辑包 %d 字节；商品 %d / 法师 %d；记录 最高%dF 通关%d次",
             (int)len, s_shop_n, s_mage_n, s_rec_best, s_rec_wins);

    if (load_from_nvs()) {
        ESP_LOGI(TAG, "读档成功：第%d层 (%d,%d) HP=%d", s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp);
    } else {
        ESP_LOGI(TAG, "无可用存档，开新局");
        game_new();
    }
    queue_story("intro");
}

void game_new(void)
{
    if (!s_ctx || !JS_IsObject(s_logic)) {
        return;
    }
    JSValue st = JS_Call(s_ctx, s_fn_new, s_logic, 0, NULL);
    if (JS_IsException(st)) {
        js_dump_error("newGame");
        return;
    }
    JS_FreeValue(s_ctx, s_state);
    s_state = st;

    s_ov.kind = OV_NONE;
    s_anim.active = false;
    s_story_qn = 0;
    stop_auto();
    s_hero_frame = 0;
    s_steps = 0;
    s_win_counted = false;
    s_msg[0] = '\0';
    set_msg("点格子开始爬塔");

    read_hud();
    read_grid();
    s_cam_floor = -1;   // 强制相机重新对齐
    s_sel_c = s_sel_r = -1;
    mark_dirty();

    ESP_LOGI(TAG, "首局 第%d层 (%d,%d) HP=%d ATK=%d DEF=%d",
             s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp, s_hud.atk, s_hud.def);
}

void game_restart(void)
{
    ESP_LOGI(TAG, "重开一局（清档），原进度：第%d层 (%d,%d) HP=%d",
             s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp);
    clear_save();
    game_new();
    audio_play("click");
}

static bool apply_result(JSValue r, const char *where)
{
    if (JS_IsException(r)) {
        js_dump_error(where);
        return false;
    }
    JSValue next = JS_GetPropertyStr(s_ctx, r, "state");
    if (JS_IsObject(next)) {
        JS_FreeValue(s_ctx, s_state);
        s_state = next;
    } else {
        JS_FreeValue(s_ctx, next);
    }

    JSValue ev = JS_GetPropertyStr(s_ctx, r, "events");
    handle_events(ev);
    JS_FreeValue(s_ctx, ev);
    JS_FreeValue(s_ctx, r);

    read_hud();
    return true;
}

static const char *pick_sfx(const char *t)
{
    if (!t || !t[0]) {
        return NULL;
    }
    if (strstr(t, "发现隐藏") || strstr(t, "撞开暗门")) {
        return "hidden";
    }
    if (strstr(t, "通关")) {
        return "win";
    }
    if (strstr(t, "阵亡")) {
        return "lose";
    }
    if (strstr(t, "胜 ")) {
        return "battle_hit";
    }
    if (strstr(t, "门已打开") || strstr(t, "进入 ")) {
        return "door";
    }
    if (strstr(t, "获得 ") || strstr(t, "已救出")) {
        return "pickup";
    }
    if (strstr(t, "缺少") || strstr(t, "攻击不足") || strstr(t, "硬拼") ||
        strstr(t, "走不过去") || strstr(t, "没有") || strstr(t, "不能") ||
        strstr(t, "不可达") || strstr(t, "是墙")) {
        return "click";
    }
    return "footstep";
}

// ---------------- 商店 / 法师 / 图鉴 ----------------

static void build_shop_rows(void)
{
    s_ov.rows = 0;
    for (int i = 0; i < s_shop_n; i++) {
        JSValue args[2] = {
            JS_NewString(s_ctx, s_shop_goods[i].kind),
            JS_NewInt32(s_ctx, s_hud.floor),
        };
        JSValue o = JS_Call(s_ctx, s_fn_shop_offer, s_logic, 2, args);
        JS_FreeValue(s_ctx, args[0]);
        JS_FreeValue(s_ctx, args[1]);
        if (JS_IsException(o)) {
            js_dump_error("shopOffer");
            continue;
        }

        int amount = js_get_int(o, "amount");
        int cost = js_get_int(o, "cost");
        JSValue lv = JS_GetPropertyStr(s_ctx, o, "label");
        const char *l = JS_ToCString(s_ctx, lv);

        menu_row_t *r = &s_ov.row[s_ov.rows];
        snprintf(r->label, sizeof(r->label), "%s", l ? l : s_shop_goods[i].label);
        snprintf(r->effect, sizeof(r->effect), "+%d", amount);
        snprintf(r->cost, sizeof(r->cost), "%dG", cost);

        bool unlocked = true;
        if (strcmp(s_shop_goods[i].kind, "bomb") == 0) {
            unlocked = (s_hud.flags & FLAG_BOMB_UNLOCK) != 0;
        }
        r->affordable = unlocked && s_hud.gold >= cost;
        if (!unlocked) {
            snprintf(r->cost, sizeof(r->cost), "未解锁");
        }

        if (l) {
            JS_FreeCString(s_ctx, l);
        }
        JS_FreeValue(s_ctx, lv);
        JS_FreeValue(s_ctx, o);
        s_ov.rows++;
    }
}

static void open_shop(void)
{
    build_shop_rows();
    snprintf(s_ov.title, sizeof(s_ov.title), "商人");
    s_ov.kind = OV_SHOP;
    audio_play("click");
    mark_dirty();
}

static void open_mage(void)
{
    s_ov.rows = 0;
    JSValue arr = JS_GetPropertyStr(s_ctx, s_logic, "MAGE_GOODS");
    for (int i = 0; i < s_mage_n; i++) {
        JSValue o = JS_GetPropertyUint32(s_ctx, arr, i);
        int amount = js_get_int(o, "amount");
        JS_FreeValue(s_ctx, o);

        menu_row_t *r = &s_ov.row[s_ov.rows++];
        snprintf(r->label, sizeof(r->label), "%s", s_mage_goods[i].label);
        snprintf(r->effect, sizeof(r->effect), "+%d", amount);
        snprintf(r->cost, sizeof(r->cost), "%dEXP", s_exp_cost);
        r->affordable = s_hud.exp >= s_exp_cost;
    }
    JS_FreeValue(s_ctx, arr);

    snprintf(s_ov.title, sizeof(s_ov.title), "法师");
    s_ov.kind = OV_MAGE;
    audio_play("click");
    mark_dirty();
}

static void build_codex(void)
{
    s_codex_n = 0;
    // seen 只记怪物字符：1F 有十几种道具/NPC，若先记它们会把 6 个名额占满
    char seen[6] = {0};
    int seen_n = 0;

    for (int y = 0; y < GRID_ROWS; y++) {
        for (int x = 0; x < GRID_COLS; x++) {
            char ch = s_grid[y][x];
            if (!ch || ch == '.' || ch == '#' || ch == '@') {
                continue;
            }
            bool dup = false;
            for (int i = 0; i < seen_n; i++) {
                if (seen[i] == ch) {
                    dup = true;
                    break;
                }
            }
            if (dup) {
                continue;
            }

            JSValue chv = JS_NewStringLen(s_ctx, &ch, 1);
            JSValue mon = JS_Call(s_ctx, s_fn_mon, s_logic, 1, &chv);
            JS_FreeValue(s_ctx, chv);
            if (JS_IsException(mon) || !JS_IsObject(mon)) {
                if (JS_IsException(mon)) {
                    js_dump_error("monsterByCh");
                }
                JS_FreeValue(s_ctx, mon);
                continue;
            }
            if (seen_n >= 6) {
                JS_FreeValue(s_ctx, mon);
                continue;
            }
            seen[seen_n++] = ch;

            codex_row_t *row = &s_codex[s_codex_n];
            memset(row, 0, sizeof(*row));

            JSValue nv = JS_GetPropertyStr(s_ctx, mon, "name");
            const char *nm = JS_ToCString(s_ctx, nv);
            snprintf(row->name, sizeof(row->name), "%s", nm ? nm : "?");
            if (nm) {
                JS_FreeCString(s_ctx, nm);
            }
            JS_FreeValue(s_ctx, nv);

            JSValue sargs[2] = {mon, JS_NewInt32(s_ctx, s_hud.floor)};
            JSValue sc = JS_Call(s_ctx, s_fn_scaled, s_logic, 2, sargs);
            JS_FreeValue(s_ctx, sargs[1]);
            if (!JS_IsException(sc) && JS_IsObject(sc)) {
                row->hp = js_get_int(sc, "hp");
                row->atk = js_get_int(sc, "atk");
                row->def = js_get_int(sc, "def");
            }
            JS_FreeValue(s_ctx, sc);

            JSValue hero = JS_GetPropertyStr(s_ctx, s_state, "hero");
            JSValue hargs[3] = {hero, mon, JS_NewInt32(s_ctx, s_hud.floor)};
            JSValue hint = JS_Call(s_ctx, s_fn_hint, s_logic, 3, hargs);
            JS_FreeValue(s_ctx, hargs[2]);
            JS_FreeValue(s_ctx, hero);
            if (!JS_IsException(hint) && JS_IsObject(hint)) {
                JSValue rv = JS_GetPropertyStr(s_ctx, hint, "r");
                row->hpCost = js_get_int(rv, "hpCost");
                JSValue okv = JS_GetPropertyStr(s_ctx, rv, "ok");
                row->ok = JS_ToBool(s_ctx, okv) != 0;
                JS_FreeValue(s_ctx, okv);

                JSValue reason = JS_GetPropertyStr(s_ctx, rv, "reason");
                const char *rs = JS_ToCString(s_ctx, reason);
                row->reason = 0;
                if (rs) {
                    if (strcmp(rs, "shield") == 0) {
                        row->reason = 1;
                    } else if (strcmp(rs, "unbreakable") == 0) {
                        row->reason = 2;
                    } else if (strcmp(rs, "lethal") == 0) {
                        row->reason = 3;
                    }
                    JS_FreeCString(s_ctx, rs);
                }
                JS_FreeValue(s_ctx, reason);
                JS_FreeValue(s_ctx, rv);
            }
            JS_FreeValue(s_ctx, hint);

            int alive = 0;
            for (int yy = 0; yy < GRID_ROWS; yy++) {
                for (int xx = 0; xx < GRID_COLS; xx++) {
                    if (s_grid[yy][xx] == ch) {
                        alive++;
                    }
                }
            }
            row->alive = alive;

            JS_FreeValue(s_ctx, mon);
            s_codex_n++;
        }
    }
}

static void open_codex(void)
{
    build_codex();
    snprintf(s_ov.title, sizeof(s_ov.title), "怪物图鉴");
    s_ov.kind = OV_CODEX;
    audio_play("click");
    mark_dirty();
}

// ---------------- 动作 ----------------

static void stop_auto(void)
{
    s_path_n = s_path_i = 0;
    s_pending.active = false;
}

static int parse_battle_dmg(const char *t)
{
    const char *p = strstr(t, "胜 ");
    if (!p) {
        return 0;
    }
    const char *d = strchr(p, '-');
    return d ? atoi(d + 1) : 0;
}

static bool tile_open(char c)
{
    return c == '.' || c == '@' || c == 'H' || c == 'U' || c == 'D' || c == 'W';
}

static void after_action(char target, int tx, int ty, int flags_before, int thief_before,
                         int floor_before, bool moved)
{
    bool is_vendor = (target == 'N') || (target == 'M' && (s_hud.flags & FLAG_MAGE_FREED));
    const char *sfx = is_vendor ? NULL : pick_sfx(s_act_text);
    if (sfx && strcmp(sfx, "pickup") == 0 && target && strchr("FosSadC", target)) {
        sfx = "powerup";
    }
    if (sfx) {
        audio_play(sfx);
    } else if (!is_vendor && moved) {
        audio_play("footstep");  // 纯移动：web 的 pickSfx 默认 step
    }

    if (target == 'H') {
        queue_hidden_story('H', tx, ty);
    } else if (target == 'A') {
        queue_hidden_story('A', tx, ty);
    } else if (target == 'F') {
        queue_story("fly");
    } else if (target == 'E') {
        queue_story("elder");
    } else if (target == 'j') {
        queue_story("lockpick");
    } else if (target == 'q') {
        queue_story("moneybag");
    } else if (target == 'Z') {
        queue_story("sealed_door");
    } else if (target == 'X') {
        queue_story("elite_hint");
    } else if (target == 'C') {
        queue_story("core_hint");
    } else if (target == 'e') {
        bool charged = (s_hud.flags & FLAG_FAY_CHARGED) != 0;
        bool had_core = (flags_before & FLAG_CORE_HELD) != 0;
        if (charged && had_core) {
            queue_story("fairy_charge");
        } else if (charged) {
            queue_story("fairy_done");
        } else {
            queue_story("fairy_intro");
        }
    }

    if (target == 'M') {
        if (flags_before & FLAG_MAGE_FREED) {
            open_mage();
        } else {
            queue_story("mage_free");
        }
    }

    if (target == 'T') {
        int stB = thief_before;
        int stA = js_thief_stage();
        if (stB == 0 && stA == 1) {
            queue_story("thief_free");
        } else if (stB == 1 && stA == 2) {
            queue_story("thief_door");
        } else if (stB == 2 && stA == 3) {
            queue_story("thief_leave");
        } else if (stA == 1) {
            queue_story("thief_task1");
        } else if (stA == 2) {
            queue_story("thief_task2");
        }
    }

    if (s_hud.floor != floor_before) {
        queue_floor_story();
    }
    if (s_hud.ended == 2) {
        queue_story("win");
    } else if (s_hud.ended == 1) {
        queue_story("lose");
    }

    records_update();

    if (target == 'N') {
        open_shop();
    }

    if (!s_act_text[0]) {
        bool secret = false;
        static const int dx[4] = {0, 1, 0, -1};
        static const int dy[4] = {-1, 0, 1, 0};
        for (int d = 0; d < 4; d++) {
            int nx = s_hud.x + dx[d], ny = s_hud.y + dy[d];
            if (nx >= 0 && ny >= 0 && nx < GRID_COLS && ny < GRID_ROWS && s_grid[ny][nx] == 'A') {
                secret = true;
                break;
            }
        }
        if (secret) {
            set_msg("这面墙似乎有点异样…（点它撞一下）");
        } else if (moved) {
            set_msg("走一格");
        }
    }
}

static void step_once(int dir)
{
    if (!s_ctx || s_anim.active || s_ov.kind != OV_NONE || s_hud.ended) {
        return;
    }

    static const int dx[4] = {0, 1, 0, -1};
    static const int dy[4] = {-1, 0, 1, 0};
    int tx = s_hud.x + dx[dir];
    int ty = s_hud.y + dy[dir];
    char target = 0;
    if (tx >= 0 && ty >= 0 && tx < GRID_COLS && ty < GRID_ROWS) {
        target = s_grid[ty][tx];
    }

    int ox = s_hud.x, oy = s_hud.y, ofloor = s_hud.floor;
    int flags_before = s_hud.flags;
    int thief_before = js_thief_stage();

    char old_grid[GRID_ROWS][GRID_COLS + 1];
    memcpy(old_grid, s_grid, sizeof(s_grid));

    s_act_text[0] = '\0';
    s_steps++;

    JSValue args[2] = {s_state, JS_NewInt32(s_ctx, dir)};
    JSValue r = JS_Call(s_ctx, s_fn_step, s_logic, 2, args);
    JS_FreeValue(s_ctx, args[1]);
    if (!apply_result(r, "stepByIndex")) {
        return;
    }

    bool moved = (s_hud.x != ox || s_hud.y != oy || s_hud.floor != ofloor);
    if (moved) {
        s_hero_frame ^= 1;
    }

    bool battle = target && strstr(s_act_text, "胜 ") != NULL;
    if (battle && s_anim_on) {
        memcpy(s_anim.grid, old_grid, sizeof(old_grid));
        s_anim.active = true;
        s_anim.start = xTaskGetTickCount();
        s_anim.from_x = ox;
        s_anim.from_y = oy;
        s_anim.to_x = tx;
        s_anim.to_y = ty;
        s_anim.dmg = parse_battle_dmg(s_act_text);
        ESP_LOGD(TAG, "战斗动画 目标(%d,%d) 伤害%d", tx, ty, s_anim.dmg);
    } else {
        read_grid();
    }

    after_action(target, tx, ty, flags_before, thief_before, ofloor, moved);

    if (!s_anim.active) {
        show_next_story();
    }
    mark_dirty();
}

void game_step(int dir)
{
    step_once(dir);
}

static void act_fly(int delta)
{
    if (!s_ctx) {
        return;
    }
    int floor_before = s_hud.floor;
    s_act_text[0] = '\0';
    JSValue args[2] = {s_state, JS_NewInt32(s_ctx, delta)};
    JSValue r = JS_Call(s_ctx, s_fn_fly, s_logic, 2, args);
    JS_FreeValue(s_ctx, args[1]);
    if (!apply_result(r, "useFly")) {
        return;
    }
    read_grid();
    bool ok = strstr(s_act_text, "没有") == NULL && strstr(s_act_text, "只能") == NULL;
    audio_play(ok ? "door" : "click");
    // 只有真的换了层才放楼层剧情；否则每按一次升降层都会把当前层介绍重播一遍
    if (s_hud.floor != floor_before) {
        queue_floor_story();
        show_next_story();
    }
    mark_dirty();
}

static void act_bomb(void)
{
    if (!s_ctx) {
        return;
    }
    s_act_text[0] = '\0';
    JSValue args[1] = {s_state};
    JSValue r = JS_Call(s_ctx, s_fn_bomb, s_logic, 1, args);
    if (!apply_result(r, "useBomb")) {
        return;
    }
    read_grid();
    bool ok = strstr(s_act_text, "没有") == NULL && strstr(s_act_text, "范围") == NULL;
    audio_play(ok ? "bomb" : "click");
    show_next_story();
    mark_dirty();
}

static void buy_shop(int idx)
{
    if (idx < 0 || idx >= s_shop_n) {
        return;
    }
    char kind[12];
    snprintf(kind, sizeof(kind), "%s", s_shop_goods[idx].kind);

    s_act_text[0] = '\0';
    JSValue args[2] = {s_state, JS_NewString(s_ctx, kind)};
    JSValue r = JS_Call(s_ctx, s_fn_shop_buy, s_logic, 2, args);
    JS_FreeValue(s_ctx, args[1]);
    if (!apply_result(r, "shopBuy")) {
        return;
    }
    read_grid();
    bool ok = strstr(s_act_text, "成交") != NULL;
    audio_play(ok ? "powerup" : "click");
    build_shop_rows();
    mark_dirty();
}

static void buy_mage(int idx)
{
    if (idx < 0 || idx >= s_mage_n) {
        return;
    }
    char kind[12];
    snprintf(kind, sizeof(kind), "%s", s_mage_goods[idx].kind);

    s_act_text[0] = '\0';
    JSValue args[2] = {s_state, JS_NewString(s_ctx, kind)};
    JSValue r = JS_Call(s_ctx, s_fn_mage_buy, s_logic, 2, args);
    JS_FreeValue(s_ctx, args[1]);
    if (!apply_result(r, "mageBuy")) {
        return;
    }
    read_grid();
    bool ok = strstr(s_act_text, "施法") != NULL;
    audio_play(ok ? "powerup" : "click");
    for (int i = 0; i < s_ov.rows; i++) {
        s_ov.row[i].affordable = s_hud.exp >= s_exp_cost;
    }
    mark_dirty();
}

// ---------------- 寻路 ----------------

static int bfs_to(int tx, int ty, bool allow_entity_end, int8_t *out)
{
    static int16_t prev[GRID_ROWS][GRID_COLS];
    static int16_t q[GRID_ROWS * GRID_COLS];
    memset(prev, -1, sizeof(prev));

    int head = 0, tail = 0;
    prev[s_hud.y][s_hud.x] = -2;
    q[tail++] = (int16_t)(s_hud.y * GRID_COLS + s_hud.x);

    static const int dx[4] = {0, 1, 0, -1};
    static const int dy[4] = {-1, 0, 1, 0};
    bool found = false;

    while (head < tail) {
        int cur = q[head++];
        int cx = cur % GRID_COLS;
        int cy = cur / GRID_COLS;
        if (cx == tx && cy == ty) {
            found = true;
            break;
        }
        for (int d = 0; d < 4; d++) {
            int nx = cx + dx[d], ny = cy + dy[d];
            if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) {
                continue;
            }
            if (prev[ny][nx] != -1) {
                continue;
            }
            char c = s_grid[ny][nx];
            bool is_end = (nx == tx && ny == ty);
            if (c == '#' || c == 'A' || c == 0) {
                continue;
            }
            if (!(is_end && allow_entity_end) && !tile_open(c)) {
                continue;
            }
            prev[ny][nx] = (int16_t)cur;
            q[tail++] = (int16_t)(ny * GRID_COLS + nx);
        }
    }
    if (!found) {
        return 0;
    }

    int path[GRID_ROWS * GRID_COLS];
    int n = 0, cur = ty * GRID_COLS + tx;
    while (cur >= 0 && n < (int)(sizeof(path) / sizeof(path[0]))) {
        path[n++] = cur;
        int px = cur % GRID_COLS, py = cur / GRID_COLS;
        int p = prev[py][px];
        if (p == -2) {
            break;
        }
        cur = p;
    }

    // path[] 末尾会包含起点（prev == -2 时先 append 再 break），要跳过它
    int i = n - 1;
    if (i >= 0 && path[i] == s_hud.y * GRID_COLS + s_hud.x) {
        i--;
    }
    int m = 0, px = s_hud.x, py = s_hud.y;
    for (; i >= 0; i--) {
        int cx = path[i] % GRID_COLS, cy = path[i] / GRID_COLS;
        int ddx = cx - px, ddy = cy - py;
        int dir;
        if (ddy == -1 && ddx == 0) {
            dir = 0;
        } else if (ddx == 1 && ddy == 0) {
            dir = 1;
        } else if (ddy == 1 && ddx == 0) {
            dir = 2;
        } else if (ddx == -1 && ddy == 0) {
            dir = 3;
        } else {
            return 0;
        }
        out[m++] = (int8_t)dir;
        px = cx;
        py = cy;
    }
    return m;
}

static void start_path(const int8_t *dirs, int n, int pending_x, int pending_y)
{
    if (n <= 0 || n >= (int)sizeof(s_path)) {
        return;
    }
    memcpy(s_path, dirs, n);
    s_path_n = n;
    s_path_i = 0;
    s_next_step = xTaskGetTickCount() + pdMS_TO_TICKS(STEP_MS);
    s_pending.active = pending_x >= 0;
    s_pending.x = pending_x;
    s_pending.y = pending_y;
}

static void walk_to(int tx, int ty)
{
    if (tx == s_hud.x && ty == s_hud.y) {
        return;
    }
    if (tx < 0 || ty < 0 || tx >= GRID_COLS || ty >= GRID_ROWS) {
        return;
    }
    char target = s_grid[ty][tx];
    if (target == '#') {
        set_msg("那里是墙。");
        audio_play("click");
        mark_dirty();
        return;
    }
    if (target == 'A') {
        set_msg("这面墙似乎有点异样…（点它撞一下）");
        mark_dirty();
        return;
    }

    stop_auto();

    int adx = tx > s_hud.x ? tx - s_hud.x : s_hud.x - tx;
    int ady = ty > s_hud.y ? ty - s_hud.y : s_hud.y - ty;
    if (adx + ady == 1) {
        int dir = (ty < s_hud.y) ? 0 : (tx > s_hud.x) ? 1 : (ty > s_hud.y) ? 2 : 3;
        step_once(dir);
        return;
    }

    bool entity = !tile_open(target);
    ESP_LOGD(TAG, "walk_to (%d,%d) ch=%c entity=%d 起点(%d,%d)", tx, ty, target ? target : '?', entity, s_hud.x, s_hud.y);
    int8_t dirs[256];

    if (entity) {
        static const int nx4[4] = {0, 1, 0, -1};
        static const int ny4[4] = {-1, 0, 1, 0};
        int best_n = 0;
        int8_t best[256];
        for (int i = 0; i < 4; i++) {
            int ax = tx + nx4[i], ay = ty + ny4[i];
            if (ax < 0 || ay < 0 || ax >= GRID_COLS || ay >= GRID_ROWS) {
                continue;
            }
            if (!tile_open(s_grid[ay][ax])) {
                continue;
            }
            int n = bfs_to(ax, ay, false, dirs);
            ESP_LOGD(TAG, "  邻格 (%d,%d) ch=%c n=%d", ax, ay, s_grid[ay][ax], n);
            if (n > 0 && (best_n == 0 || n < best_n)) {
                best_n = n;
                memcpy(best, dirs, n);
            }
        }
        if (best_n > 0) {
            start_path(best, best_n, tx, ty);
            return;
        }
        int n = bfs_to(tx, ty, true, dirs);
        if (n > 0) {
            start_path(dirs, n, -1, -1);
            return;
        }
        set_msg("走不到它旁边（墙或挡路的门）。");
        audio_play("click");
        mark_dirty();
        return;
    }

    int n = bfs_to(tx, ty, false, dirs);
    if (n > 0) {
        start_path(dirs, n, -1, -1);
    } else {
        set_msg("目标格不可达（可能要先开门）。");
        audio_play("click");
        mark_dirty();
    }
}

// ---------------- 动作栏 ----------------

static int visible_actions(int *out)
{
    int n = 0;
    out[n++] = ACT_FLYUP;
    out[n++] = ACT_FLYDN;
    if (s_hud.flags & FLAG_BOMB_UNLOCK) {
        out[n++] = ACT_BOMB;
    }
    if (s_hud.flags & FLAG_SHOP_SEEN) {
        out[n++] = ACT_SHOP;
    }
    out[n++] = ACT_CODEX;
    out[n++] = ACT_NEWGAME;
    out[n++] = ACT_SETTINGS;
    return n;
}

static const char *act_label(int a)
{
    switch (a) {
    case ACT_FLYUP: return "升层";
    case ACT_FLYDN: return "降层";
    case ACT_BOMB: return "炸弹";
    case ACT_SHOP: return "购买";
    case ACT_CODEX: return "图鉴";
    case ACT_NEWGAME: return "新游";
    case ACT_SETTINGS: return "设置";
    default: return "";
    }
}

// 按钮矩形。idx 是「可见动作」里的下标，action 是动作本身。
// 「设置」独占最后一行整宽：它最常用又最容易点偏（原来只有 52x30，还贴底边 4px），
// 加宽后即使手指落在两列之间的缝隙里也能命中。
static void act_rect(int idx, int action, int total, int *x, int *y, int *w, int *h)
{
    *h = BTN_H;
    if (action == ACT_SETTINGS) {
        // 独占一行：放在其他按钮用完的行之后，否则会把同一行的「新游」整块盖住
        *x = BTN_X0;
        *y = BTN_Y0 + (total / BTN_COLS) * (BTN_H + BTN_GAP_Y);
        *w = BTN_W * 2 + BTN_GAP_X;
        return;
    }
    *x = BTN_X0 + (idx % BTN_COLS) * (BTN_W + BTN_GAP_X);
    *y = BTN_Y0 + (idx / BTN_COLS) * (BTN_H + BTN_GAP_Y);
    *w = BTN_W;
}

static void do_action(int a)
{
    s_btn_hot = a;
    s_btn_hot_until = xTaskGetTickCount() + pdMS_TO_TICKS(260);
    mark_dirty();
    switch (a) {
    case ACT_FLYUP:
        act_fly(1);
        break;
    case ACT_FLYDN:
        act_fly(-1);
        break;
    case ACT_BOMB:
        act_bomb();
        break;
    case ACT_SHOP:
        open_shop();
        break;
    case ACT_CODEX:
        if (s_hud.book) {
            open_codex();
        } else {
            set_msg("还没有图鉴：先找到宝物「怪物图鉴」（6F 房间）。");
            audio_play("click");
            mark_dirty();
        }
        break;
    case ACT_NEWGAME:
        s_ov.kind = OV_CONFIRM;
        s_ov.confirm_action = ACT_NEWGAME;
        snprintf(s_ov.title, sizeof(s_ov.title), "开始新游戏？");
        snprintf(s_ov.body, sizeof(s_ov.body),
                 "第%d层 · HP%d · 步数 %d\n开始新游戏会覆盖存档，且无法撤销。",
                 s_hud.floor + 1, s_hud.hp, s_steps);
        audio_play("click");
        mark_dirty();
        break;
    case ACT_SETTINGS:
        s_ov.kind = OV_SETTINGS;
        audio_play("click");
        mark_dirty();
        break;
    default:
        break;
    }
}

// ---------------- 渲染 ----------------

// 选中格：2px 亮框 + 四角短标记，压在格子上但不挡内容
static void render_sel(void)
{
    if (s_sel_c < 0 || s_sel_r < 0) {
        return;
    }
    int x = s_sel_c * TILE_PX - s_cam_px;
    int y = s_sel_r * TILE_PX - s_cam_py;
    if (x + TILE_PX <= 0 || y + TILE_PX <= 0 || x >= MAP_W || y >= MAP_H) {
        return;
    }
    const uint16_t c = RGB565(0x7C, 0xC8, 0xF0);
    gfx_rect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2, c);
    gfx_rect(x + 2, y + 2, TILE_PX - 4, TILE_PX - 4, c);
    // 四角加粗，缩小后也能一眼看出选中哪格
    const int L = 10;
    gfx_fill(x + 1, y + 1, L, 3, c);
    gfx_fill(x + 1, y + 1, 3, L, c);
    gfx_fill(x + TILE_PX - 1 - L, y + 1, L, 3, c);
    gfx_fill(x + TILE_PX - 4, y + 1, 3, L, c);
    gfx_fill(x + 1, y + TILE_PX - 4, L, 3, c);
    gfx_fill(x + 1, y + TILE_PX - 1 - L, 3, L, c);
    gfx_fill(x + TILE_PX - 1 - L, y + TILE_PX - 4, L, 3, c);
    gfx_fill(x + TILE_PX - 4, y + TILE_PX - 1 - L, 3, L, c);
}

// ---------------- 卷轴相机 ----------------

// 目标位置：英雄尽量居中，靠近塔边缘时夹紧，避免露出地图外
static void cam_clamp_target(void)
{
    int maxx = (GRID_COLS - VIEW_COLS) * TILE_PX;
    int maxy = (GRID_ROWS - VIEW_ROWS) * TILE_PX;
    int tx = s_hud.x * TILE_PX + TILE_PX / 2 - MAP_W / 2;
    int ty = s_hud.y * TILE_PX + TILE_PX / 2 - MAP_H / 2;
    if (tx < 0) {
        tx = 0;
    }
    if (tx > maxx) {
        tx = maxx;
    }
    if (ty < 0) {
        ty = 0;
    }
    if (ty > maxy) {
        ty = maxy;
    }
    s_cam_tx = tx;
    s_cam_ty = ty;
}

// 相机跟随与 web 一致：按整格对齐、直接跳，不做插值。
// web 里是 camX = clamp(state.x - floor(cols/2)) 然后 CSS translate，
// 英雄每走一格镜头整体平移一格；插值反而会让像素画在滚动时糊掉。
static bool cam_step(void)
{
    cam_clamp_target();
    if (s_cam_px == s_cam_tx && s_cam_py == s_cam_ty) {
        return false;
    }
    s_cam_px = s_cam_tx;
    s_cam_py = s_cam_ty;
    return true;
}

static void cam_snap(void)
{
    cam_step();
}

// 某些帧是整格贴图（墙/门/楼梯），某些是"镂空"的（道具/怪物/NPC/英雄）。
// 后者必须先铺一层地板，否则露出的就是接近黑色的背景，看起来像给精灵套了黑框。
static bool s_spr_overlay[SPRITE_COUNT];

static void sprite_info_init(void)
{
    for (int i = 0; i < SPRITE_COUNT; i++) {
        const uint8_t *m = g_sprite_alpha + (size_t)i * SPRITE_ALPHA_BYTES;
        bool overlay = false;
        for (int k = 0; k < SPRITE_TILE && !overlay; k++) {
            int idx[4] = {
                k,                                        // 上边
                (SPRITE_TILE - 1) * SPRITE_TILE + k,      // 下边
                k * SPRITE_TILE,                          // 左边
                k * SPRITE_TILE + SPRITE_TILE - 1,        // 右边
            };
            for (int j = 0; j < 4; j++) {
                int p = idx[j];
                if (!((m[p >> 3] >> (7 - (p & 7))) & 1)) {
                    overlay = true;
                    break;
                }
            }
        }
        s_spr_overlay[i] = overlay;
    }
}

static void render_map(void)
{
    const int ox = s_cam_px % TILE_PX;
    const int oy = s_cam_py % TILE_PX;
    const int c0 = s_cam_px / TILE_PX;
    const int r0 = s_cam_py / TILE_PX;

    // 多画一行一列盖住滚动中的边缘；溢出到侧栏/底栏的部分随后会被它们覆盖
    for (int vy = 0; vy <= VIEW_ROWS; vy++) {
        int gy = r0 + vy;
        if (gy >= GRID_ROWS) {
            break;
        }
        int sy = vy * TILE_PX - oy;
        for (int vx = 0; vx <= VIEW_COLS; vx++) {
            int gx = c0 + vx;
            if (gx >= GRID_COLS) {
                break;
            }
            char ch = s_anim.active ? s_anim.grid[gy][gx] : s_grid[gy][gx];
            if (!ch) {
                continue;
            }
            int spr = tile_sprite_or_fallback((unsigned char)ch);
            int dx = vx * TILE_PX - ox;
            if (spr >= 0 && spr < SPRITE_COUNT && s_spr_overlay[spr]) {
                gfx_sprite_scaled(dx, sy, SPR_FLOOR, TILE_PX);  // 镂空帧的地板底
            }
            gfx_sprite_scaled(dx, sy, spr, TILE_PX);
        }
    }

    if (!s_anim.active) {
        int hx = s_hud.x * TILE_PX - s_cam_px;
        int hy = s_hud.y * TILE_PX - s_cam_py;
        gfx_sprite_scaled(hx, hy, SPR_FLOOR, TILE_PX);
        gfx_sprite_scaled(hx, hy, s_hero_frame ? SPR_HERO_B : SPR_HERO_A, TILE_PX);
        return;
    }

    gfx_sprite_scaled(s_anim.from_x * TILE_PX - s_cam_px, s_anim.from_y * TILE_PX - s_cam_py,
                      SPR_FLOOR, TILE_PX);
    gfx_sprite_scaled(s_anim.from_x * TILE_PX - s_cam_px, s_anim.from_y * TILE_PX - s_cam_py,
                      SPR_HERO_A, TILE_PX);

    int64_t el = (int64_t)(xTaskGetTickCount() - s_anim.start) * portTICK_PERIOD_MS;
    if (el < ANIM_DASH_MS) {
        float p = (float)el / (float)ANIM_DASH_MS;
        int px = (int)(s_anim.from_x * TILE_PX + (s_anim.to_x - s_anim.from_x) * TILE_PX * p);
        int py = (int)(s_anim.from_y * TILE_PX + (s_anim.to_y - s_anim.from_y) * TILE_PX * p);
        gfx_sprite_scaled(px - s_cam_px, py - s_cam_py, SPR_HERO_B, TILE_PX);
    }
    if (el >= 100) {
        gfx_sprite_scaled(s_anim.to_x * TILE_PX - s_cam_px, s_anim.to_y * TILE_PX - s_cam_py,
                          SPR_FX_HIT, TILE_PX);

        char dbuf[24];
        if (s_anim.dmg > 0) {
            snprintf(dbuf, sizeof(dbuf), "-%dHP", s_anim.dmg);
        } else {
            snprintf(dbuf, sizeof(dbuf), "防杀!");
        }
        int dw = gfx_text20_width(dbuf);
        float p = el > ANIM_MS ? 1.0f : (float)el / (float)ANIM_MS;
        int dy = (int)(-22.0f * p);
        int dx = s_anim.to_x * TILE_PX - s_cam_px + (TILE_PX - dw) / 2;
        int dypos = s_anim.to_y * TILE_PX - s_cam_py + 2 + dy;
        if (dypos < 0) {
            dypos = 0;
        }
        gfx_text20(dx, dypos, dbuf, RGB565(0xFF, 0x8A, 0x65), 160);
    }
}

static void draw_kv(int y, int x, int w, const char *label, int value, uint16_t color)
{
    gfx_text(x, y, label, COL_TEXT_DIM, 28);
    char buf[16];
    snprintf(buf, sizeof(buf), "%d", value);
    int vw = gfx_text_width(buf);
    gfx_text(x + w - vw, y, buf, color, w);
}

static void render_side(void)
{
    gfx_fill(SIDE_X, 0, SIDE_W, MAP_H, COL_PANEL);
    gfx_fill(SIDE_X, 0, 1, MAP_H, COL_BORDER);

    char buf[32];
    snprintf(buf, sizeof(buf), "%dF", s_hud.floor + 1);
    gfx_text20(HUD_X + 2, 8, buf, COL_TEXT, 60);

    snprintf(buf, sizeof(buf), "步 %d", s_steps);
    int sw = gfx_text_width(buf);
    // 圆角：右上角还是压到步数，往左让到 x=416（离边 64px）
    gfx_text(SCR_W - 64 - sw, 8, buf, COL_TEXT_DIM, 110);

    // 数值统一 24px，比原来 20px 更适合小屏阅读
    draw_kv(28, HUD_X, HUD_W, "血", s_hud.hp, COL_HP);
    draw_kv(58, HUD_X, 72, "攻", s_hud.atk, COL_ATK);
    draw_kv(58, HUD_X + 84, 72, "防", s_hud.def, COL_DEF);
    draw_kv(88, HUD_X, 72, "金", s_hud.gold, COL_GOLD);
    draw_kv(88, HUD_X + 84, 72, "经", s_hud.exp, COL_TEXT_DIM);
    draw_kv(118, HUD_X, 48, "黄", s_hud.key_y, COL_KEY_Y);
    draw_kv(118, HUD_X + 54, 48, "蓝", s_hud.key_b, COL_KEY_B);
    draw_kv(118, HUD_X + 108, 48, "红", s_hud.key_r, COL_KEY_R);

    int acts[8];
    int n = visible_actions(acts);
    for (int i = 0; i < n; i++) {
        int x, y, w, h;
        int a = acts[i];
        act_rect(i, a, n, &x, &y, &w, &h);

        uint16_t border = COL_BORDER;
        uint16_t fg = COL_TEXT;
        if (a == ACT_SETTINGS) {
            border = COL_GOLD;
            fg = COL_GOLD;
        } else if (a == ACT_NEWGAME) {
            border = COL_HP;
            fg = COL_HP;
        } else if (a == ACT_CODEX) {
            border = COL_KEY_B;
            fg = s_hud.book ? COL_TEXT : COL_TEXT_DIM;
        } else if (a == ACT_BOMB) {
            fg = COL_ATK;
        } else if (a == ACT_SHOP) {
            fg = COL_GOLD;
        }

        // 按下态：手指还压在这个按钮上就先亮起来（web 的 :active），
        // 抬手命中后由 s_btn_hot 再保持 260ms，快速轻点也有反馈
        bool pressing = s_touch.down && s_touch.x >= x && s_touch.x < x + w &&
                        s_touch.y >= y && s_touch.y < y + h;
        bool hot = pressing || (a == s_btn_hot && xTaskGetTickCount() < s_btn_hot_until);
        gfx_fill(x, y, w, h, hot ? COL_HILITE : COL_BTN);
        gfx_rect(x, y, w, h, border);
        if (hot) {
            gfx_rect(x + 2, y + 2, w - 4, h - 4, COL_TEXT);
            fg = COL_TEXT;
        }
        const char *lb = act_label(a);
        int tw = gfx_text_width(lb);
        gfx_text(x + (w - tw) / 2, y + (h - 24) / 2, lb, fg, w);
    }
}

static const char *idle_hint(void)
{
    static char buf[48];
    snprintf(buf, sizeof(buf), "第%d层 · 点格子移动", s_hud.floor + 1);
    return buf;
}

static void render_bar(void)
{
    gfx_fill(0, BAR_Y, SCR_W, BAR_H, COL_PANEL);
    gfx_fill(0, BAR_Y, SCR_W, 1, COL_BORDER);

    const char *msg = s_msg[0] ? s_msg : idle_hint();
    // 底栏 102px 高，容得下 3 行 24px，长消息不再被截成 "..."
    // 左下角同样有圆角：左右各留 22px，纵向从 12px 起排
    gfx_text_wrap(22, BAR_Y + 12, msg, COL_TEXT, SCR_W - 44, 28, 3);
}

static void panel_begin(const char *title, const char *sub)
{
    gfx_fill(0, 0, SCR_W, SCR_H, RGB565(0x06, 0x08, 0x0E));
    gfx_fill(OV_X, OV_Y, OV_W, OV_H, COL_PANEL);
    gfx_rect(OV_X, OV_Y, OV_W, OV_H, COL_GOLD);
    gfx_text(OV_X + 20, OV_Y + 18, title, COL_GOLD, 300);
    if (sub && sub[0]) {
        int w = gfx_text_width(sub);
        gfx_text(OV_X + OV_W - 20 - w, OV_Y + 18, sub, COL_TEXT_DIM, 200);
    }
}

static void render_story(void)
{
    panel_begin(s_ov.title, NULL);
    gfx_text_wrap(OV_X + 20, OV_Y + 62, s_ov.body, COL_TEXT, OV_W - 40, 26, 9);

    int bx = OV_X + 20, by = OV_Y + OV_H - 56, bw = OV_W - 40, bh = 40;
    draw_btn(bx, by, bw, bh, COL_BORDER);
    // 字库没有 ▸，用两个汉字 + 手绘三角，避免缺字方块
    const char *cont = "继续";
    int tw = gfx_text_width(cont);
    int tx = bx + (bw - tw - 20) / 2;
    gfx_text(tx, by + 8, cont, COL_TEXT, bw - 40);
    for (int i = 0; i < 9; i++) {
        gfx_fill(tx + tw + 8 + i, by + 14 + i, 1, 18 - i * 2, COL_TEXT);
    }
}

static void render_menu(void)
{
    char sub[40];
    if (s_ov.kind == OV_SHOP) {
        snprintf(sub, sizeof(sub), "金币 %d", s_hud.gold);
    } else {
        snprintf(sub, sizeof(sub), "经验 %d / %d", s_hud.exp, s_exp_cost);
    }
    panel_begin(s_ov.title, sub);

    for (int i = 0; i < s_ov.rows; i++) {
        int y = ROW_Y0 + i * ROW_H;
        draw_row(ROW_X, y, ROW_W, ROW_H - 4);

        menu_row_t *r = &s_ov.row[i];
        uint16_t main = r->affordable ? COL_TEXT : COL_TEXT_DIM;
        gfx_text(ROW_X + 12, y + 9, r->label, main, 90);
        gfx_text20(ROW_X + 110, y + 13, r->effect, r->affordable ? COL_OK : COL_TEXT_DIM, 90);

        // 价格可能是「未解锁」这种中文，必须用 24px 字库（20px 只含 ASCII）
        int cw = gfx_text_width(r->cost);
        gfx_text(ROW_X + ROW_W - 12 - cw, y + 9, r->cost,
                 r->affordable ? COL_GOLD : COL_TEXT_DIM, 120);
    }

    int bx = ROW_X, by = OV_Y + OV_H - 62, bw = ROW_W, bh = 40;
    draw_btn(bx, by, bw, bh, COL_BORDER);
    gfx_text_center(bx + bw / 2, by + 8, "离开", COL_TEXT);
}

static void render_codex(void)
{
    char sub[32];
    snprintf(sub, sizeof(sub), "第%d层", s_hud.floor + 1);
    panel_begin("怪物图鉴", sub);

    if (s_codex_n == 0) {
        gfx_text_center(OV_X + OV_W / 2, 200, "本层没有怪物", COL_TEXT_DIM);
    }

    for (int i = 0; i < s_codex_n; i++) {
        int y = ROW_Y0 + i * 46;
        gfx_fill(ROW_X, y, ROW_W, 42, COL_ROW);

        codex_row_t *r = &s_codex[i];
        gfx_text(ROW_X + 10, y + 2, r->name, COL_TEXT, 140);
        if (r->alive > 1) {
            char cnt[16];
            snprintf(cnt, sizeof(cnt), "x%d", r->alive);
            gfx_text(ROW_X + 10 + gfx_text_width(r->name) + 4, y + 2, cnt, COL_GOLD, 60);
        }

        const char *badge = "";
        uint16_t bc = COL_TEXT_DIM;
        if (r->alive == 0) {
            badge = "已清";
        } else if (!r->ok) {
            badge = r->reason == 1 ? "护盾" : (r->reason == 2 ? "破不了防" : "会阵亡");
            bc = r->reason == 2 ? COL_ATK : COL_HP;
        } else if (r->hpCost == 0) {
            badge = "防杀";
            bc = COL_OK;
        } else {
            char b[16];
            snprintf(b, sizeof(b), "-%d", r->hpCost);
            badge = b;
            bc = COL_HP;
        }
        int bw2 = gfx_text_width(badge);
        gfx_text(ROW_X + ROW_W - 12 - bw2, y + 2, badge, bc, 140);

        // 第二行用 20px ASCII，避免 24px 两行把 46px 行高撑爆
        char buf[64];
        snprintf(buf, sizeof(buf), "HP%d  A%d  D%d", r->hp, r->atk, r->def);
        gfx_text20(ROW_X + 10, y + 24, buf, COL_TEXT_DIM, ROW_W - 20);
    }

    gfx_text_center(OV_X + OV_W / 2, OV_Y + OV_H - 34, "点屏幕关闭", COL_TEXT_DIM);
}

static void render_settings(void)
{
    panel_begin("设置", NULL);

    char buf[64];
    int y = ROW_Y0;
    snprintf(buf, sizeof(buf), "音效：%s", audio_muted() ? "关" : "开");
    draw_row(ROW_X, y, ROW_W, 42);
    gfx_text(ROW_X + 12, y + 9, buf, COL_TEXT, ROW_W - 24);

    y += 48;
    snprintf(buf, sizeof(buf), "战斗动画：%s", s_anim_on ? "开" : "关");
    draw_row(ROW_X, y, ROW_W, 42);
    gfx_text(ROW_X + 12, y + 9, buf, COL_TEXT, ROW_W - 24);

    y += 48;
    draw_row(ROW_X, y, ROW_W, 42);
    gfx_text(ROW_X + 12, y + 9, "重新开始", COL_HP, ROW_W - 24);

    y += 58;
    snprintf(buf, sizeof(buf), "记录：最高 %dF · 通关 %d 次", s_rec_best, s_rec_wins);
    gfx_text(ROW_X + 4, y, buf, COL_TEXT_DIM, ROW_W);
    if (s_rec_min > 0) {
        y += 26;
        snprintf(buf, sizeof(buf), "最少通关步数 %d", s_rec_min);
        gfx_text(ROW_X + 4, y, buf, COL_TEXT_DIM, ROW_W);
    }

    int bx = ROW_X, by = OV_Y + OV_H - 60, bw = ROW_W, bh = 40;
    draw_btn(bx, by, bw, bh, COL_BORDER);
    gfx_text_center(bx + bw / 2, by + 8, "关闭", COL_TEXT);
}

static void render_confirm(void)
{
    int x = 40, y = 120, w = 400, h = 240;
    gfx_fill(0, 0, SCR_W, SCR_H, RGB565(0x06, 0x08, 0x0E));
    gfx_fill(x, y, w, h, COL_PANEL);
    gfx_rect(x, y, w, h, COL_HP);
    gfx_text_center(x + w / 2, y + 20, s_ov.title, COL_TEXT);
    gfx_text_wrap(x + 20, y + 64, s_ov.body, COL_TEXT_DIM, w - 40, 26, 4);

    int bw = 150, bh = 40;
    draw_btn(x + 24, y + h - 60, bw, bh, COL_HP);
    gfx_text_center(x + 24 + bw / 2, y + h - 52, "覆盖并开始", COL_HP);

    draw_btn(x + w - 24 - bw, y + h - 60, bw, bh, COL_BORDER);
    gfx_text_center(x + w - 24 - bw / 2, y + h - 52, "取消", COL_TEXT);
}

static void render_end(void)
{
    if (s_hud.ended == 1) {
        gfx_fill(0, 0, SCR_W, SCR_H, COL_END_DEAD);
        gfx_text_center(SCR_W / 2, 120, "阵亡", COL_GOLD);
        gfx_text_center(SCR_W / 2, 168, "HP 归零，再来一次", COL_TEXT_DIM);
    } else {
        gfx_fill(0, 0, SCR_W, SCR_H, COL_END_WIN);
        gfx_text_center(SCR_W / 2, 120, "通关", COL_GOLD);
        gfx_text_center(SCR_W / 2, 168, "魔王已被击败", COL_TEXT_DIM);
    }

    char buf[64];
    snprintf(buf, sizeof(buf), "第%d层  HP %d", s_hud.floor + 1, s_hud.hp);
    gfx_text_center(SCR_W / 2, 214, buf, COL_TEXT);
    snprintf(buf, sizeof(buf), "攻击 %d  防御 %d  步数 %d", s_hud.atk, s_hud.def, s_steps);
    gfx_text_center(SCR_W / 2, 248, buf, COL_TEXT_DIM);

    int bx = 140, by = 330, bw = 200, bh = 44;
    gfx_fill(bx, by, bw, bh, COL_BTN);
    gfx_rect(bx, by, bw, bh, COL_GOLD);
    gfx_text_center(SCR_W / 2, by + 10, "点屏幕再来一次", COL_GOLD);
}

void game_render(void)
{
    gfx_clear(COL_BG);
    render_map();
    render_sel();
    render_side();
    render_bar();

    if (s_hud.ended) {
        render_end();
    }

    switch (s_ov.kind) {
    case OV_STORY:
        render_story();
        break;
    case OV_SHOP:
    case OV_MAGE:
        render_menu();
        break;
    case OV_CODEX:
        render_codex();
        break;
    case OV_SETTINGS:
        render_settings();
        break;
    case OV_CONFIRM:
        render_confirm();
        break;
    default:
        break;
    }

    if (game_flash_active()) {
        for (int i = 0; i < 3; i++) {
            gfx_rect(i, i, SCR_W - i * 2, SCR_H - i * 2, COL_HILITE);
        }
    }

    // 最后一步：把四角圆角外的像素涂黑（物理屏是圆角，AMOLED 黑=熄灭）
    // 46px 是按实机照片反推的半径：480 宽屏上约占 10%
    gfx_mask_rounded(46);
}

bool game_flash_active(void)
{
    return s_flash_until != 0 && xTaskGetTickCount() < s_flash_until;
}

bool game_needs_render(void)
{
    bool v = s_dirty_frame;
    s_dirty_frame = false;
    return v;
}

// ---------------- 输入 ----------------

bool game_screen_to_tile(int px, int py, int *col, int *row)
{
    if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) {
        return false;
    }
    // 视口坐标 + 相机偏移 = 全图坐标
    int c = (px + s_cam_px) / TILE_PX;
    int r = (py + s_cam_py) / TILE_PX;
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) {
        return false;
    }
    if (col) {
        *col = c;
    }
    if (row) {
        *row = r;
    }
    return true;
}

static void tap_overlay(int px, int py)
{
    switch (s_ov.kind) {
    case OV_STORY: {
        int bx = OV_X + 20, by = OV_Y + OV_H - 56, bw = OV_W - 40, bh = 40;
        if (px >= bx && px < bx + bw && py >= by && py < by + bh) {
            flash_btn(bx, by, bw, bh);
            s_ov.kind = OV_NONE;
            audio_play("click");
            mark_dirty();
            if (s_story_qn > 0) {
                show_next_story();
            }
        }
        break;
    }
    case OV_SHOP:
    case OV_MAGE: {
        int by = OV_Y + OV_H - 62;
        if (py >= by && py < by + 40 && px >= ROW_X && px < ROW_X + ROW_W) {
            flash_btn(ROW_X, by, ROW_W, 40);
            s_ov.kind = OV_NONE;
            audio_play("click");
            mark_dirty();
            show_next_story();
            return;
        }
        if (px < ROW_X || px >= ROW_X + ROW_W) {
            return;
        }
        int idx = (py - ROW_Y0) / ROW_H;
        if (py < ROW_Y0 || idx < 0 || idx >= s_ov.rows) {
            return;
        }
        flash_btn(ROW_X, ROW_Y0 + idx * ROW_H, ROW_W, ROW_H - 4);
        if (s_ov.kind == OV_SHOP) {
            buy_shop(idx);
        } else {
            buy_mage(idx);
        }
        break;
    }
    case OV_CODEX:
        s_ov.kind = OV_NONE;
        audio_play("click");
        mark_dirty();
        show_next_story();
        break;
    case OV_SETTINGS: {
        int y = ROW_Y0;
        if (py >= y && py < y + 42) {
            flash_btn(ROW_X, y, ROW_W, 42);
            audio_toggle_mute();
            audio_play("click");
            mark_dirty();
            return;
        }
        y += 48;
        if (py >= y && py < y + 42) {
            flash_btn(ROW_X, y, ROW_W, 42);
            s_anim_on = !s_anim_on;
            audio_play("click");
            mark_dirty();
            return;
        }
        y += 48;
        if (py >= y && py < y + 42) {
            flash_btn(ROW_X, y, ROW_W, 42);
            s_ov.kind = OV_CONFIRM;
            s_ov.confirm_action = ACT_NEWGAME;
            snprintf(s_ov.title, sizeof(s_ov.title), "开始新游戏？");
            snprintf(s_ov.body, sizeof(s_ov.body),
                     "第%d层 · HP%d · 步数 %d\n开始新游戏会覆盖存档，且无法撤销。",
                     s_hud.floor + 1, s_hud.hp, s_steps);
            mark_dirty();
            return;
        }
        int by = OV_Y + OV_H - 60;
        if (py >= by && py < by + 40) {
            flash_btn(ROW_X, by, ROW_W, 40);
            s_ov.kind = OV_NONE;
            audio_play("click");
            mark_dirty();
            show_next_story();
            return;
        }
        break;
    }
    case OV_CONFIRM: {
        int x = 40, y = 120, w = 400, h = 240;
        int by = y + h - 60;
        if (py >= by && py < by + 40) {
            if (px >= x + 24 && px < x + 24 + 150) {
                flash_btn(x + 24, by, 150, 40);
                s_ov.kind = OV_NONE;
                game_restart();
                mark_dirty();
            } else if (px >= x + w - 24 - 150 && px < x + w - 24) {
                flash_btn(x + w - 24 - 150, by, 150, 40);
                s_ov.kind = OV_NONE;
                audio_play("click");
                mark_dirty();
            }
        }
        break;
    }
    default:
        break;
    }
}

static void tap_side(int px, int py)
{
    int acts[8];
    int n = visible_actions(acts);
    for (int i = 0; i < n; i++) {
        int x, y, w, h;
        act_rect(i, acts[i], n, &x, &y, &w, &h);
        if (px >= x && px < x + w && py >= y && py < y + h) {
            do_action(acts[i]);
            return;
        }
    }
}

// 触摸落点反馈。input.c 在按下/抬起各调一次；
// 串口注入（diag tap）也会调，所以自动截图里同样能看到圆圈。
void game_touch_state(int x, int y, bool down)
{
    s_touch.x = x;
    s_touch.y = y;
    s_touch.down = down;
    mark_dirty();
}

void game_tap(int px, int py)
{
    ESP_LOGD(TAG, "tap %d,%d ov=%d anim=%d ended=%d pos=%d,%d", px, py, (int)s_ov.kind,
             (int)s_anim.active, s_hud.ended, s_hud.x, s_hud.y);
    if (s_anim.active) {
        return;
    }
    mark_dirty();
    if (s_ov.kind != OV_NONE) {
        tap_overlay(px, py);
        return;
    }
    if (s_hud.ended) {
        game_restart();
        return;
    }
    if (px >= SIDE_X && py < MAP_H) {
        tap_side(px, py);
        return;
    }
    if (py >= BAR_Y) {
        return;
    }

    stop_auto();
    int col = (px + s_cam_px) / TILE_PX, row = (py + s_cam_py) / TILE_PX;
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
        return;
    }
    s_sel_c = col;
    s_sel_r = row;
    if (col == s_hud.x && row == s_hud.y) {
        return;
    }
    int adx = col > s_hud.x ? col - s_hud.x : s_hud.x - col;
    int ady = row > s_hud.y ? row - s_hud.y : s_hud.y - row;
    if (adx + ady == 1) {
        int dir = (row < s_hud.y) ? 0 : (col > s_hud.x) ? 1 : (row > s_hud.y) ? 2 : 3;
        step_once(dir);
        return;
    }
    walk_to(col, row);
}

// ---------------- 主循环 ----------------

bool game_ended(void)
{
    return s_hud.ended != 0;
}

const char *game_message(void)
{
    return s_msg[0] ? s_msg : NULL;
}

int game_floor(void)
{
    return s_hud.floor;
}

void game_debug_state(char *buf, int n)
{
    snprintf(buf, n, "第%d层 (%d,%d) HP%d A%d D%d G%d Y%d B%d R%d 步%d 结束%d flags%u 覆盖%d cam%d,%d touch%d@%d,%d",
             s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp, s_hud.atk, s_hud.def,
             s_hud.gold, s_hud.key_y, s_hud.key_b, s_hud.key_r, s_steps,
             s_hud.ended, (unsigned)s_hud.flags, (int)s_ov.kind,
             s_cam_px, s_cam_py, (int)s_touch.down, s_touch.x, s_touch.y);
}

static TickType_t s_anim_last_frame = 0;

void game_tick(void)
{
    TickType_t now = xTaskGetTickCount();

    // 相机：换层/读档后先硬对齐，其余时间平滑跟随
    if (s_cam_floor != s_hud.floor) {
        s_cam_floor = s_hud.floor;
        cam_snap();
        mark_dirty();
    } else {
        cam_clamp_target();
        if (cam_step()) {
            mark_dirty();
        }
    }

    if (s_btn_hot >= 0 && now >= s_btn_hot_until) {
        s_btn_hot = -1;
        mark_dirty();
    }

    if (s_hot_valid && now >= s_hot_until) {
        s_hot_valid = false;
        mark_dirty();
    }

    if (s_dirty_save) {
        s_dirty_save = false;
        save_to_nvs();
    }

    bool flash = game_flash_active();
    if (flash != s_flash_was) {
        s_flash_was = flash;
        mark_dirty();
    }
    if (s_flash_until != 0 && now >= s_flash_until) {
        s_flash_until = 0;
    }

    if (s_anim.active) {
        int64_t el = (int64_t)(now - s_anim.start) * portTICK_PERIOD_MS;
        if (el >= ANIM_MS) {
            s_anim.active = false;
            read_grid();
            show_next_story();
            mark_dirty();
        } else if (now - s_anim_last_frame >= pdMS_TO_TICKS(ANIM_FRAME_MS)) {
            s_anim_last_frame = now;
            mark_dirty();
        }
        return;
    }

    if (s_ov.kind != OV_NONE || s_hud.ended) {
        stop_auto();
        return;
    }

    if (s_pending.active && s_path_i >= s_path_n) {
        if (now >= s_pending.at) {
            int tx = s_pending.x, ty = s_pending.y;
            s_pending.active = false;
            int dir = (ty < s_hud.y) ? 0 : (tx > s_hud.x) ? 1 : (ty > s_hud.y) ? 2 : 3;
            step_once(dir);
        }
        return;
    }

    if (s_path_i >= s_path_n) {
        return;
    }
    if (now < s_next_step) {
        return;
    }

    int ox = s_hud.x, oy = s_hud.y, ofloor = s_hud.floor;
    int dir = s_path[s_path_i++];
    step_once(dir);
    s_next_step = now + pdMS_TO_TICKS(STEP_MS);

    if (s_hud.x == ox && s_hud.y == oy && s_hud.floor == ofloor) {
        stop_auto();
        return;
    }
    if (s_hud.ended || s_ov.kind != OV_NONE) {
        stop_auto();
        return;
    }
    if (s_path_i >= s_path_n && s_pending.active) {
        s_pending.at = now + pdMS_TO_TICKS(STEP_MS);
    }
}

void game_dump_stats(void)
{
    size_t free_int = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t free_ps = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    if (s_rt) {
        JSMemoryUsage u;
        JS_ComputeMemoryUsage(s_rt, &u);
        ESP_LOGI(TAG, "JS 堆: malloc_size=%d malloc_count=%d obj=%d str=%d",
                 (int)u.malloc_size, (int)u.malloc_count, (int)u.obj_count, (int)u.str_count);
    }
    ESP_LOGI(TAG, "内存: 内部剩余 %d / PSRAM 剩余 %d", (int)free_int, (int)free_ps);
}

const char *game_serialize(void)
{
    static char buf[4096];
    buf[0] = '\0';
    if (!s_ctx) {
        return buf;
    }
    JSValue args[1] = {s_state};
    JSValue v = JS_Call(s_ctx, s_fn_ser, s_logic, 1, args);
    if (JS_IsException(v)) {
        js_dump_error("serialize");
        return buf;
    }
    const char *s = JS_ToCString(s_ctx, v);
    if (s) {
        snprintf(buf, sizeof(buf), "%s", s);
        JS_FreeCString(s_ctx, s);
    }
    JS_FreeValue(s_ctx, v);
    return buf;
}

bool game_load_text(const char *text)
{
    if (!game_deserialize(text)) {
        return false;
    }
    s_ov.kind = OV_NONE;
    s_story_qn = 0;
    s_steps = 0;
    s_anim.active = false;
    stop_auto();
    s_cam_floor = -1;
    s_sel_c = s_sel_r = -1;
    save_to_nvs();
    mark_dirty();
    ESP_LOGI(TAG, "载入存档串 OK：第%d层 (%d,%d) HP=%d", s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp);
    return true;
}

bool game_deserialize(const char *text)
{
    if (!s_ctx || !text) {
        return false;
    }
    JSValue args[1] = {JS_NewString(s_ctx, text)};
    JSValue v = JS_Call(s_ctx, s_fn_deser, s_logic, 1, args);
    JS_FreeValue(s_ctx, args[0]);
    if (JS_IsException(v)) {
        js_dump_error("deserialize");
        return false;
    }
    // logic.deserialize 对坏档返回 null —— 不能拿 null 覆盖当前 state，
    // 否则 HUD 全变 0，下一次存档就把旧进度写没了。
    if (!JS_IsObject(v)) {
        JS_FreeValue(s_ctx, v);
        return false;
    }
    JS_FreeValue(s_ctx, s_state);
    s_state = v;
    s_steps = 0;
    s_win_counted = false;
    read_hud();
    read_grid();
    return true;
}
