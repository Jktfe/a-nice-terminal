<script lang="ts">
  let { session } = $props();

  const isTerminal = session.type === 'terminal';
  const accentColor = isTerminal ? '#22C55E' : '#6366F1';
  const bgAccent = isTerminal ? 'rgba(34, 197, 94, 0.1)' : 'rgba(99, 102, 241, 0.1)';
  const icon = isTerminal ? '>' : '💬';

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  function getStatusDot(status: string) {
    const statusMap: Record<string, { color: string; label: string }> = {
      active: { color: '#22C55E', label: 'Active' },
      idle: { color: '#6366F1', label: 'Idle' },
      completed: { color: '#8B5CF6', label: 'Completed' }
    };
    return statusMap[status] || { color: '#6B7280', label: status };
  }

  const statusInfo = getStatusDot(session.status);
</script>

<div
  class="group relative px-4 py-3 rounded-lg bg-[#16161A] hover:bg-[#1E1E24] border border-[var(--border-subtle)] hover:border-[var(--border-light)] transition-all duration-200 card-hover overflow-hidden"
>
  <!-- Accent Border Left -->
  <div
    class="absolute inset-y-0 left-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity"
    style="background-color: {accentColor}"
  ></div>

  <div class="flex items-center gap-3 pl-2">
    <!-- Icon -->
    <div
      class="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
      style="background: {bgAccent}; color: {accentColor}"
    >
      {icon}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <p class="font-medium text-sm text-white truncate">
        {session.name}
      </p>
      <div class="flex items-center gap-2 mt-1">
        <span class="text-xs text-gray-400">
          {isTerminal ? 'Terminal' : 'Chat'}
        </span>
        <div class="w-1 h-1 rounded-full bg-gray-600"></div>
        <div class="flex items-center gap-1">
          <div
            class="w-1.5 h-1.5 rounded-full"
            style="background-color: {statusInfo.color}"
          ></div>
          <span class="text-xs text-gray-400">{statusInfo.label}</span>
        </div>
      </div>
    </div>

    <!-- Time -->
    <span class="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
      {timeAgo(session.updated_at)}
    </span>
  </div>
</div>
