@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\.bin\pnpm.cmd" (
  echo Dependencias ausentes. Consulte README.md.
  pause
  exit /b 1
)
call "node_modules\.bin\pnpm.cmd" setup:local
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" infra:up
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" infra:verify
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" db:deploy
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" build
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" db:seed
if errorlevel 1 goto :erro
call "INICIAR_DEV.cmd"
exit /b %errorlevel%
:erro
echo O ambiente nao iniciou. Os volumes existentes foram preservados.
pause
exit /b 1
