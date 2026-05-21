import type { CapabilityLedgerRow } from './types';

export const firstCapabilityRows: CapabilityLedgerRow[] = [
  {
    capability: 'Start a chatroom',
    source: 'v5 chat/room lane',
    status: 'CHANGE',
    owner: 'Claude',
    note: 'Start from the human room workflow, not terminal-first navigation.'
  },
  {
    capability: 'Linked terminal',
    source: 'v5 terminal lane',
    status: 'CHANGE',
    owner: 'Codex',
    note: 'Expose linked chat, ANT terminal, and raw terminal without making them separate rooms.'
  },
  {
    capability: 'Break context',
    source: 'v5 chat/room lane',
    status: 'CHANGE',
    owner: 'Claude',
    note: 'Breaks are named context boundaries that agents can see.'
  },
  {
    capability: 'Read receipts',
    source: 'audit blockers',
    status: 'CHANGE',
    owner: 'Claude',
    note: 'Use receipt data without spending model tokens.'
  },
  {
    capability: 'Consent grants',
    source: 'audit blockers',
    status: 'CHANGE',
    owner: 'Codex',
    note: 'Permission changes are visible and revocable.'
  }
];

