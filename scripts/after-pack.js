// electron-builder afterPack hook.
// С identity:null electron-builder оставляет битую линкерную ad-hoc подпись
// ("code has no resources but signature indicates they must be present"),
// из-за чего на Apple Silicon приложение считается «повреждённым».
// Пере-подписываем .app правильной глубокой ad-hoc подписью.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  console.log(`  • re-signed ad-hoc: ${appPath}`);
};
