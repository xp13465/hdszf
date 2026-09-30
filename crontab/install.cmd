@echo off
chcp 65001 >nul 2>&1
setlocal

rem ============================================================================
rem  恒市值助手 · 计划任务一键安装（零 AI 依赖，纯脚本自动化）
rem
rem  【唯一需要手工维护的地方】下面这行 node.exe 的绝对路径：
rem  Node 升级 / 换机器后，把 NODE 改成实际的 node.exe 路径即可。
rem
rem  第 0 步会先跑 crontab\check_env.cmd 做环境体检（系统 / 依赖 / 仓库 / 凭据），
rem  有阻塞项就中止，免得「任务装上了却长期空跑」。体检可单独跑：
rem      crontab\check_env.cmd            只体检
rem      crontab\check_env.cmd --fix      缺 git / python 时用 winget 装
rem ============================================================================
set "NODE=C:\Users\23405\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "ROOT=%%~fI"
set "RUNNER=%ROOT%\crontab\run_job.js"

if not exist "%NODE%" (
  echo [错误] 找不到 node.exe：
  echo        %NODE%
  echo        请用记事本打开本文件，把 NODE 改成实际的 node.exe 路径。
  pause
  exit /b 1
)
if not exist "%RUNNER%" (
  echo [错误] 找不到运行器：
  echo        %RUNNER%
  pause
  exit /b 1
)

echo.
echo 目标仓库：%ROOT%
echo node     ：%NODE%
echo 运行器   ：%RUNNER%
echo.

rem ============================================================================
rem  第 0 步：环境体检（独立脚本 crontab\check_env.cmd，也可单独跑）
rem  有阻塞项就中止 —— 免得「任务装上了却长期空跑」。
rem ============================================================================
if not exist "%HERE%check_env.cmd" (
  echo [提示] 找不到 crontab\check_env.cmd，跳过环境体检（确认仓库完整：git -C "%ROOT%" pull）
  goto :start_install
)
echo 正在做环境体检（crontab\check_env.cmd）...
echo.
call "%HERE%check_env.cmd"
if errorlevel 1 (
  echo.
  echo [中止] 环境体检有阻塞项，先修好上面 ✗ 的项再装。
  echo        一键补依赖：crontab\check_env.cmd --fix
  echo        体检说明见 crontab\README.md 第 11 节
  echo.
  pause
  exit /b 1
)
echo.
echo 环境体检通过，继续安装。
echo.

:start_install
echo 正在注册计划任务（不需要管理员权限，不需要填密码）...
echo.

rem 任务一：本月至今（MTD）快照
rem   每小时唤醒一次（18:00-23:59），运行器内部保证「当天成功一次即停」，
rem   所以电脑晚点唤醒也能补跑；周末与休市日由运行器自动跳过。
schtasks /create /tn "hdszf-mtd" /tr "\"%NODE%\" \"%RUNNER%\" mtd" /sc HOURLY /mo 1 /st 18:00 /et 23:59 /f
if errorlevel 1 goto failed

rem 任务二：月度定稿固化
rem   每小时唤醒一次（09:00-23:59），运行器内部保证「每月 3 日起、当月成功一次即停」；
rem   失败则次日自动重试，直到成功。
schtasks /create /tn "hdszf-finalize" /tr "\"%NODE%\" \"%RUNNER%\" finalize" /sc HOURLY /mo 1 /st 09:00 /et 23:59 /f
if errorlevel 1 goto failed

echo.
echo [完成] 已注册两条计划任务：
echo.
schtasks /query /tn "hdszf-mtd" /fo LIST /v | findstr /i /c:"TaskName" /c:"Next Run Time" /c:"状态" /c:"下次运行时间"
echo.
schtasks /query /tn "hdszf-finalize" /fo LIST /v | findstr /i /c:"TaskName" /c:"Next Run Time" /c:"状态" /c:"下次运行时间"
echo.
echo 下一步（建议按顺序做一遍）：
echo   1) 手工试跑一次（真实取数、不写盘、不推送）：
echo      "%NODE%" "%RUNNER%" mtd --no-status -- --no-json
echo   1b) 想让今天的数据真实上线（会更新并推送）：
echo      "%NODE%" "%RUNNER%" mtd --force
echo   2) 查看健康报告：
echo      %ROOT%\crontab\status.cmd
echo   3) 不想装计划任务？手动跑法与频率见 crontab\README.md 第 3 节
echo      （每交易日 node crontab\run_job.js mtd --force；每月 node crontab\run_job.js finalize --force）
echo   4) 若电脑会关机/睡眠，可保持「仅在使用计算机时运行」；错过的时间点由
echo      运行器每小时唤醒 + 自带闸门自动补跑。
echo.
pause
exit /b 0

:failed
echo.
echo [失败] 计划任务注册未成功。常见原因与处置：
echo   1) 权限不足      -^> 右键本文件「以管理员身份运行」
echo   2) 任务已存在    -^> 先运行 uninstall.cmd 再重试（本命令带 /f 本应覆盖）
echo   3) 系统策略限制  -^> 打开「任务计划程序」图形界面手工创建，触发器设为
echo                       每天 18:00 起每小时重复 6 小时，操作 = node ^<运行器^> mtd
echo.
pause
exit /b 1
