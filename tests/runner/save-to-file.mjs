import * as path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function save_to_file(value, file_path) {
    const resolved_path = path.resolve(__dirname, file_path);
    await fs.writeFile(resolved_path, `export default ${JSON.stringify(value, null, 2)};`, 'utf-8')
    return resolved_path
}