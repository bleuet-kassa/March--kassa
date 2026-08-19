@echo off
REM ---------------------------------------------------------------------------
REM  Automatische start van de kassa-SERVER (productie) bij het inloggen.
REM  Start PostgreSQL + backend (poort 3000) + kassa-website (poort 5173).
REM  Wordt aangeroepen door de snelkoppeling in de Windows-opstartmap.
REM  De kassa-PC opent zelf http://192.168.0.223:5173/kassa
REM ---------------------------------------------------------------------------
setlocal
set NODE=C:\Users\Gebruiker\tools\node-v22.20.0-win-x64
set PGBIN=C:\Users\Gebruiker\tools\pgsql\bin
set PGDATA=C:\Users\Gebruiker\tools\pgdata
set PROJ=%~dp0
set PATH=%NODE%;%PATH%

echo [1/3] PostgreSQL starten (indien nog niet actief)...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p 5432" -l "C:\Users\Gebruiker\tools\pg.log" start

echo [2/3] Backend starten (poort 3000, database kassa)...
start "Kassa-backend-3000" cmd /k "set PATH=%NODE%;%PATH% && cd /d %PROJ%backend && node node_modules\ts-node\dist\bin.js src/main.ts"

echo [3/3] Kassa-website starten (poort 5173)...
start "Kassa-frontend-5173" cmd /k "set PATH=%NODE%;%PATH% && cd /d %PROJ%frontend && npm run dev"

echo.
echo Klaar. De kassa is bereikbaar op http://192.168.0.223:5173/kassa
endlocal
