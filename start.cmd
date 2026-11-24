@echo off
cd /d "%~dp0server"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting ADAQ auth server on http://localhost:4000
node server.js
pause