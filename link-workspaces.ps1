$base = "C:\Users\pc\Documents\projects\DMR-X"
$targets = @(
    "packages\db",
    "packages\utils",
    "packages\core",
    "packages\secrets",
    "packages\tokenizers",
    "packages\provider-catalog",
    "packages\cli",
    "packages\plugin-loader",
    "packages\agent-pc",
    "services\agent-registry",
    "services\agent-runtime",
    "services\billing",
    "services\memory",
    "services\router",
    "services\federation",
    "services\adapters",
    "services\benchmark",
    "services\cache",
    "services\godmode",
    "services\mcp-client",
    "services\mcp-server",
    "services\oauth",
    "services\operator",
    "services\plugin-loader-bootstrap",
    "services\policy",
    "services\prompts",
    "services\quota",
    "services\registry",
    "services\sandbox",
    "services\server-manager",
    "services\telemetry",
    "services\tool-search",
    "services\workers"
)

New-Item -ItemType Directory -Force -Path "$base\node_modules\@dmr-x" | Out-Null

foreach ($t in $targets) {
    $name = Split-Path $t -Leaf
    $linkPath = "$base\node_modules\@dmr-x\$name"
    $targetPath = "$base\$t"
    if (-not (Test-Path $linkPath)) {
        cmd /c "mklink /D `"$linkPath`" `"$targetPath`"" 2>$null
    }
}

Get-ChildItem "$base\node_modules\@dmr-x" -Directory | Select-Object Name
