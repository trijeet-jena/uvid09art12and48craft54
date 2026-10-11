@echo off
rem ============================================================
rem  UVID Stationery Store - one-click launcher for Windows
rem  Starts the server, then opens the customer site and the
rem  admin panel in your browser.
rem ============================================================
title UVID Stationery Store
cd /d "%~dp0server"
if errorlevel 1 (
  echo.
  echo  [X] Could not open this project's server folder.
  echo      Extract the ZIP first, then run this file from the stationery folder.
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] Node.js is not installed.
  echo      Download and install the LTS version from https://nodejs.org
  echo      then run this file again.
  echo.
  pause
  exit /b 1
)

netstat -ano -p tcp | findstr /R /C:":8787 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo  [!] Another store server is already using port 8787.
  echo      Close the older UVID server window, then run this file again.
  echo      This prevents your browser from opening an older login screen.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  First run: installing dependencies. One time, about a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [X] npm install failed. Check your internet connection and run again.
    echo.
    pause
    exit /b 1
  )
)

echo  Starting UVID store on http://localhost:8787 ...
start "" http://localhost:8787/
start "" http://localhost:8787/admin/
node src/deploy-start.js
if errorlevel 1 (
  echo.
  echo  [!] Server exited with an error. Close any older UVID server window
  echo      and run this file again.
)

echo.
echo  The server was closed. Press any key to exit.
pause >nul
