param([string]$Api = 'http://localhost:4000')
$loginBody = @{ email = 'admin@novaworks.example'; password = 'Demo123!' } | ConvertTo-Json
Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -SessionVariable demoSession
$meeting = Get-Content -LiteralPath "$PSScriptRoot/meeting.txt" -Raw
$submissionKey = [guid]::NewGuid().ToString()
$headers = @{ 'Idempotency-Key' = $submissionKey }
$body = @{ transcript = $meeting } | ConvertTo-Json
Invoke-RestMethod -Uri "$Api/api/transcript-conversions" -Method Post -ContentType 'application/json' -Headers $headers -Body $body -WebSession $demoSession
Invoke-RestMethod -Uri "$Api/api/projects" -WebSession $demoSession
