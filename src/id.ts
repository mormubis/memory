import { randomUUID } from 'node:crypto';

function generateId(): string {
  return randomUUID().replaceAll('-', '');
}

export { generateId };
