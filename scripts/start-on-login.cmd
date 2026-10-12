@echo off
rem Khoi dong lai app Zalo CSKH + tunnel sau khi dang nhap Windows.
cd /d "%~dp0.."
call node_modules\.bin\pm2.cmd resurrect
