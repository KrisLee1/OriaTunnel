# PowerShell 7. Rebuild Tauri's generated NSIS script with a disposable product
# identity; keep its production install/uninstall sections and VNC hook intact.
[CmdletBinding(DefaultParameterSetName='Install')]
param(
  [Parameter(Mandatory,ParameterSetName='Install')][string]$Template,
  [Parameter(ParameterSetName='Install')][string]$MakeNSIS = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe",
  [Parameter(ParameterSetName='Install')][switch]$CheckSettings,
  [Parameter(Mandatory,ParameterSetName='Dispatch')][string]$Class,
  [Parameter(Mandatory,ParameterSetName='Dispatch')][string]$Url
)
$ErrorActionPreference = 'Stop'
if ($PSCmdlet.ParameterSetName -eq 'Dispatch') {
  if ($Class -notmatch '^OriaV4[a-f0-9]{12}\.(VNC|External)$') { throw 'Invalid fixture class' }
  if ($Url -notmatch '^vnc://127\.0\.0\.1:\d+/$') { throw 'Invalid fixture target' }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FixtureShell {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Execute {
    public int size, mask; public IntPtr hwnd; public string verb,file,args,dir;
    public int show; public IntPtr instance,idList; public string cls;
    public IntPtr key; public uint hotkey; public IntPtr icon,process;
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool ShellExecuteEx(ref Execute info);
}
'@
  $info = [FixtureShell+Execute]::new()
  $info.size = [Runtime.InteropServices.Marshal]::SizeOf($info)
  $info.mask = 0x101 # SEE_MASK_NOASYNC | SEE_MASK_CLASSNAME
  $info.cls = $Class
  $info.file = $Url
  $info.show = 1
  if (![FixtureShell]::ShellExecuteEx([ref]$info)) { throw [ComponentModel.Win32Exception]::new() }
  return
}

$Template = (Resolve-Path -LiteralPath $Template).Path
$original = Get-Content -Raw -LiteralPath $Template
$name = 'OriaV4' + [guid]::NewGuid().ToString('N').Substring(0,12)
$scheme = 'qa-vnc-' + $name.Substring(6)
$schemeKey = "HKCU:\Software\Classes\$scheme"
$root = Join-Path (Get-Location).Path "outputs/vnc-v4/$name"
$dest = Join-Path $root 'Installed viewer'
$build = Join-Path $root 'nsis'
$exe = Join-Path $dest "$name.exe"
$appClass = "HKCU:\Software\Classes\$name.VNC"
$externalClass = "HKCU:\Software\Classes\$name.External"
$cap = "HKCU:\Software\$name\Capabilities"
$registered = 'HKCU:\Software\RegisteredApplications'
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name"
$node = (Get-Command node.exe).Source
$driver = Join-Path $PSScriptRoot 'vnc-installed-links.mjs'
$checks = [Collections.Generic.List[string]]::new()
function Check($condition, [string]$message) {
  if (!$condition) { throw $message }
  $checks.Add($message)
}
function Value([string]$path,[string]$key='') {
  if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).GetValue($key) }
}
function UserChoice {
  $choice = 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\vnc\UserChoice'
  "$(Value $choice 'ProgId')|$(Value $choice 'Hash')|$(Value 'HKCU:\Software\Classes\vnc\shell\open\command')"
}
function Build-Package([string]$version) {
  $spec = $original
  $overrides = @{
    PRODUCTNAME=$name; MANUFACTURER=$name; MAINBINARYNAME=$name; BUNDLEID="org.oria.v4.$name";
    MAINBINARYSRCPATH=(Join-Path $root "$name.exe"); VERSION=$version; VERSIONWITHBUILD="$version.0";
    OUTFILE=(Join-Path $root "$version-setup.exe")
  }
  foreach ($key in $overrides.Keys) {
    $pattern = '(?m)^!define '+$key+' "[^"\r\n]*"'
    if ([regex]::Matches($spec,$pattern).Count -ne 1) {throw "Unexpected NSIS define: $key"}
    $spec = [regex]::Replace($spec,$pattern,{param($m) "!define $key `"$($overrides[$key])`""})
  }
  $path = Join-Path $build 'v4.nsi'
  Set-Content -LiteralPath $path -Value ("!define ORIA_VNC_SCHEME `"$scheme`"" + [Environment]::NewLine + $spec) -Encoding utf8
  & $MakeNSIS /V1 /INPUTCHARSET UTF8 $path
  if ($LASTEXITCODE) {throw "makensis failed: $LASTEXITCODE"}
}
function Run-Setup($path,$arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(90000)) { $process.Kill(); throw "Timeout: $path" }
  if ($process.ExitCode) { throw "$path exited with $($process.ExitCode)" }
}
function Remove-Install {
  $uninstaller = Join-Path $dest 'uninstall.exe'
  if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $uninstaller)) { Run-Setup $uninstaller "/S _?=$dest" }
}
function Verify-Install($version) {
  Check ((Value $registered $name) -eq "Software\$name\Capabilities") "RegisteredApplications $version"
  Check ((Value "$cap\URLAssociations" $scheme) -eq "$name.VNC") "VNC capability $version"
  Check (('URL Protocol' -in (Get-Item -LiteralPath $schemeKey).GetValueNames())) "scheme recognized as a URL protocol $version"
  Check ((Value "$appClass\shell\open\command") -eq "`"$exe`" `"%1`"") "quoted open command $version"
  Check ((Value "$appClass\DefaultIcon") -eq "`"$exe`",0") "class icon $version"
  Check ((Value $cap 'ApplicationIcon') -eq "`"$exe`",0") "candidate icon $version"
  Check ((Value $uninstallKey 'DisplayVersion') -eq $version) "installed version $version"
  Check ((Get-FileHash -LiteralPath $exe).Hash -eq $binaryHash) "installed payload $version"
  Check ((UserChoice) -ceq $before) "preserved user's VNC association $version"
}
function Test-SettingsPage {
  Add-Type -AssemblyName UIAutomationClient
  $existing = @(Get-Process SystemSettings -ErrorAction SilentlyContinue | ForEach-Object Id)
  Start-Process "ms-settings:defaultapps?registeredAppUser=$name" -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  $page = $null
  try {
    do {
      Start-Sleep -Milliseconds 350
      $settings = Get-Process SystemSettings -ErrorAction SilentlyContinue
      $frames = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
      foreach ($frame in $frames) {
        if ($frame.Current.ProcessId -notin $settings.Id -and $frame.Current.ClassName -ne 'ApplicationFrameWindow') {continue}
        $items = $frame.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
        if ($frame.Current.ProcessId -notin $settings.Id -and !($items | Where-Object {$_.Current.ProcessId -in $settings.Id} | Select-Object -First 1)) {continue}
        $page = $frame
        $names = @($items | ForEach-Object {$_.Current.Name})
        if (($names -match [regex]::Escape($name)) -and ($names -match [regex]::Escape($scheme))) {
          Check $true 'Windows Default Apps page shows installed candidate and isolated link type'
          return
        }
      }
    } while ([DateTime]::UtcNow -lt $deadline)
    $matched = $names -match 'Oria|VNC|默认应用|Default apps' | Select-Object -Unique -First 12
    throw "Default Apps did not show the candidate and protocol. Matching labels: $($matched -join ', ')"
  } finally {
    if ($page -and $existing.Count -eq 0) {
      $pattern=$page.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
      $pattern.Close()
    }
  }
}
if ($original -notmatch '(?m)^!define INSTALLMODE "currentUser"' -or $original -notmatch '(?m)^!define MAINBINARYSRCPATH "([^"]+)"') { throw 'Expected per-user Tauri installer' }
$source = $Matches[1]
if (!(Test-Path $source) -or (Split-Path (Split-Path $source) -Leaf) -ne 'debug' -or $original -notmatch 'vnc-installer\.nsh"') { throw 'Supply a debug build with isolated-data support and the VNC hook' }
$binaryHash = (Get-FileHash -LiteralPath $source).Hash
$before = UserChoice
New-Item -ItemType Directory -Path $root | Out-Null
Copy-Item -LiteralPath (Split-Path $Template) -Destination $build -Recurse
Copy-Item -LiteralPath $source -Destination (Join-Path $root "$name.exe")
try {
  Build-Package '0.2.0'
  Build-Package '0.2.1'
  Check (!(Test-Path $appClass) -and !(Test-Path $cap) -and !(Test-Path $schemeKey)) 'clean fixture registration'
  Run-Setup (Join-Path $root '0.2.0-setup.exe') "/S /D=$dest"
  Verify-Install '0.2.0'
  Remove-Install
  Check (!(Test-Path $appClass) -and !(Value $registered $name)) 'fresh uninstall removed candidate'

  $externalOutput = Join-Path $root 'external.txt'
  $externalCommand = "`"$node`" `"$driver`" external `"%1`" `"$externalOutput`""
  New-Item -Path "$externalClass\shell\open\command" -Force | Out-Null
  Set-Item -LiteralPath "$externalClass\shell\open\command" -Value $externalCommand
  New-ItemProperty -LiteralPath $externalClass -Name 'URL Protocol' -Value '' | Out-Null
  $externalCap = "HKCU:\Software\$name.External\Capabilities"
  New-Item -Path "$externalCap\URLAssociations" -Force | Out-Null
  New-ItemProperty -LiteralPath "$externalCap\URLAssociations" -Name $scheme -Value "$name.External" | Out-Null
  New-ItemProperty -LiteralPath $registered -Name "$name.External" -Value "Software\$name.External\Capabilities" | Out-Null
  # Retain a pre-existing third-party legacy command across the installation.
  New-Item -Path "$schemeKey\shell\open\command" -Force | Out-Null
  Set-Item -LiteralPath "$schemeKey\shell\open\command" -Value $externalCommand
  Run-Setup (Join-Path $root '0.2.0-setup.exe') "/S /D=$dest"
  Verify-Install '0.2.0'
  Run-Setup (Join-Path $root '0.2.1-setup.exe') "/S /NS /UPDATE /D=$dest"
  Verify-Install '0.2.1'
  if ($CheckSettings) { Test-SettingsPage }
  & $node $driver $name $root
  Check ($LASTEXITCODE -eq 0) 'Shell dispatch to installed viewer (cold and resident) and alternate handler'
  Remove-Install
  Check (!(Test-Path $appClass) -and !(Test-Path $cap) -and !(Value $registered $name) -and !(Test-Path $exe)) 'uninstall removed only the installed viewer'
  Check ((Value "$externalClass\shell\open\command") -eq $externalCommand -and (Value $registered "$name.External")) 'external candidate survived uninstall'
  Check ((Value "$schemeKey\shell\open\command") -eq $externalCommand) 'existing protocol command survived upgrade and uninstall'
  Check ((UserChoice) -ceq $before) 'uninstall preserved user choice'
  Run-Setup (Join-Path $root '0.2.0-setup.exe') "/S /NS /D=$dest"
  $newOwner = '"'+(Join-Path $root "$name.exe")+'" "%1"'
  Set-Item -LiteralPath "$appClass\shell\open\command" -Value $newOwner
  Remove-Install
  Check ((Value "$appClass\shell\open\command") -eq $newOwner -and (Value $registered $name)) 'stale uninstaller preserved replacement registration'
  @{nativeArch=$env:PROCESSOR_ARCHITECTURE; binarySha256=$binaryHash; checks=$checks} | ConvertTo-Json | Set-Content "$root/result.json"
  Write-Host "$root/result.json"
} finally {
  Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object Path -EQ $exe | Stop-Process -Force
  Remove-Install
  Remove-ItemProperty -LiteralPath $registered -Name "$name.External",$name -ErrorAction SilentlyContinue
  foreach ($key in @($schemeKey,$externalClass,$appClass,"HKCU:\Software\$name.External","HKCU:\Software\$name",$uninstallKey)) {
    if (Test-Path -LiteralPath $key) {Remove-Item -LiteralPath $key -Recurse -Force}
  }
}
