import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getContractDetail } from '$lib/server/contractPackStore';

export const GET: RequestHandler = async ({ params }) => {
  const detail = getContractDetail(params.contractId);
  if (!detail) throw error(404, 'Contract not found.');
  return json(detail);
};
