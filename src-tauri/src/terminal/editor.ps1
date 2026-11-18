# Installed only inside the interactive PowerShell process.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { return }
$global:__oriaSession = $env:ORIA_TERMINAL_SESSION
Remove-Item Env:ORIA_TERMINAL_SESSION
$global:__oriaPromptNumber = 0
$global:__oriaLastCommand = $null
$global:__oriaReadLineHistory = $false
function global:Write-OriaReply([string]$kind, [string]$revision, [string[]]$fields) {
    $encoded = ''
    if ($fields -and $fields.Count) {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($fields -join [char]0) + [char]0)
        $encoded = [Convert]::ToBase64String($bytes)
    }
    [Console]::Write(([string][char]27 + ']6973;' + $global:__oriaSession + ';' + $kind + ';' + $revision + ';' + $encoded + [char]7))
}
try {
    $null = Get-PSReadLineOption -ErrorAction Stop
    if ($env:ORIATUNNEL_TEST_DATA_DIR) {
        $testHistory = Join-Path $env:ORIATUNNEL_TEST_DATA_DIR 'ConsoleHost_history.txt'
        Set-PSReadLineOption -HistorySavePath $testHistory -ErrorAction Stop
    }
    # PSReadLine loads its history on the first native read. Finish an empty
    # line before publishing the editor so both readers never compete for keys.
    $enter = Get-PSReadLineKeyHandler -Bound -ErrorAction Stop | Where-Object Key -eq 'Enter'
    if ($enter.Function -in 'AcceptLine','ValidateAndAcceptLine') {
        Write-OriaReply initPowerShell 0
        $null = PSReadLine\PSConsoleHostReadLine
        $null = [Microsoft.PowerShell.PSConsoleReadLine]::GetHistoryItems()
        $global:__oriaReadLineHistory = $true
    }
} catch {}
$__oriaInitialReader = Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue
$global:__oriaNativeReader = if ($__oriaInitialReader) { $__oriaInitialReader.ScriptBlock }
Remove-Variable __oriaInitialReader
$global:__oriaNativePrompt = (Get-Command prompt).ScriptBlock
function global:prompt {
    if ($PWD.Provider.Name -ne 'FileSystem' -or $NestedPromptLevel -gt 0) {
        return (& $global:__oriaNativePrompt)
    }
    return ([string][char]27 + '[0m')
}
function global:PSConsoleHostReadLine {
    if ($PWD.Provider.Name -ne 'FileSystem' -or $NestedPromptLevel -gt 0) {
        if ($global:__oriaNativeReader) { return (& $global:__oriaNativeReader) }
        return [Console]::ReadLine()
    }
    $eligible = '0'
    if ($global:__oriaLastCommand) {
        $last = Get-History -Count 1
        if ($last -and $last.CommandLine -ceq $global:__oriaLastCommand) { $eligible = '1' }
        $global:__oriaLastCommand = $null
    }
    $venv = if ($env:VIRTUAL_ENV) { Split-Path -Leaf $env:VIRTUAL_ENV }
    $global:__oriaPromptNumber++
    $seqReady = $global:__oriaPromptNumber
    $marker = 'oria-' + $global:__oriaSession.Substring($global:__oriaSession.Length - 12) + '-' + $seqReady
    # OSC can reach xterm before ConPTY paints the last command. Keep this
    # concealed line on the console until the viewer has consumed its cells.
    [Console]::Write(([Environment]::NewLine + [char]27 + '[8m' + $marker + [char]27 + '[0m'))
    Write-OriaReply readyPowerShell $seqReady @($PWD.ProviderPath, $HOME, $eligible, $venv, $env:CONDA_DEFAULT_ENV, $env:PYENV_VERSION)
    while ($true) {
        $line = [Text.StringBuilder]::new()
        do {
            $key = [Console]::ReadKey($true).KeyChar
            if ($key -eq [char]10 -or $key -eq [char]13) { break }
            if ($key -ne [char]0) { [void]$line.Append($key) }
        } while ($true)
        if ($line.ToString() -notmatch '^#oria (\w+) (\d+) ([A-Za-z0-9+/=]*)$') { continue }
        $op = $Matches[1]
        $seq = $Matches[2]
        try {
            $value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[3]))
            switch ($op) {
                'ack' {
                    if ($seq -eq $seqReady) {
                        # Keep a one-cell concealed boundary above the next command's output.
                        # A ConPTY repaint during resize can put blank rows into scrollback.
                        [Console]::Write(([string][char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H' + [char]27 + '[8m>' + [char]27 + '[0m' + [Environment]::NewLine))
                        if ($seqReady -eq 1 -and $global:__oriaReadLineHistory) {
                            $records = [Microsoft.PowerShell.PSConsoleReadLine]::GetHistoryItems()
                            $length = 0
                            $recent = for ($i = $records.Count - 1; $i -ge [Math]::Max(0, $records.Count - 200); $i--) {
                                $entry = $records[$i].CommandLine
                                $length += $entry.Length
                                if ($length -gt 65536) { break }
                                $entry
                            }
                            Write-OriaReply history 0 @($recent)
                        }
                    }
                }
                'logout' { exit }
                'run' {
                    $global:__oriaLastCommand = $value
                    if ($global:__oriaReadLineHistory) {
                        try {
                            [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($value)
                            $records = [Microsoft.PowerShell.PSConsoleReadLine]::GetHistoryItems()
                            if (!$records -or $records[-1].CommandLine -cne $value) { $global:__oriaLastCommand = $null }
                        } catch {}
                    }
                    Write-OriaReply release $seq @('accepted')
                    return $value
                }
                'raw' {
                    Write-OriaReply release $seq
                    if ($global:__oriaNativeReader) { return (& $global:__oriaNativeReader) }
                    return [Console]::ReadLine()
                }
                'cd' {
                    Set-Location -LiteralPath $value -ErrorAction Stop
                    Write-OriaReply cwd $seq @($PWD.ProviderPath)
                }
                'drives' {
                    $roots = Get-PSDrive -PSProvider FileSystem -ErrorAction Stop |
                        Where-Object { $_.Name -match '^[a-z]$' } |
                        ForEach-Object { $_.Name + ':\' }
                    Write-OriaReply matches $seq @($roots)
                }
                'commands' {
                    $prefix = [Management.Automation.WildcardPattern]::Escape($value)
                    $names = Get-Command -Name ($prefix + '*') -ErrorAction SilentlyContinue |
                        Select-Object -First 256 -ExpandProperty Name
                    Write-OriaReply matches $seq @($names)
                }
                { $_ -in 'files','dirs','list' } {
                    $dir = $value
                    $prefix = ''
                    $kind = 'list'
                    if ($op -ne 'list') {
                        $kind = 'matches'
                        $at = $value.LastIndexOfAny([char[]]'\/')
                        $dir = if ($at -lt 0) { '.' } else { $value.Substring(0, $at + 1) }
                        $prefix = $value.Substring($at + 1)
                    }
                    $items = Get-ChildItem -LiteralPath $dir -ErrorAction Stop |
                        Where-Object { ($_.PSIsContainer -or $op -eq 'files') -and $_.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
                        Select-Object -First 512 |
                        ForEach-Object { if ($_.PSIsContainer) { $_.Name + '\' } else { $_.Name } }
                    Write-OriaReply $kind $seq @($items)
                }
            }
        } catch { Write-OriaReply error $seq }
    }
}
