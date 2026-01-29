@echo off
setlocal
cd /d "%~dp0"
echo Installing dependencies...
if not exist package.json (
  npm init -y
)
npm install puppeteer pptxgenjs
echo Running capture...
node capture.js
echo Done.
pause
