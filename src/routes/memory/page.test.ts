import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MemoryPage from './+page.svelte';

const baseData = {
  queryFromServer: '',
  hitsFromServer: [],
  roomNameByRoomId: {},
  recallFetchFailed: false,
  roomScopeUnknown: false,
  longMemoryEnabled: false
};

describe('/memory page SSR', () => {
  it('renders the memory editor when there is no recall query', () => {
    const { body } = render(MemoryPage, { props: { data: baseData } });

    expect(body).toContain('class="memory-editor');
    expect(body).toContain('Audit Log');
  });
});
