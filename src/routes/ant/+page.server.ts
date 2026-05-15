import type { PageServerLoad } from './$types';
import {
  PROGRAMME_BOARD_SNAPSHOT,
  type ProgrammeBoardSnapshot
} from '$lib/server/programmeBoardData';

export const load: PageServerLoad = async () => {
  const snapshot: ProgrammeBoardSnapshot = PROGRAMME_BOARD_SNAPSHOT;
  return { snapshot };
};
