@echo off
REM WebRecorder 打包脚本 (Windows)
REM 用于创建 Chrome 应用商店发布包

echo 🚀 开始打包 WebRecorder...

REM 版本号
set VERSION=1.0.0
set OUTPUT_DIR=release
set OUTPUT_FILE=webrecorder-v%VERSION%.zip

REM 创建输出目录
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM 删除旧的打包文件
if exist "%OUTPUT_DIR%\%OUTPUT_FILE%" (
    echo 📦 删除旧的打包文件...
    del "%OUTPUT_DIR%\%OUTPUT_FILE%"
)

REM 检查是否安装了 7-Zip
where 7z >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 错误: 未找到 7-Zip
    echo 请安装 7-Zip 或使用手动打包方式
    echo 下载地址: https://www.7-zip.org/
    pause
    exit /b 1
)

REM 打包文件
echo 📦 打包扩展文件...
7z a -tzip "%OUTPUT_DIR%\%OUTPUT_FILE%" ^
    manifest.json ^
    background ^
    content ^
    icons ^
    options ^
    popup ^
    storage ^
    utils ^
    README.md ^
    PRIVACY_POLICY.md ^
    -x!.git ^
    -x!.vscode ^
    -x!node_modules ^
    -x!.DS_Store ^
    -x!EXPORT_TEST.md ^
    -x!OPTIMIZATION.md ^
    -x!BUILD.md ^
    -x!STORE_DESCRIPTION.md ^
    -x!package.sh ^
    -x!package.bat

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 打包失败
    pause
    exit /b 1
)

echo.
echo ✅ 打包完成！
echo 📦 文件位置: %OUTPUT_DIR%\%OUTPUT_FILE%
echo.
echo 🎉 准备发布到 Chrome 应用商店：
echo 1. 访问 https://chrome.google.com/webstore/devconsole
echo 2. 点击 '新增项'
echo 3. 上传 %OUTPUT_DIR%\%OUTPUT_FILE%
echo 4. 填写商店信息（参考 STORE_DESCRIPTION.md）
echo 5. 提交审核
echo.
echo 📖 详细说明请查看 BUILD.md
echo.
pause
