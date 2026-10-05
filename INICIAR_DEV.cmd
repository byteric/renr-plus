@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\.bin\pnpm.cmd" (
  echo Dependencias ausentes. Consulte README.md antes de iniciar.
  pause
  exit /b 1
)
call "node_modules\.bin\pnpm.cmd" setup:local
if errorlevel 1 goto :erro
call "node_modules\.bin\pnpm.cmd" prisma:generate
if errorlevel 1 goto :erro
echo Interface: http://127.0.0.1:5173
echo API e documentacao: http://127.0.0.1:3000/api/docs
echo Para encerrar, pressione Ctrl+C neste terminal.
call "node_modules\.bin\pnpm.cmd" dev
exit /b %errorlevel%
:erro
echo Nao foi possivel preparar o ambiente. Confira a mensagem acima.
pause
exit /b 1
