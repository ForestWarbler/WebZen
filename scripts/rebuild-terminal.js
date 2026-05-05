const { spawnSync } = require('child_process')
const path = require('path')

let rebuildCli
try {
    rebuildCli = require.resolve('@electron/rebuild/lib/cli.js')
} catch (_error) {
    console.log('Skipping native rebuild: @electron/rebuild is not installed.')
    process.exit(0)
}

const projectRoot = path.join(__dirname, '..')
const result = spawnSync(
    process.execPath,
    [rebuildCli, '-f', '-w', 'node-pty'],
    {
        stdio: 'inherit',
        cwd: projectRoot
    }
)

if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
    // Native rebuild can fail in CI before electron-builder takes over;
    // electron-builder will rebuild native deps for the target platform itself.
    console.log('Native rebuild for node-pty failed or was skipped; continuing.')
    process.exit(0)
}

console.log('node-pty rebuilt for the current Electron runtime.')
