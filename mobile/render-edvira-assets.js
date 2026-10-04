const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const assetsDir = path.join(__dirname, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const svgPath = path.join(assetsDir, 'edvira-logo.svg');

async function render() {
  await sharp(svgPath)
    .resize(1024, 1024, { fit: 'contain', background: { r: 238, g: 245, b: 243, alpha: 1 } })
    .png()
    .toFile(path.join(assetsDir, 'edvira-icon.png'));

  await sharp(svgPath)
    .resize(1242, 2436, { fit: 'contain', background: { r: 244, g: 250, b: 248, alpha: 1 } })
    .png()
    .toFile(path.join(assetsDir, 'edvira-splash.png'));

  await sharp(svgPath)
    .resize(1024, 1024, { fit: 'contain', background: { r: 238, g: 245, b: 243, alpha: 1 } })
    .png()
    .toFile(path.join(assetsDir, 'adaptive-icon.png'));

  console.log('Created: edvira-icon.png, edvira-splash.png, adaptive-icon.png');
}

render().catch((error) => {
  console.error(error);
  process.exit(1);
});
