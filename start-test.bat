@echo off
REM ---------------------------------------------------------------------------
REM  Start de TESTOMGEVING: aparte database (kassa_test) + aparte poorten
REM  (backend 3001, frontend 5174). Volledig los van je echte kassa (5173).
REM  Dubbelklik dit bestand. De testkassa opent op http://localhost:5174
REM ---------------------------------------------------------------------------
setlocal
set NODE=C:\Users\Gebruiker\tools\node-v22.20.0-win-x64
set PGBIN=C:\Users\Gebruiker\tools\pgsql\bin
set PGDATA=C:\Users\Gebruiker\tools\pgdata
set PROJ=%~dp0
set PATH=%NODE%;%PATH%

echo [1/3] PostgreSQL starten...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p 5432" -l "C:\Users\Gebruiker\tools\pg.log" start

echo [2/3] TEST-backend (poort 3001, database kassa_test) en TEST-frontend (poort 5174)...
start "Kassa TEST - backend" cmd /k "set PATH=%NODE%;%PATH% && set DATABASE_URL=postgresql://kassa:kassa@localhost:5432/kassa_test?schema=public && set PORT=3001 && cd /d %PROJ%backend && npx ts-node src/main.ts"
start "Kassa TEST - frontend" cmd /k "set PATH=%NODE%;%PATH% && set API_PORT=3001 && set FRONT_PORT=5174 && set VITE_OMGEVING=test && cd /d %PROJ%frontend && npx vite --port 5174"

echo [3/3] Wachten en browser openen...
timeout /t 10 >nul
start http://localhost:5174

echo.
echo TESTOMGEVING op http://localhost:5174  (database kassa_test - los van je echte data)
echo Aanmelden: kassa@winkel.be / kassa1234  (of beheerder@winkel.be)
echo Sluit de twee TEST-vensters om de testomgeving te stoppen.
endlocal
