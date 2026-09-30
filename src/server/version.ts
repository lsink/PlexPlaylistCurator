import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let version = '1.0.0';

try {
  // Check cwd and parent directories for package.json
  const candidatePaths = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../../../package.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (data.version) {
        version = data.version;
        break;
      }
    }
  }
} catch {
  // Fallback to default
}

export const APP_VERSION = version;
