const fs = require('fs')
const path = require('path')

const vendorDir = path.join(__dirname, '..', 'plugins', 'terminal', 'vendor')
const nodeModules = path.join(__dirname, '..', 'node_modules')

const filesToCopy = [
    { src: path.join(nodeModules, 'xterm', 'lib', 'xterm.js'), dest: 'xterm.js' },
    { src: path.join(nodeModules, 'xterm', 'css', 'xterm.css'), dest: 'xterm.css' },
    { src: path.join(nodeModules, 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js'), dest: 'xterm-addon-fit.js' }
]

let missing = false
for (const { src } of filesToCopy) {
    if (!fs.existsSync(src)) {
        missing = true
        break
    }
}

if (missing) {
    console.log('Skipping terminal vendor setup: xterm packages not installed.')
    process.exit(0)
}

fs.mkdirSync(vendorDir, { recursive: true })

for (const { src, dest } of filesToCopy) {
    fs.copyFileSync(src, path.join(vendorDir, dest))
}

console.log('Terminal vendor files copied to plugins/terminal/vendor/')
