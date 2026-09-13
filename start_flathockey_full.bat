@echo off
setlocal

REM === CONFIG ===
set PROJECT_WIN=C:\Games\flathockey-move-rework
set PROJECT_WSL=/mnt/c/Games/flathockey-move-rework
set WSL_DISTRO=Ubuntu
set DEV_URL=http://localhost:5173

cd /d "%PROJECT_WIN%"

echo ===============================
echo   FlatHockey Full Dev Launcher
echo ===============================

echo [1/4] Starting npm dev server...
start "DEV" cmd /k "cd /d %PROJECT_WIN% && npm run dev"

timeout /t 3 > nul

echo [2/4] Opening localhost...
start "" "%DEV_URL%"

echo [3/4] Starting tmux studio (if exists)...
start "TMUX" cmd /k "wsl -d %WSL_DISTRO% bash -lc \"cd %PROJECT_WSL% && ~/fh-studio || bash\""

echo [4/4] Starting Claude...
start "CLAUDE" cmd /k "wsl -d %WSL_DISTRO% bash -lc \"cd %PROJECT_WSL% && claude || bash\""

start "FH_TERMINAL" cmd /k "cd /d %PROJECT_WIN%"

echo Done.