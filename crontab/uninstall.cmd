@echo off
chcp 65001 >nul 2>&1
setlocal

rem ============================================================================
rem  恒市值助手 · 计划任务卸载
rem
rem  【唯一需要手工维护的地方】下面这行 node.exe 的绝对路径：
rem  Node 升级 / 换机器后，把 NODE 改成实际的 node.exe 路径即可。
rem ============================================================================
set "NODE=C:\Users\23405\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "ROOT=%%~fI"
set "RUNNER=%ROOT%\crontab\run_job.js"

echo.
echo 正在删除计划任务...
schtasks /delete /tn "hdszf-mtd" /f
schtasks /delete /tn "hdszf-finalize" /f
echo.
echo [完成] 两条任务已删除（若提示「找不到指定的任务」，说明本来就没注册）。
echo        日志与状态文件保留在：%ROOT%\..\_hdszf_logs
echo.
pause
exit /b 0
