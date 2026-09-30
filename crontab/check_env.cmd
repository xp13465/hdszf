@echo off
chcp 65001 >nul 2>&1
setlocal

rem ============================================================================
rem  恒市值助手 · 环境体检（Windows 引导层）
rem
rem  装计划任务之前先跑这一遍：确认「这台机器到底能不能跑自动化」。
rem  本文件只是**薄启动器**：找到 node 后，真正的检查全部交给跨平台核心
rem  crontab\check_env.js（与 Linux 的 check_env.sh 共用同一套深层检查）。
rem  只读：不写文件、不改计划任务、不 commit。
rem
rem  用法（双击本文件，或在 cmd 里执行）：
rem    crontab\check_env.cmd           体检
rem    crontab\check_env.cmd --fix     缺 git / python 时用 winget 安装
rem
rem  退出码：0 = 无阻塞项；1 = 有阻塞项（现在装上去会白跑）
rem
rem  ⚠️ 本文件必须保持 CRLF 换行（.gitattributes 已锁定 *.cmd eol=crlf）。
rem ============================================================================

set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "ROOT=%%~fI"
set "CHECKER=%HERE%check_env.js"
set "TMPOUT=%TEMP%\_hdszf_checkenv.txt"

set "FIX=0"
if /i "%~1"=="--fix"  set "FIX=1"
if /i "%~1"=="-h"     goto :usage
if /i "%~1"=="--help" goto :usage

if not exist "%CHECKER%" (
  echo [x] 找不到检查脚本：%CHECKER%
  echo     确认仓库完整（git -C "%ROOT%" pull）
  exit /b 1
)

rem ---- 找 node（找不到就没法体检，这也正是第一个要修的问题）
set "NODE="
for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE set "NODE=%%p"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

if not defined NODE (
  echo.
  echo   恒市值助手 · 环境体检（Windows）
  echo.
  echo [x] 找不到 node.exe，一切都跑不起来（深度检查程序本身也是 node 写的）
  echo     修：winget install --id OpenJS.NodeJS.LTS -e
  echo     或到 https://nodejs.org 下载 LTS 安装后 **重开一个 cmd**
  echo.
  echo     装好后重跑：crontab\check_env.cmd
  if "%FIX%"=="1" (
    where winget >nul 2>&1
    if not errorlevel 1 (
      echo.
      echo     正在 winget 安装 Node LTS …
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    )
  )
  exit /b 1
)

rem ---- 体检（输出原样透传；重定向后没有颜色，不影响阅读）
"%NODE%" "%CHECKER%" > "%TMPOUT%" 2>&1
set "RC=%ERRORLEVEL%"
type "%TMPOUT%"

if "%FIX%"=="0" goto :cleanup
where winget >nul 2>&1
if errorlevel 1 (
  echo.
  echo   没有 winget，手工安装：https://git-scm.com/downloads  /  https://www.python.org/downloads/
  goto :cleanup
)
rem 提示行里只有「缺依赖」时才会出现对应的 winget 包 ID → 用它判断该装谁
findstr /c:"Git.Git" "%TMPOUT%" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   正在 winget 安装 Git …
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
)
findstr /c:"Python.Python.3.12" "%TMPOUT%" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   正在 winget 安装 Python …
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
)
echo.
echo   装完请 **重开一个 cmd**（PATH 才会更新），再重跑本脚本确认。

:cleanup
del "%TMPOUT%" >nul 2>&1
exit /b %RC%

:usage
echo 用法：crontab\check_env.cmd [--fix]
echo   （无参数）  体检，只读
echo   --fix       缺 git / python 时用 winget 自动安装
exit /b 0
