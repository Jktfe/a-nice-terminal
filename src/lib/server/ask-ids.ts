import { customAlphabet } from 'nanoid';

const makeAskSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 7);

export function createAskId(): string {
  return `A${makeAskSuffix()}`;
}
