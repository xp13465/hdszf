@echo off
chcp 65001 >nul 2>&1
setlocal

rem ============================================================================
rem  恒市值助手 · 自动化健康检查（查看清单）
rem
rem  只读：不修改任何文件、不推送、不提交。
rem
rem  【唯一需要手工维护的地方】下面这行 node.exe 的绝对路径：
rem  Node 升级 / 换机器后，把 NODE 改成实际的 node.exe 路径即可。
rem ============================================================================
set "NODE=C:\Users\23405\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "ROOT=%%~fI"
set "RUNNER=%ROOT%\crontab\run_job.js"

echo.
"%NODE%" "%ROOT%\crontab\status.js" --online
echo.
pause
exit /b 0
