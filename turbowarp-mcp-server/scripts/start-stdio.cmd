@echo off
setlocal
cd /d "%~dp0.."
if not exist "dist\index.js" (
  echo dist\index.js is missing. Run "npm install" and "npm run build" first. 1>&2
  exit /b 1
)
node "dist\index.js" --transport stdio %*
