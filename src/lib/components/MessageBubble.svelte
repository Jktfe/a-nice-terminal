<script lang="ts">
  let { message } = $props();
  const isUser = message.role === 'user';
</script>

<div class="animate-slide-in">
  {#if isUser}
    <!-- User Message -->
    <div class="flex justify-end">
      <div class="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-none bg-gradient-indigo text-white text-sm shadow-lg">
        <p class="break-words whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  {:else}
    <!-- AI Message -->
    <div class="flex gap-3">
      <div class="flex-shrink-0">
        <div
          class="w-8 h-8 rounded-lg bg-gradient-indigo flex items-center justify-center text-xs font-bold text-white"
        >
          A
        </div>
      </div>
      <div class="max-w-[85%] space-y-2">
        <div class="px-4 py-3 rounded-2xl rounded-tl-none bg-[#1A1A22] text-gray-100 text-sm border-l-3 border-[#6366F1]">
          <p class="break-words whitespace-pre-wrap">{message.content}</p>
          {#if message.status === 'streaming'}
            <span class="inline-block animate-pulse text-[#6366F1] ml-1">▌</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
