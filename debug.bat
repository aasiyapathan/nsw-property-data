@echo off
echo 🔍 NSW Property API Debug Info
echo ===========================
echo.
echo Current directory: %cd%
echo.
echo Files in current directory:
dir /b
echo.
echo ZIP files in nsw-data-source:
dir nsw-data-source\*.zip /b 2>nul || echo No ZIP files found
echo.
echo Node.js version:
node --version 2>nul || echo Node.js not found
echo.
echo NPM version:
npm --version 2>nul || echo NPM not found
echo.
echo Dependencies installed:
if exist "node_modules" (echo ✅ Yes) else (echo ❌ No)
echo.
echo Processed data exists:
if exist "processed-data" (echo ✅ Yes) else (echo ❌ No)
echo.
if exist "processed-data" (
  echo Files in processed-data:
  dir processed-data /b 2>nul || echo No files
)
echo.
pause
