@echo off
setlocal

set "PORT=17890"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js or add node.exe to PATH, then run this script again.
  pause
  exit /b 1
)

echo Stopping any process listening on port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo Stopping PID %%P
    taskkill /F /PID %%P >nul 2>nul
  )
)

echo Starting session-analyzer from "%ROOT%" on port %PORT%...
start "session-analyzer:%PORT%" /D "%ROOT%" /min node server.js --repo "%ROOT%" --port %PORT%

echo Started. Open http://127.0.0.1:%PORT%/
endlocal
