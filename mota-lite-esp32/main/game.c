// game.c —— QuickJS 承载 logic.js，C 侧负责把状态画到屏上。
//
// 关键设计：
//   * state 常驻 JS 堆，每步由 resolveStep 产新对象替换，C 只持引用
//   * 地图整层用一次 floorString() 取出，避免 195 次跨语言调用
//   * 渲染是整屏重绘（450KB），回合制下每次操作一次，够用且代码简单
//
// Created by Davis

#include "game.h"

#include <stdio.h>
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "quickjs.h"

#include "font24.h"
#include "gfx.h"
#include "sprites.h"
#include "tilemap.h"

static const char *TAG = "game";

// tools/bundle_logic.py 生成的单文件逻辑包，由 CMake 的 EMBED_TXTFILES 嵌入
// 符号名不含目录前缀（IDF 取 basename）：js/logic_bundle.js -> _binary_logic_bundle_js_*
extern const uint8_t bundle_start[] asm("_binary_logic_bundle_js_start");
extern const uint8_t bundle_end[] asm("_binary_logic_bundle_js_end");

#define GRID_COLS 13
#define GRID_ROWS 15

typedef struct {
    int floor, x, y;
    int hp, atk, def, gold, exp;
    int key_y, key_b, key_r;
    int fly, bomb, book;
    int ended;  // 0 进行中 / 1 阵亡 / 2 通关
} hud_t;

static JSRuntime *s_rt = NULL;
static JSContext *s_ctx = NULL;
static JSValue s_logic = {0};
static JSValue s_state = {0};
static JSValue s_fn_new = {0};
static JSValue s_fn_step = {0};
static JSValue s_fn_floor = {0};
static JSValue s_fn_ser = {0};
static JSValue s_fn_deser = {0};

static hud_t s_hud;
static char s_grid[GRID_ROWS][GRID_COLS + 1];
static char s_msg[128];

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
                snprintf(s_msg, sizeof(s_msg), "%s", text);
                JS_FreeCString(s_ctx, text);
            }
            JS_FreeValue(s_ctx, xv);
        } else if (type) {
            // 战斗 / 拾取 / 开门等事件 M1 先只记录，M2 再接音效与动效
            ESP_LOGD(TAG, "事件 %s", type);
        }

        if (type) {
            JS_FreeCString(s_ctx, type);
        }
        JS_FreeValue(s_ctx, tv);
        JS_FreeValue(s_ctx, e);
    }
}

// ---------------- 生命周期 ----------------

void game_init(void)
{
    s_rt = JS_NewRuntime();
    if (!s_rt) {
        ESP_LOGE(TAG, "JS_NewRuntime 失败");
        return;
    }
    // 逻辑包 + 关卡数据约 60KB 源码，eval 后对象图更大，堆给 8MB 上限（实际由 PSRAM 兜底）
    JS_SetMemoryLimit(s_rt, 8 * 1024 * 1024);
    JS_SetMaxStackSize(s_rt, 128 * 1024);

    s_ctx = JS_NewContext(s_rt);
    if (!s_ctx) {
        ESP_LOGE(TAG, "JS_NewContext 失败");
        return;
    }

    size_t len = (size_t)(bundle_end - bundle_start);
    if (len == 0) {
        ESP_LOGE(TAG, "逻辑包为空，检查 EMBED_TXTFILES");
        return;
    }
    // EMBED_TXTFILES 会在数据末尾追加一个 \0，传给 JS_Eval 必须排除，
    // 否则 QuickJS 会把它当成非法 token 报 "unexpected token in expression"
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

    ESP_LOGI(TAG, "QuickJS 就绪，逻辑包 %d 字节", (int)len);
    game_new();
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

    snprintf(s_msg, sizeof(s_msg), "按方向键或点格子移动");
    read_hud();
    read_grid();

    // 一次性自检：地图字符与 HUD 是否取到，用于无实物时的渲染排查
    ESP_LOGI(TAG, "首局 第%d层 (%d,%d) HP=%d ATK=%d DEF=%d",
             s_hud.floor + 1, s_hud.x, s_hud.y, s_hud.hp, s_hud.atk, s_hud.def);
    ESP_LOGI(TAG, "地图首行 [%.13s] 次行 [%.13s]", s_grid[0], s_grid[1]);
}

void game_step(int dir)
{
    if (!s_ctx || !JS_IsObject(s_state)) {
        return;
    }
    JSValue args[2] = {s_state, JS_NewInt32(s_ctx, dir)};
    JSValue r = JS_Call(s_ctx, s_fn_step, s_logic, 2, args);
    JS_FreeValue(s_ctx, args[1]);

    if (JS_IsException(r)) {
        js_dump_error("stepByIndex");
        return;
    }

    JSValue next = JS_GetPropertyStr(s_ctx, r, "state");
    if (JS_IsObject(next)) {
        JS_FreeValue(s_ctx, s_state);
        s_state = next;  // 接管引用
    } else {
        JS_FreeValue(s_ctx, next);
    }

    JSValue ev = JS_GetPropertyStr(s_ctx, r, "events");
    handle_events(ev);
    JS_FreeValue(s_ctx, ev);
    JS_FreeValue(s_ctx, r);

    read_hud();
    read_grid();
}

int game_floor(void)
{
    return s_hud.floor;
}

const char *game_message(void)
{
    return s_msg[0] ? s_msg : NULL;
}

// ---------------- 渲染 ----------------

static void render_map(void)
{
    for (int y = 0; y < GRID_ROWS; y++) {
        for (int x = 0; x < GRID_COLS; x++) {
            char ch = s_grid[y][x];
            if (!ch) {
                continue;
            }
            int spr = tile_sprite_or_fallback((unsigned char)ch);
            gfx_sprite(x * TILE_PX, y * TILE_PX, spr);
        }
    }
    // 英雄画在最上层
    gfx_sprite(s_hud.x * TILE_PX, s_hud.y * TILE_PX, SPR_HERO_A);
}

static void draw_stat_line(int x, int y, const char *label, int value, uint16_t color)
{
    char buf[32];
    snprintf(buf, sizeof(buf), "%s", label);
    gfx_text(x, y, buf, COL_TEXT_DIM, SIDE_W - 16);
    snprintf(buf, sizeof(buf), "%d", value);
    gfx_text(x, y + 26, buf, color, SIDE_W - 16);
}

static void render_side(void)
{
    gfx_fill(SIDE_X, 0, SIDE_W, MAP_H, COL_PANEL);
    gfx_fill(SIDE_X, 0, 1, MAP_H, COL_BORDER);

    int x = SIDE_X + 12;
    int y = 14;

    draw_stat_line(x, y, "生命", s_hud.hp, COL_HP);
    y += 62;
    draw_stat_line(x, y, "攻击", s_hud.atk, COL_ATK);
    y += 62;
    draw_stat_line(x, y, "防御", s_hud.def, COL_DEF);
    y += 62;
    draw_stat_line(x, y, "金币", s_hud.gold, COL_GOLD);
    y += 62;

    // 三色钥匙
    char buf[32];
    snprintf(buf, sizeof(buf), "黄 %d", s_hud.key_y);
    gfx_text(x, y, buf, COL_KEY_Y, SIDE_W - 16);
    y += 26;
    snprintf(buf, sizeof(buf), "蓝 %d", s_hud.key_b);
    gfx_text(x, y, buf, COL_KEY_B, SIDE_W - 16);
    y += 26;
    snprintf(buf, sizeof(buf), "红 %d", s_hud.key_r);
    gfx_text(x, y, buf, COL_KEY_R, SIDE_W - 16);
    y += 34;

    snprintf(buf, sizeof(buf), "第%d层", s_hud.floor + 1);
    gfx_text(x, y, buf, COL_TEXT, SIDE_W - 16);
    y += 34;

    if (s_hud.exp) {
        snprintf(buf, sizeof(buf), "经验%d", s_hud.exp);
        gfx_text(x, y, buf, COL_TEXT_DIM, SIDE_W - 16);
    }
}

static void render_bar(void)
{
    gfx_fill(0, BAR_Y, SCR_W, BAR_H, COL_PANEL);
    gfx_fill(0, BAR_Y, SCR_W, 1, COL_BORDER);

    const char *msg = game_message();
    if (msg) {
        gfx_text(12, BAR_Y + 18, msg, COL_TEXT, SCR_W - 24);
    }

    if (s_hud.ended == 1) {
        gfx_fill(0, 0, SCR_W, SCR_H, RGB565(0x40, 0x08, 0x08));
        gfx_text_center(SCR_W / 2, 200, "你倒下了", COL_TEXT);
    } else if (s_hud.ended == 2) {
        gfx_fill(0, 0, SCR_W, SCR_H, RGB565(0x08, 0x30, 0x10));
        gfx_text_center(SCR_W / 2, 200, "通关", COL_TEXT);
    }
}

void game_render(void)
{
    gfx_clear(COL_BG);
    render_map();
    render_side();
    render_bar();
}

// ---------------- 输入 ----------------

bool game_screen_to_tile(int px, int py, int *col, int *row)
{
    if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) {
        return false;
    }
    if (col) {
        *col = px / TILE_PX;
    }
    if (row) {
        *row = py / TILE_PX;
    }
    return true;
}

// 格子是否可站人（空地）：寻路时中间格只走这两种，避免穿墙穿门
static bool tile_open(char c)
{
    return c == '.' || c == '@';
}

// 四连通 BFS 寻路：中间只走空地，终点可以是任意非墙格（怪物/道具/门都能当目标，
// 走过去由 logic.js 的 resolveStep 结算交互）。
// 返回是否找到了路径。
static bool walk_to(int tx, int ty)
{
    if (tx == s_hud.x && ty == s_hud.y) {
        return false;
    }
    if (tx < 0 || ty < 0 || tx >= GRID_COLS || ty >= GRID_ROWS) {
        return false;
    }
    char target = s_grid[ty][tx];
    if (target == '#' || target == 'A' || target == 0) {
        return false;  // 墙与伪装墙不能当目标
    }

    static int16_t prev[GRID_ROWS][GRID_COLS];
    static int16_t queue[GRID_ROWS * GRID_COLS];
    memset(prev, -1, sizeof(prev));

    int head = 0, tail = 0;
    const int start = s_hud.y * GRID_COLS + s_hud.x;
    prev[s_hud.y][s_hud.x] = -2;  // 起点标记
    queue[tail++] = (int16_t)start;

    static const int dx[4] = {0, 1, 0, -1};
    static const int dy[4] = {-1, 0, 1, 0};
    bool found = false;

    while (head < tail) {
        int cur = queue[head++];
        int cx = cur % GRID_COLS;
        int cy = cur / GRID_COLS;
        if (cx == tx && cy == ty) {
            found = true;
            break;
        }
        for (int d = 0; d < 4; d++) {
            int nx = cx + dx[d];
            int ny = cy + dy[d];
            if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) {
                continue;
            }
            if (prev[ny][nx] != -1) {
                continue;
            }
            char c = s_grid[ny][nx];
            bool is_target = (nx == tx && ny == ty);
            if (c == '#' || c == 'A' || c == 0) {
                continue;
            }
            // 中间格必须是空地；终点允许是实体（走过去撞它）
            if (!is_target && !tile_open(c)) {
                continue;
            }
            prev[ny][nx] = (int16_t)cur;
            queue[tail++] = (int16_t)(ny * GRID_COLS + nx);
        }
    }
    if (!found) {
        return false;
    }

    // 回溯出完整路径，从起点后一格开始逐格执行
    int path[GRID_ROWS * GRID_COLS];
    int n = 0;
    int cur = ty * GRID_COLS + tx;
    while (cur >= 0 && n < (int)(sizeof(path) / sizeof(path[0]))) {
        path[n++] = cur;
        int px = cur % GRID_COLS;
        int py = cur / GRID_COLS;
        int p = prev[py][px];
        if (p == -2) {
            break;
        }
        cur = p;
    }

    for (int i = n - 2; i >= 0; i--) {
        int cx = path[i] % GRID_COLS;
        int cy = path[i] / GRID_COLS;
        int ddx = cx - s_hud.x;
        int ddy = cy - s_hud.y;
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
            break;  // 路径异常，收手
        }
        game_step(dir);
        // 被门/怪物拦住（位置没按预期推进）就停下，交回玩家判断
        if (s_hud.x != cx || s_hud.y != cy) {
            break;
        }
    }
    return true;
}

void game_tap_tile(int col, int row)
{
    if (col == s_hud.x && row == s_hud.y) {
        return;
    }

    int dx = col - s_hud.x;
    int dy = row - s_hud.y;
    int adx = dx < 0 ? -dx : dx;
    int ady = dy < 0 ? -dy : dy;

    // 相邻格：直接走一步，交互语义与 web 版一致（撞一下停原地）
    if (adx + ady == 1) {
        int dir = (dy == -1) ? 0 : (dx == 1) ? 1 : (dy == 1) ? 2 : 3;
        game_step(dir);
        return;
    }

    // 远处：BFS 自动走过去
    if (!walk_to(col, row)) {
        snprintf(s_msg, sizeof(s_msg), "那里走不过去");
    }
}

// ---------------- 调试 ----------------

void game_dump_stats(void)
{
    size_t free_int = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t free_ps = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    if (s_rt) {
        JSMemoryUsage u;
        JS_ComputeMemoryUsage(s_rt, &u);
        ESP_LOGI(TAG, "JS 堆: malloc_size=%d malloc_count=%d  obj=%d str=%d",
                 (int)u.malloc_size, (int)u.malloc_count, (int)u.obj_count, (int)u.str_count);
    }
    ESP_LOGI(TAG, "内存: 内部剩余 %d 字节 / PSRAM 剩余 %d 字节", (int)free_int, (int)free_ps);
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
    JS_FreeValue(s_ctx, s_state);
    s_state = v;
    read_hud();
    read_grid();
    return true;
}
