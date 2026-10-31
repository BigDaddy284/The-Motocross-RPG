# Opens the Motocross RPG Toolkit in its own window, like a desktop app (Boss, 30 Oct 2026).
# Double-click Toolkit.cmd in the repo's folder. It checks Node.js is installed (and offers the
# download page if not), runs npm install the first time, starts the dev server out of sight and
# opens the toolkit in Edge or Chrome's app mode: a plain window with no address bar or menus, so
# the editors' shortcuts are never taken by the browser. Closing the window stops the server.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ports = 5173..5183
$url = $null
Add-Type -AssemblyName PresentationFramework

function Say($text, $buttons = 'OK') {
  return [System.Windows.MessageBox]::Show($text, 'Motocross RPG Toolkit', $buttons)
}

# Is the toolkit's own dev server answering on this port? (Asks over HTTP, so it finds the
# server whether Windows has it on IPv4 or IPv6.)
function Ours($port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$port/tools/index.html" -TimeoutSec 2
    return ($r.Content -match 'Motocross RPG Toolkit')
  } catch { return $false }
}

# Is anything at all listening on this port?
function Busy($port) {
  foreach ($addr in '127.0.0.1', '::1') {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect($addr, $port); $c.Close(); return $true } catch {}
  }
  return $false
}

# 1. Node.js (which brings npm).
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $r = Say "The toolkit needs Node.js, which isn't installed (or isn't on the PATH).`n`nOpen the Node.js download page? Install the LTS version, then run Toolkit.cmd again." 'YesNo'
  if ($r -eq 'Yes') { Start-Process 'https://nodejs.org/en/download' }
  exit 1
}

# 2. The project's packages, the first time.
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Say "First run: installing the project's packages. This takes a minute or two, and the toolkit opens when it's done."
  $p = Start-Process 'npm.cmd' -ArgumentList 'install' -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { Say "npm install failed (exit code $($p.ExitCode)). Run 'npm install' in a terminal in $root to see why."; exit 1 }
}

# 3. The dev server. If one of ours is already running (say, npm run dev in a terminal), the
#    window just opens on it. Otherwise it starts on the first free port from 5173 up.
$server = $null
foreach ($port in $ports) {
  if (Ours $port) { $url = "http://localhost:$port/tools/"; break }
  if (Busy $port) { continue }
  $server = Start-Process 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--port', $port, '--strictPort' -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Ours $port)) {
    if ((Get-Date) -gt $deadline -or $server.HasExited) {
      Say "The dev server didn't start on port $port. Run 'npm run dev' in a terminal in $root to see why."
      if (-not $server.HasExited) { & taskkill /PID $server.Id /T /F | Out-Null }
      exit 1
    }
    Start-Sleep -Milliseconds 300
  }
  $url = "http://localhost:$port/tools/"
  break
}
if (-not $url) { Say "Ports 5173 to 5183 are all in use by something else. Close whatever is using them and try again."; exit 1 }

# 4. Edge or Chrome in app mode, with its own profile folder so the window is its own process
#    (then this script knows when it closes). Falls back to the default browser.
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
  $profileDir = Join-Path $root '.toolkit-browser'
  Start-Process $browser -ArgumentList "--app=$url", "--user-data-dir=$profileDir", '--window-size=1500,950', '--no-first-run', '--no-default-browser-check' -Wait
} else {
  Start-Process $url
  Say "Edge or Chrome wasn't found, so the toolkit opened in your default browser. Close this box when you're done to stop the server."
}

# 5. Stop the server we started (npm and the node it runs).
if ($server -and -not $server.HasExited) { & taskkill /PID $server.Id /T /F | Out-Null }
