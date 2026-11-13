# mota-lite-esp32 —— 魔塔 Lite 的 ESP32-S3 移植（Waveshare AMOLED-2.16）
# 逻辑层通过 QuickJS 直接跑 mota-lite-web 的 logic.js，本项目只负责渲染、输入与板级驱动。
# Created by Davis

cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(mota_lite_esp32)
