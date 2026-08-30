@echo off
rem ============================================================
rem  Tian Yuan - dev server launcher (Windows native, no Git Bash needed)
rem  Usage:
rem    start.bat              start dev server (Ctrl+C to quit, port auto-released)
rem    start.bat /noopen      start without opening the browser
rem    start.bat stop         stop the running server
rem    start.bat status       show running state
rem    start.bat restart      stop then start
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=5199"
set "CMD=start"
set "OPEN=1"

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="start"   (set "CMD=start"   & shift & goto parse)
if /i "%~1"=="stop"    (set "CMD=stop"    & shift & goto parse)
if /i "%~1"=="status"  (set "CMD=status"  & shift & goto parse)
if /i "%~1"=="restart" (set "CMD=restart" & shift & goto parse)
if /i "%~1"=="/noopen" (set "OPEN=0"      & shift & goto parse)
echo Unknown argument: %~1
echo Usage: start.bat [start^|stop^|status^|restart] [/noopen]
exit /b 1
:parsed

if "%CMD%"=="stop"    goto do_stop
if "%CMD%"=="status"  goto do_status
if "%CMD%"=="restart" goto do_restart
goto do_start

rem ===== find PID listening on the port (empty PID = not running) =====
:getpid
set "PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr /i "LISTENING"') do (
  if not defined PID set "PID=%%p"
)
goto :eof

rem ===== kill process tree, then wait for port release (max ~6s) =====
:kill_port
call :getpid
if not defined PID goto :eof
echo Stopping server (port %PORT%, PID !PID!) ...
taskkill /F /T /PID !PID! >nul 2>&1
for /l %%i in (1,1,20) do (
  call :getpid
  if not defined PID goto :eof
  ping -n 1 -w 300 192.0.2.1 >nul 2>&1
)
goto :eof

:do_stop
call :kill_port
call :getpid
if defined PID (echo Timeout: port %PORT% still busy, check Task Manager.) else (echo Stopped. Port %PORT% released.)
exit /b 0

:do_status
call :getpid
if defined PID (echo Running: http://localhost:%PORT% - PID !PID!) else (echo Not running. Port %PORT% is free.)
exit /b 0

:do_restart
call :kill_port

:do_start
rem idempotent: clear any orphan on the port first
call :getpid
if defined PID (
  echo Port %PORT% already in use - PID !PID! - stopping old instance ...
  call :kill_port
)
if not exist node_modules (
  echo First run: installing dependencies ...
  call npm install
  if errorlevel 1 ( echo npm install failed. & exit /b 1 )
)
echo Starting dev server: http://localhost:%PORT%
echo Quit: press Ctrl+C here (then Y), or run  start.bat stop  in another window.
if "%OPEN%"=="1" start /b "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:%PORT%/"
call npm run dev
rem orphan guard: clean up if the Ctrl+C left anything behind
call :getpid
if defined PID (
  echo Orphan process detected - PID !PID! - cleaning up ...
  call :kill_port
)
echo Exited. Port %PORT% released.
exit /b 0
