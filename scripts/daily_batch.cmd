@echo off
rem Stock Discovery V3 daily batch - ASCII only (Korean text breaks cmd parsing)
cd /d C:\Users\user\projects\stock-discovery-v3
set FETCH_MODE=live
set LOGDIR=%TEMP%\stock-discovery-v3
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
echo [%date% %time%] batch start >> "%LOGDIR%\batch.log"
node --env-file-if-exists=.env src\fetch_daily.js >> "%LOGDIR%\batch.log" 2>&1
node --env-file-if-exists=.env src\engine\discover.js >> "%LOGDIR%\batch.log" 2>&1
node --env-file-if-exists=.env src\fetch_market.js >> "%LOGDIR%\batch.log" 2>&1
node --env-file-if-exists=.env src\fetch_news.js >> "%LOGDIR%\batch.log" 2>&1
node --env-file-if-exists=.env src\notify.js >> "%LOGDIR%\batch.log" 2>&1
echo [%date% %time%] batch end >> "%LOGDIR%\batch.log"
