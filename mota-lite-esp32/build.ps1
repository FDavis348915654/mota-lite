# build.ps1 —— 固化的 ESP-IDF 构建入口。
#
# 为什么需要它：本机 IDF 装在 C:\esp\esp-idf，工具链在 %USERPROFILE%\.espressif，
# 都不在系统 PATH 里；而且 Git Bash 会触发 IDF 的 "MSys/Mingw is not supported" 拦截，
# 所以统一走 Windows 原生 PowerShell 并显式拼好环境。
#
# 用法：
#   .\build.ps1 set-target esp32s3
#   .\build.ps1 build
#   .\build.ps1 -p COM4 flash monitor
#
# Created by Davis

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$IdfArgs
)

# 注意：必须用 Continue。idf.py 会把 Kconfig 警告写道 stderr，
# 若设成 Stop，PowerShell 会抛 NativeCommandError 并中断脚本，
# 表现为「配置/编译莫名其妙失败」，而真正原因只是一条无害警告。
$ErrorActionPreference = "Continue"

$IdfRoot = "C:\esp\esp-idf"
$Tools   = "$env:USERPROFILE\.espressif\tools"
$PyEnv   = "$env:USERPROFILE\.espressif\python_env\idf6.0_py3.13_env"

if (-not (Test-Path $PyEnv)) {
    throw "找不到 IDF Python 环境：$PyEnv。先跑 tools\idf_tools.py install-python-env"
}

$env:IDF_PATH            = $IdfRoot
$env:IDF_PYTHON_ENV_PATH = $PyEnv
$env:IDF_TOOLS_PATH      = "$env:USERPROFILE\.espressif"
# idf-component-manager 会用 ESP_IDF_VERSION 做特性判断，缺了会在 idf_extensions.py 抛 NoneType
$env:ESP_IDF_VERSION     = "6.0.2"
# 工具链根目录，供 IDF 的 CMake 找 ROM ELF 等
$env:ESP_ROM_ELF_DIR     = "$Tools\esp-rom-elfs\20241011\"

$env:PATH = @(
    "$Tools\xtensa-esp-elf\esp-15.2.0_20251204\xtensa-esp-elf\bin",
    "$Tools\cmake\4.0.3\bin",
    "$Tools\ninja\1.12.1",
    "$Tools\esp-rom-elfs\20241011",
    "$Tools\ccache\4.12.1",
    "$PyEnv\Scripts",
    "$IdfRoot\tools",
    $env:PATH
) -join ";"

$Python = "$PyEnv\Scripts\python.exe"
& $Python "$IdfRoot\tools\idf.py" @IdfArgs
exit $LASTEXITCODE
