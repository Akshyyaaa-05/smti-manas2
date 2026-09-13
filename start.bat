@echo off
rem Double-click to start the MANAS Care Portal, then use the browser window that opens.
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
%PY% server.py %*
pause
