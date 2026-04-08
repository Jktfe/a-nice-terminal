import { execFileSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

export async function hooks(args: string[], _flags: any) {
  const subcommand = args[0];
  if (subcommand === 'install') {
    const installScript = join(import.meta.dir, '../../ant-capture/install.sh');
    if (!existsSync(installScript)) {
      console.error('Install script not found. Make sure ant-capture/ directory exists.');
      process.exit(1);
    }
    execFileSync('bash', [installScript], { stdio: 'inherit' });
  } else {
    console.log('Usage: ant hooks install');
  }
}
