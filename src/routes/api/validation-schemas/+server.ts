import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValidationSchemas, seedValidationSchemas } from '$lib/server/validationLensStore';

export const GET: RequestHandler = async () => {
  seedValidationSchemas(); // idempotent
  const schemas = listValidationSchemas();
  return json({ schemas });
};
