# main 组件：游戏本体
# assets/*.c 是 tools/export_assets.py 生成的点阵/精灵/音效数组，勿手改
# js/logic_bundle.js 是 tools/bundle_logic.py 打包的逻辑层，用 EMBED 嵌进固件

idf_component_register(
    SRCS
        "main.c"
        "board.c"
        "gfx.c"
        "game.c"
        "input.c"
        "audio.c"
        "diag.c"
        "assets/sprites.c"
        "assets/font24.c"
        "assets/font20.c"
        "assets/sfx.c"
        "assets/tilemap.c"
    INCLUDE_DIRS
        "."
        "assets"
    EMBED_TXTFILES
        "js/logic_bundle.js"
)

# 生成资源与逻辑包较大，关掉对它们的编译告警刷屏
set_source_files_properties(
    "assets/sprites.c"
    "assets/font24.c"
    "assets/font20.c"
    "assets/sfx.c"
    PROPERTIES COMPILE_OPTIONS "-w"
)
