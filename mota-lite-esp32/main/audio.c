// audio.c —— ES8311 codec + I2S 音效输出。
//
// 引脚取自微雪官方 BSP（boards/esp32_s3_touch_amoled_2_16/board_peripherals.yaml）：
//   I2S0: MCLK=42 BCLK=9 WS=45 DOUT=8 DIN=10；PA 使能=46（高有效）
//   ES8311 挂 I2C0，8bit 地址 0x30（7bit 0x18）
//
// 时钟系数不手抄寄存器：交给 esp_codec_dev + es8311 组件按实际采样率算，
// 22.05kHz 这种非标准频率也能正确出声。播放放在独立任务里，避免阻塞 UI。
//
// Created by Davis

#include "audio.h"

#include <string.h>

#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "es8311_codec.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "board.h"
#include "sfx.h"

static const char *TAG = "audio";

#define PIN_I2S_MCLK  42
#define PIN_I2S_BCLK  9
#define PIN_I2S_WS    45
#define PIN_I2S_DOUT  8
#define PIN_PA_CTRL   46

static esp_codec_dev_handle_t s_dev = NULL;
static QueueHandle_t s_queue = NULL;
static bool s_muted = false;

// 播放任务：从队列取音效序号，整段写给 codec。
// 队列深度 8，连点也只保留最近几次，不会把内存吃光（每段 10~40KB 在 Flash 常量区）。
static void audio_task(void *arg)
{
    (void)arg;
    int idx = 0;
    while (xQueueReceive(s_queue, &idx, portMAX_DELAY) == pdTRUE) {
        if (idx < 0 || idx >= SFX_COUNT || !s_dev || s_muted) {
            continue;
        }
        const sfx_t *s = &g_sfx[idx];
        esp_codec_dev_write(s_dev, (void *)s->data, (int)(s->samples * sizeof(int16_t)));
    }
}

void audio_init(void)
{
    // I2S 主模式，22.05kHz / 16bit / 单声道，MCLK = 256 * fs
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.auto_clear = true;  // 播完自动补 0，避免 DMA 循环重放最后一段
    i2s_chan_handle_t tx = NULL;
    esp_err_t err = i2s_new_channel(&chan_cfg, &tx, NULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "i2s_new_channel 失败 0x%x，音频不可用", err);
        return;
    }

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SFX_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = PIN_I2S_MCLK,
            .bclk = PIN_I2S_BCLK,
            .ws = PIN_I2S_WS,
            .dout = PIN_I2S_DOUT,
            .din = I2S_GPIO_UNUSED,
            .invert_flags = {false, false, false},
        },
    };
    std_cfg.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;

    err = i2s_channel_init_std_mode(tx, &std_cfg);
    if (err == ESP_OK) {
        err = i2s_channel_enable(tx);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2S 初始化失败 0x%x", err);
        return;
    }

    audio_codec_i2s_cfg_t i2s_cfg = {
        .port = I2S_NUM_0,
        .tx_handle = tx,
    };
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_cfg);
    audio_codec_i2c_cfg_t i2c_cfg = {
        .addr = ES8311_CODEC_DEFAULT_ADDR,  // 0x30（8bit）
        .bus_handle = board_i2c_bus(),
        .clock_speed_hz = 400000,
    };
    const audio_codec_ctrl_if_t *ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
    const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();
    if (!data_if || !ctrl_if || !gpio_if) {
        ESP_LOGE(TAG, "codec 接口创建失败");
        return;
    }

    es8311_codec_cfg_t es_cfg = {
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_DAC,
        .ctrl_if = ctrl_if,
        .gpio_if = gpio_if,
        .pa_pin = PIN_PA_CTRL,
        .pa_reverted = false,
        .master_mode = false,
        .use_mclk = true,
        .hw_gain = {
            .pa_voltage = 5.0f,
            .codec_dac_voltage = 3.3f,
            .pa_gain = 6.0f,
        },
    };
    const audio_codec_if_t *codec_if = es8311_codec_new(&es_cfg);
    if (!codec_if) {
        ESP_LOGE(TAG, "ES8311 初始化失败（I2C 无应答？）");
        return;
    }

    esp_codec_dev_cfg_t dev_cfg = {
        .codec_if = codec_if,
        .data_if = data_if,
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
    };
    s_dev = esp_codec_dev_new(&dev_cfg);
    if (!s_dev) {
        ESP_LOGE(TAG, "esp_codec_dev_new 失败");
        return;
    }

    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = 16,
        .channel = 1,
        .sample_rate = SFX_RATE,
        .mclk_multiple = 256,
    };
    err = (esp_err_t)esp_codec_dev_open(s_dev, &fs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "codec open 失败 0x%x", err);
        s_dev = NULL;
        return;
    }
    // 50% 音量：65 在板载功放下偏响，Davis 实测后要求减半
    esp_codec_dev_set_out_vol(s_dev, 32);

    s_queue = xQueueCreate(8, sizeof(int));
    if (!s_queue) {
        ESP_LOGE(TAG, "音效队列创建失败");
        return;
    }
    xTaskCreate(audio_task, "audio", 4096, NULL, 5, NULL);
    ESP_LOGI(TAG, "ES8311 就绪 %d Hz 单声道，音效 %d 段", SFX_RATE, SFX_COUNT);
}

void audio_play(const char *name)
{
    if (!s_queue || s_muted || !name) {
        return;
    }
    int idx = sfx_find(name);
    if (idx < 0) {
        return;
    }
    // 连点/连走时只保留最新一条，避免旧音效排队把声音拖到几秒后
    xQueueReset(s_queue);
    xQueueSend(s_queue, &idx, 0);  // 队列满就丢弃，绝不阻塞输入
}

bool audio_toggle_mute(void)
{
    s_muted = !s_muted;
    if (s_dev) {
        esp_codec_dev_set_out_mute(s_dev, s_muted);
    }
    ESP_LOGI(TAG, "音效%s", s_muted ? "静音" : "开启");
    return s_muted;
}

bool audio_muted(void)
{
    return s_muted;
}
