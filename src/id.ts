import { randomUUID } from 'node:crypto';

function generateId(): string {
  return randomUUID().replace(/-/g, '');
}

export { generateId };
