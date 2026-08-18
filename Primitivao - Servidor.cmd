@echo off
title Primitivao - Servidor
cd /d "%~dp0"
echo Subindo o servidor do Primitivao...
echo Deixe esta janela ABERTA. Fechar derruba o site.
echo.
node scripts/servidor-local.mjs
pause
