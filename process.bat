@echo off
REM process.bat - Process NSW Property Data with detailed logging

echo.
echo 🚀 NSW Property Data Processing
echo ===============================
echo.

REM Check if we're in the right directory
if not exist "server.js" (
    echo ❌ Error: server.js not found
    echo Make sure you're running this from the nsw-property-api directory
    echo Current directory: %cd%
    pause
    exit /b 1
)

REM Check if data source exists
if not exist "nsw-data-source" (
    echo ❌ Error: nsw-data-source directory not found
    echo Creating nsw-data-source directory...
    mkdir nsw-data-source
)

REM Check for ZIP files
echo 🔍 Checking for ZIP files in nsw-data-source...
dir nsw-data-source\*.zip /b >nul 2>&1
if errorlevel 1 (
    echo ❌ No ZIP files found in nsw-data-source\
    echo.
    echo Please copy your NSW property ZIP files to: nsw-data-source\
    echo Example files: 2020.zip, 2021.zip, 2022.zip, etc.
    echo.
    pause
    exit /b 1
) else (
    echo ✅ ZIP files found:
    dir nsw-data-source\*.zip /b
    echo.
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo ⚠️ node_modules not found. Installing dependencies first...
    echo Running: npm install
    call npm install
    if errorlevel 1 (
        echo ❌ npm install failed
        pause
        exit /b 1
    )
    echo ✅ Dependencies installed
    echo.
)

REM Check if process-data.js exists
if not exist "process-data.js" (
    echo ❌ Error: process-data.js not found
    echo The setup may not have completed properly
    pause
    exit /b 1
)

REM Create output directory
if not exist "processed-data" (
    echo 📁 Creating processed-data directory...
    mkdir processed-data
)

echo 🚀 Starting data processing...
echo This may take several minutes depending on data size...
echo.

REM Run the processing with verbose output
node process-data.js

REM Check if processing was successful
if errorlevel 1 (
    echo.
    echo ❌ Processing failed with error code %errorlevel%
    echo.
    echo Common issues:
    echo - ZIP files are corrupted
    echo - Insufficient disk space
    echo - Invalid DAT file format
    echo.
    echo Check the error message above for details
    pause
    exit /b 1
)

echo.
echo ✅ Processing completed successfully!
echo.

REM Check if output files were created
if exist "processed-data\master-address-index.json" (
    echo ✅ Master index created
) else (
    echo ⚠️ Master index not found - processing may have failed
)

REM Count processed files
echo 📊 Processing Results:
echo.

for /f %%i in ('dir processed-data\*.json /s /b 2^>nul ^| find /c /v ""') do (
    echo    JSON files created: %%i
)

for /f %%i in ('dir processed-data\* /s /a-d 2^>nul ^| find /c /v ""') do (
    echo    Total files: %%i
)

echo.
echo 📁 Output location: %cd%\processed-data\
echo.
echo 🔄 Next steps:
echo    1. Upload processed-data folder to GitHub
echo    2. Use the GitHub repository URL in your Replit webapp
echo.

pause

REM ===== debug.bat - Debugging helper =====
echo @echo off> debug.bat
echo echo 🔍 NSW Property API Debug Info>> debug.bat
echo echo ===========================>> debug.bat
echo echo.>> debug.bat
echo echo Current directory: %%cd%%>> debug.bat
echo echo.>> debug.bat
echo echo Files in current directory:>> debug.bat
echo dir /b>> debug.bat
echo echo.>> debug.bat
echo echo ZIP files in nsw-data-source:>> debug.bat
echo dir nsw-data-source\*.zip /b 2^>nul ^|^| echo No ZIP files found>> debug.bat
echo echo.>> debug.bat
echo echo Node.js version:>> debug.bat
echo node --version 2^>nul ^|^| echo Node.js not found>> debug.bat
echo echo.>> debug.bat
echo echo NPM version:>> debug.bat
echo npm --version 2^>nul ^|^| echo NPM not found>> debug.bat
echo echo.>> debug.bat
echo echo Dependencies installed:>> debug.bat
echo if exist "node_modules" (echo ✅ Yes) else (echo ❌ No)>> debug.bat
echo echo.>> debug.bat
echo echo Processed data exists:>> debug.bat
echo if exist "processed-data" (echo ✅ Yes) else (echo ❌ No)>> debug.bat
echo echo.>> debug.bat
echo if exist "processed-data" (>> debug.bat
echo   echo Files in processed-data:>> debug.bat
echo   dir processed-data /b 2^>nul ^|^| echo No files>> debug.bat
echo )>> debug.bat
echo echo.>> debug.bat
echo pause>> debug.bat

REM ===== check-data.bat - Quick data checker =====
echo @echo off> check-data.bat
echo echo 📊 Data Check Results>> check-data.bat
echo echo ===================>> check-data.bat
echo echo.>> check-data.bat
echo.>> check-data.bat
echo REM Check for master index>> check-data.bat
echo if exist "processed-data\master-address-index.json" (>> check-data.bat
echo   echo ✅ Master address index: EXISTS>> check-data.bat
echo   for /f "tokens=3" %%%%i in ('find /c ":" processed-data\master-address-index.json') do echo    Addresses: %%%%i>> check-data.bat
echo ) else (>> check-data.bat
echo   echo ❌ Master address index: MISSING>> check-data.bat
echo )>> check-data.bat
echo echo.>> check-data.bat
echo.>> check-data.bat
echo REM Check year folders>> check-data.bat
echo echo 📅 Year data:>> check-data.bat
echo for /d %%%%i in (processed-data\*) do (>> check-data.bat
echo   echo    %%%%~ni: >> check-data.bat
echo   for /f %%%%j in ('dir "%%%%i\properties-*.json" /b 2^^^>nul ^^^| find /c /v ""') do echo %%%%j chunks>> check-data.bat
echo )>> check-data.bat
echo echo.>> check-data.bat
echo.>> check-data.bat
echo REM Show total size>> check-data.bat
echo echo 💾 Total processed data size:>> check-data.bat
echo for /f "tokens=3" %%%%i in ('dir processed-data /s /-c ^| find "File(s)"') do echo    %%%%i bytes>> check-data.bat
echo echo.>> check-data.bat
echo pause>> check-data.bat

echo.
echo 🛠️ Helper tools created:
echo    debug.bat - Shows system info and troubleshooting
echo    check-data.bat - Verifies processed data
echo.

REM ===== Enhanced process-data.js with better error handling =====
echo // Enhanced process-data.js with detailed logging> process-data-verbose.js
echo const NSWPropertyAPI = require('./server.js');>> process-data-verbose.js
echo const fs = require('fs');>> process-data-verbose.js
echo const path = require('path');>> process-data-verbose.js
echo.>> process-data-verbose.js
echo async function main() {>> process-data-verbose.js
echo   console.log('🚀 NSW Property Data Processing Started');>> process-data-verbose.js
echo   console.log('======================================');>> process-data-verbose.js
echo   console.log();>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   // Check data source>> process-data-verbose.js
echo   const dataPath = './nsw-data-source';>> process-data-verbose.js
echo   if (!fs.existsSync(dataPath)) {>> process-data-verbose.js
echo     console.error('❌ nsw-data-source directory not found');>> process-data-verbose.js
echo     process.exit(1);>> process-data-verbose.js
echo   }>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   // List ZIP files>> process-data-verbose.js
echo   const files = fs.readdirSync(dataPath).filter(f =^> f.toLowerCase().endsWith('.zip'));>> process-data-verbose.js
echo   console.log(`📦 Found ${files.length} ZIP files:`);>> process-data-verbose.js
echo   files.forEach(f =^> console.log(`   - ${f}`));>> process-data-verbose.js
echo   console.log();>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   if (files.length === 0) {>> process-data-verbose.js
echo     console.error('❌ No ZIP files found in nsw-data-source/');>> process-data-verbose.js
echo     console.log('Please add your NSW property data ZIP files');>> process-data-verbose.js
echo     process.exit(1);>> process-data-verbose.js
echo   }>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   const config = {>> process-data-verbose.js
echo     githubUser: 'your-username',>> process-data-verbose.js
echo     githubRepo: 'nsw-property-data',>> process-data-verbose.js
echo     dataSourcePath: dataPath,>> process-data-verbose.js
echo     outputPath: './processed-data'>> process-data-verbose.js
echo   };>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   console.log('⚙️ Configuration:');>> process-data-verbose.js
echo   console.log(`   Data source: ${config.dataSourcePath}`);>> process-data-verbose.js
echo   console.log(`   Output: ${config.outputPath}`);>> process-data-verbose.js
echo   console.log();>> process-data-verbose.js
echo.>> process-data-verbose.js
echo   try {>> process-data-verbose.js
echo     const api = new NSWPropertyAPI(config);>> process-data-verbose.js
echo     await api.processDataForGitHub();>> process-data-verbose.js
echo     console.log();>> process-data-verbose.js
echo     console.log('✅ Processing completed successfully!');>> process-data-verbose.js
echo   } catch (error) {>> process-data-verbose.js
echo     console.error();>> process-data-verbose.js
echo     console.error('❌ Processing failed:');>> process-data-verbose.js
echo     console.error(error.message);>> process-data-verbose.js
echo     console.error();>> process-data-verbose.js
echo     if (error.stack) {>> process-data-verbose.js
echo       console.error('Stack trace:');>> process-data-verbose.js
echo       console.error(error.stack);>> process-data-verbose.js
echo     }>> process-data-verbose.js
echo     process.exit(1);>> process-data-verbose.js
echo   }>> process-data-verbose.js
echo }>> process-data-verbose.js
echo.>> process-data-verbose.js
echo main();>> process-data-verbose.js

echo.
echo 🔧 Created enhanced processing script: process-data-verbose.js
echo    Use this for detailed error messages if processing fails