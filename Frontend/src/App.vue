<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-screen bg-linear-to-br from-gray-900 to-black text-white font-sans selection:bg-neon-cyan selection:text-black">
    <nav class="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-3">
            <div class="shrink-0 cursor-pointer">
              <span class="text-2xl font-bold bg-linear-to-r from-neon-cyan to-neon-purple bg-clip-text text-transparent tracking-tighter">
                ARB<span class="text-white">HUNT</span>
              </span>
            </div>
          </div>
          <div class="flex items-center gap-4 text-sm text-gray-400">
            <span class="hidden sm:inline">Crypto Arbitrage Scanner</span>
          </div>
        </div>
      </div>
    </nav>
    <main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <RouterView />
    </main>
  </div>
</template>
