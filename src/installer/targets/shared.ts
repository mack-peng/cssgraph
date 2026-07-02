import * as fs from 'fs';
import * as path from 'path';

export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function removeMarkedSection(
  filePath: string,
  startMarker: string,
  endMarker: string,
): 'removed' | 'unchanged' | 'not-found' {
  if (!fs.existsSync(filePath)) return 'not-found';

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return 'not-found';

  const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx === -1) return 'not-found';

  // Remove the block including the markers and any trailing newline
  let newContent = content.slice(0, startIdx) + content.slice(endIdx + endMarker.length);
  newContent = newContent.replace(/\n{3,}/g, '\n\n').trim() + '\n';

  atomicWriteFileSync(filePath, newContent);
  return 'removed';
}
