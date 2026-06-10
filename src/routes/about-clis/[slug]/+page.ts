import { error } from '@sveltejs/kit';
import { aboutCliPages, getAboutCliPage } from '$lib/aboutCliPages';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  const page = getAboutCliPage(params.slug);
  if (!page) throw error(404, 'ABOUT-[CLI] page not found.');

  return {
    page,
    pages: aboutCliPages
  };
};

