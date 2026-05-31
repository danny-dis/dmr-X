@echo off
setlocal enabledelayedexpansion

:: DMR-X Installer for Windows
:: Downloads the latest release and sets up DMR-X

set REPO=dmr-x/dmr-x
set INSTALL_DIR=%USERPROFILE%\.dmr-x\bin
set DATA_DIR=%USERPROFILE%\.dmr-x

echo.
echo  ==========================================
echo   DMR-X - AI Model Router Proxy
echo  ==========================================
echo.

:: Check for bun (optional, for building from source)
where bun >nul 2>nul
if %errorlevel% equ 0 (
    echo  [OK] Bun runtime found
) else (
    echo  [INFO] Bun not found - using pre-built binary
)

:: Create directories
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

:: Detect architecture
set ARCH=x64
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set ARCH=arm64

:: Download latest release
echo.
echo  Downloading latest release...

:: Try curl first (available on Windows 10+)
where curl >nul 2>nul
if %errorlevel% equ 0 (
    :: Download the zip file
    curl -sL "https://github.com/%REPO%/releases/latest/download/dmrx-windows-%ARCH%.zip" -o "%TEMP%\dmrx.zip"
    if %errorlevel% neq 0 (
        echo  [ERROR] Download failed. Check your internet connection.
        exit /b 1
    )

    :: Extract
    echo  Extracting...
    powershell -Command "Expand-Archive -Path '%TEMP%\dmrx.zip' -DestinationPath '%INSTALL_DIR%' -Force"
    del "%TEMP%\dmrx.zip"
) else (
    echo  [ERROR] curl not found. Please install curl or download manually.
    echo  Download from: https://github.com/%REPO%/releases/latest
    exit /b 1
)

:: Verify installation
if exist "%INSTALL_DIR%\dmrx.exe" (
    echo.
    echo  [OK] DMR-X installed to %INSTALL_DIR%\dmrx.exe
) else (
    echo  [ERROR] Installation failed - dmrx.exe not found
    exit /b 1
)

:: Add to PATH if not already there
echo %PATH% | findstr /i /c:"%INSTALL_DIR%" >nul
if %errorlevel% neq 0 (
    echo.
    echo  Adding to PATH...
    setx PATH "%PATH%;%INSTALL_DIR%" >nul 2>nul
    echo  [OK] Added %INSTALL_DIR% to PATH
    echo  [NOTE] Restart your terminal for PATH changes to take effect
)

:: Create a start script
(
    echo @echo off
    echo echo Starting DMR-X...
    echo echo Open http://localhost:3000 in your browser
    echo echo Press Ctrl+C to stop
    echo echo.
    echo "%INSTALL_DIR%\dmrx.exe"
) > "%INSTALL_DIR%\start-dmrx.bat"

echo.
echo  ==========================================
echo   Installation complete!
echo  ==========================================
echo.
echo  To start DMR-X:
echo    1. Open a new terminal
echo    2. Run: dmrx
echo    3. Open http://localhost:3000
echo.
echo  To add API keys:
echo    - Go to Provider Keys page in the UI
echo    - Add your OpenAI, Anthropic, etc. keys
echo.
echo  Data directory: %DATA_DIR%
echo.
