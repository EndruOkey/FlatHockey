import type { ClientMessage } from '@flathockey/shared';
import { parseClientMessage } from '@flathockey/shared/net/schema';

export function parseWsPayload(raw: string): ClientMessage | null {
  return parseClientMessage(raw);
}
