@echo off
echo 📊 Data Check Results
echo ===================
echo.

REM Check for master index
if exist "processed-data\master-address-index.json" (
  echo ✅ Master address index: EXISTS
  for /f "tokens=3" %%i in ('find /c ":" processed-data\master-address-index.json') do echo    Addresses: %%i
) else (
  echo ❌ Master address index: MISSING
)
echo.

REM Check year folders
echo 📅 Year data:
for /d %%i in (processed-data\*) do (
  echo    %%~ni: 
  for /f %%j in ('dir "%%i\properties-*.json" /b 2^>nul ^| find /c /v ""') do echo %%j chunks
)
echo.

REM Show total size
echo 💾 Total processed data size:
for /f "tokens=3" %%i in ('dir processed-data /s /-c | find "File(s)"') do echo    %%i bytes
echo.
pause
