@echo off
title Banco de vagas
cd /d "%~dp0server"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
node index.js
pause
