# test-api.ps1 - Compare DeepSeek direct API vs your Worker proxy.
# Reads:  request body from test-body.json (same folder or passed as param)
#         API key from env var DEEPSEEK_KEY (required, never hardcoded)
#         Worker URL from env var DEEPSEEK_WORKER (optional; default = wordpower-proxy)
# Usage:
#   $env:DEEPSEEK_KEY='sk-...'          # set in your session; do NOT paste into the file
#   $env:DEEPSEEK_WORKER='https://your-name.workers.dev'   # optional
#   .\test-api.ps1
#   .\test-api.ps1 -BodyFile my.json

param(
  [string]$BodyFile = 'test-body.json'
)

$ErrorActionPreference = 'Stop'

$DefaultProxy = 'https://wordpower-proxy.1124133287.workers.dev'
$DirectUrl = 'https://api.deepseek.com/chat/completions'
$ProxyBase = if ($env:DEEPSEEK_WORKER) { $env:DEEPSEEK_WORKER.TrimEnd('/') } else { $DefaultProxy }
$ProxyUrl = "$ProxyBase/chat/completions"

# ---- key from environment only ----
$Key = $env:DEEPSEEK_KEY
if ([string]::IsNullOrWhiteSpace($Key)) {
  Write-Error "DEEPSEEK_KEY env var is empty. Set it first: `$env:DEEPSEEK_KEY='sk-...'"
  exit 1
}

# ---- locate body file ----
$resolved = Resolve-Path -Path $BodyFile -ErrorAction SilentlyContinue
if (-not $resolved) {
  $alt = Join-Path $PSScriptRoot $BodyFile
  $resolved = Resolve-Path -Path $alt -ErrorAction SilentlyContinue
}
if (-not $resolved) {
  Write-Error "Request body file not found: $BodyFile (create test-body.json next to this script)"
  exit 1
}
$body = Get-Content -Path $resolved -Raw
try { $null = $body | ConvertFrom-Json } catch {
  Write-Error "test-body.json is not valid JSON: $($_.Exception.Message)"
  exit 1
}

function Invoke-One([string]$Name, [string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -Method POST -Headers @{
      'Content-Type'  = 'application/json'
      Authorization   = "Bearer $Key"
    } -Body $body -UseBasicParsing -TimeoutSec 60
    $obj  = $r.Content | ConvertFrom-Json
    $msg  = $obj.choices[0].message
    $cont = if ($null -eq $msg.content) { '' } else { [string]$msg.content }
    [pscustomobject]@{
      Name             = $Name
      Http             = [int]$r.StatusCode
      Model            = [string]$obj.model
      Content          = $cont.Trim()
      ContentLen       = $cont.Length
      Finish           = [string]$obj.choices[0].finish_reason
      CompletionTokens = $obj.usage.completion_tokens
      Error            = ''
    }
  } catch {
    $status = 'ERR'
    $detail = $_.Exception.Message
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $sr.ReadToEnd()
      } catch { }
    }
    $clean = ($detail -replace '\s+', ' ').Trim()
    [pscustomobject]@{
      Name             = $Name
      Http             = $status
      Model            = '-'
      Content          = ''
      ContentLen       = 0
      Finish           = '-'
      CompletionTokens = -1
      Error            = $clean.Substring(0, [Math]::Min(160, $clean.Length))
    }
  }
}

Write-Host ''
Write-Host '== 1/2 direct  https://api.deepseek.com/chat/completions =='
$direct = Invoke-One 'direct' $DirectUrl
Write-Host ''
Write-Host "== 2/2 proxy   $ProxyUrl =="
$proxy = Invoke-One 'proxy' $ProxyUrl
Write-Host ''

Write-Host '--- comparison ---'
$rows = @($direct, $proxy)
$rows | Format-Table Name, Http, Finish, CompletionTokens, ContentLen, Model, Error -AutoSize | Out-String | Write-Host
foreach ($row in $rows) {
  if ($row.ContentLen -eq 0 -and $row.Http -eq 200) {
    Write-Host ("[{0}] HTTP 200 but content is EMPTY - suspicious (reasoning model may have burned max_tokens)" -f $row.Name)
  } elseif ($row.ContentLen -gt 0) {
    Write-Host ("[{0}] content: {1}" -f $row.Name, $row.Content.Substring(0, [Math]::Min(80, $row.ContentLen)))
  } else {
    Write-Host ("[{0}] HTTP {1} - no content (auth/endpoint error, see table)" -f $row.Name, $row.Http)
  }
}
Write-Host ''

$sameContent = ($direct.Content -eq $proxy.Content) -and ($direct.ContentLen -gt 0)
$sameFinish  = $direct.Finish -eq $proxy.Finish
$sameTokens  = $direct.CompletionTokens -eq $proxy.CompletionTokens
Write-Host "content equal      : $sameContent"
Write-Host "finish_reason equal: $sameFinish"
Write-Host "completion_tokens  : direct=$($direct.CompletionTokens) proxy=$($proxy.CompletionTokens)  (equal: $sameTokens)"
if (-not $sameContent) {
  Write-Host 'NOTE: contents differ or empty - check finish_reason=length (thinking consumed budget) and model name in test-body.json'
}
