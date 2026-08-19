@echo off
REM ---------------------------------------------------------------------------
REM  Start de kassa lokaal (portable Node + PostgreSQL, geen installatie nodig).
REM  Dubbelklik dit bestand. Er openen twee vensters (backend + frontend) en
REM  de kassa opent in je browser op http://localhost:5173
REM ---------------------------------------------------------------------------
setlocal
set NODE=C:\Users\Gebruiker\tools\node-v22.20.0-win-x64
set PGBIN=C:\Users\Gebruiker\tools\pgsql\bin
set PGDATA=C:\Users\Gebruiker\tools\pgdata
set PROJ=%~dp0
set PATH=%NODE%;%PATH%

echo [1/3] PostgreSQL starten...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p 5432" -l "C:\Users\Gebruiker\tools\pg.log" start

echo [2/3] Backend en frontend starten...
start "Kassa - backend" cmd /k "set PATH=%NODE%;%PATH% && cd /d %PROJ%backend && npm run start:dev"
start "Kassa - frontend" cmd /k "set PATH=%NODE%;%PATH% && cd /d %PROJ%frontend && npm run dev"

echo [3/3] Wachten en browser openen...
timeout /t 8 >nul
start http://localhost:5173

echo.
echo Klaar. Aanmelden met:  kassa@winkel.be  /  kassa1234
echo (Sluit de twee vensters om de kassa te stoppen.)
endlocal
