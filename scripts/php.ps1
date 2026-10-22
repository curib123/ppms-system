# Run the local PHP CLI with MySQLi support without changing php.ini.
# Examples:
#   .\scripts\php.ps1 index.php setup check
#   .\scripts\php.ps1 -S 127.0.0.1:8085 -t public public/router.php
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$phpExecutable = (Get-Command php -ErrorAction Stop).Source
$phpOptions = @()
$phpModules = & $phpExecutable -m
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the PHP installation.' }
if ($phpModules -notcontains 'mysqli') {
    $phpOptions += @('-d', 'extension=mysqli')
    $phpModules = & $phpExecutable @phpOptions -m
    if ($LASTEXITCODE -ne 0 -or $phpModules -notcontains 'mysqli') {
        throw 'Install the PHP mysqli extension before running this application.'
    }
}

Push-Location -LiteralPath $projectDirectory
try {
    & $phpExecutable @phpOptions @args
    $phpExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $phpExitCode
