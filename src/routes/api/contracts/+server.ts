import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CONTRACT_PACK, listContractStubs } from '$lib/server/contractPackStore';

export const GET: RequestHandler = async () => {
  return json({
    contractPack: CONTRACT_PACK,
    contracts: listContractStubs()
  });
};
