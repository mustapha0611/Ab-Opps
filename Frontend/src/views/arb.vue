<script setup lang="ts">
import { onMounted, computed } from "vue";
import {
  ArrowRight,
  RefreshCw,
  TrendingUp,
  Activity,
  Zap,
  BarChart3,
  Wifi,
  WifiOff,
} from "lucide-vue-next";
import { useArbStore } from "@/stores/arbStore";

const store = useArbStore();

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function profitColor(pct: number): string {
  if (pct >= 1) return "text-green-400";
  if (pct >= 0.5) return "text-emerald-400";
  if (pct >= 0.2) return "text-yellow-400";
  return "text-gray-400";
}

function exchangeLabel(name: string): string {
  const labels: Record<string, string> = {
    binance: "Binance",
    okx: "OKX",
    bybit: "Bybit",
    kucoin: "KuCoin",
    gateio: "Gate.io",
    bitget: "Bitget",
    mexc: "MEXC",
    coinbase: "Coinbase",
  };
  return labels[name.toLowerCase()] || name;
}

const sortedOpps = computed(() =>
  [...store.opportunities].sort((a, b) => b.spreadPct - a.spreadPct)
);

onMounted(() => {
  store.refresh(); // Fetch once on mount
});
</script>

<template>
  <div class="space-y-6">
    <!-- Error Banner -->
    <div
      v-if="store.lastError"
      class="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-3"
    >
      <WifiOff class="w-5 h-5 text-red-400 shrink-0" />
      <span class="text-red-300 text-sm">
        {{ store.lastError }}
        <button @click="store.refresh()" class="underline ml-1">Retry</button>
      </span>
    </div>

    <!-- Header Stats Row -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <!-- Active Opportunities -->
      <div class="glass-card p-4 flex items-center gap-3">
        <div class="p-2.5 rounded-lg bg-neon-cyan/10 text-neon-cyan">
          <Activity class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-gray-400 truncate">Opportunities</div>
          <div class="text-xl font-bold font-mono">{{ store.opportunities.length }}</div>
        </div>
      </div>

      <!-- Best Spread -->
      <div class="glass-card p-4 flex items-center gap-3">
        <div class="p-2.5 rounded-lg bg-neon-purple/10 text-neon-purple">
          <TrendingUp class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-gray-400 truncate">Best Spread</div>
          <div class="text-xl font-bold font-mono text-neon-cyan">
            {{ store.bestSpreadPct > 0 ? "+" : "" }}{{ store.bestSpreadPct.toFixed(2) }}%
          </div>
        </div>
      </div>

      <!-- Avg Spread -->
      <div class="glass-card p-4 flex items-center gap-3">
        <div class="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
          <BarChart3 class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-gray-400 truncate">Avg Spread</div>
          <div class="text-xl font-bold font-mono">{{ store.avgSpreadPct.toFixed(2) }}%</div>
        </div>
      </div>

      <!-- Exchanges Connected -->
      <div class="glass-card p-4 flex items-center gap-3">
        <div class="p-2.5 rounded-lg bg-green-500/10 text-green-400">
          <Wifi class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="text-xs text-gray-400 truncate">Exchanges</div>
          <div class="text-xl font-bold font-mono">{{ store.exchangeCount }}</div>
        </div>
      </div>

      <!-- Refresh Button -->
      <div
        class="glass-card p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/70 transition-colors"
        @click="store.refresh()"
      >
        <div class="flex items-center gap-3">
          <div class="p-2.5 rounded-lg bg-slate-700 text-gray-300">
            <RefreshCw class="w-5 h-5" :class="{ 'animate-spin': store.isLoading }" />
          </div>
          <div class="min-w-0">
            <div class="text-xs text-gray-400 truncate">Status</div>
            <div class="text-sm font-bold">
              {{ store.isLoading ? "Scanning..." : "Manual" }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Opportunities List -->
    <div class="glass-card p-6 min-h-96">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold flex items-center gap-2">
          <Zap class="w-5 h-5 text-neon-cyan" />
          Arbitrage Opportunities
        </h2>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-500 font-mono" v-if="store.lastUpdated">
            {{ store.lastUpdated.toLocaleTimeString() }}
          </span>
          <button
            @click="store.refresh()"
            class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            :disabled="store.isLoading"
          >
            <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.isLoading }" />
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="sortedOpps.length === 0 && !store.isLoading" class="text-center py-20">
        <div class="inline-block p-6 rounded-full bg-slate-800 mb-4">
          <Activity class="w-12 h-12 text-gray-600" />
        </div>
        <p class="text-gray-400 text-lg">No arbitrage opportunities detected.</p>
        <p class="text-gray-500 text-sm mt-2">
          Waiting for price data from exchanges. Check your network connection.
        </p>
      </div>

      <!-- Loading State -->
      <div v-else-if="store.isLoading && sortedOpps.length === 0" class="text-center py-20">
        <RefreshCw class="w-12 h-12 text-neon-cyan animate-spin mx-auto mb-4" />
        <p class="text-gray-400 text-lg">Scanning exchanges...</p>
      </div>

      <!-- Opportunities Table -->
      <div v-else class="space-y-3">
        <div
          v-for="opp in sortedOpps"
          :key="`${opp.symbol}-${opp.buyExchange}-${opp.sellExchange}`"
          class="bg-slate-900/50 border border-slate-700 rounded-lg p-5 hover:border-neon-cyan/30 transition-all"
        >
          <div class="flex items-center justify-between flex-wrap gap-4">
            <!-- Left: Symbol + Exchanges -->
            <div class="flex items-center gap-4 min-w-0">
              <div class="flex flex-col">
                <h3 class="font-bold text-lg font-mono">{{ opp.symbol }}/USDT</h3>
                <div class="flex items-center gap-2 text-sm text-gray-400 mt-1">
                  <span class="text-neon-cyan font-medium">{{ exchangeLabel(opp.buyExchange) }}</span>
                  <ArrowRight class="w-3.5 h-3.5 text-gray-600" />
                  <span class="text-neon-purple font-medium">{{ exchangeLabel(opp.sellExchange) }}</span>
                </div>
              </div>
            </div>

            <!-- Center: Prices -->
            <div class="hidden md:flex items-center gap-6">
              <div class="text-center">
                <div class="text-xs text-gray-500 mb-0.5">Buy</div>
                <div class="font-mono text-neon-cyan text-sm">${{ formatPrice(opp.buyPrice) }}</div>
              </div>
              <div class="text-center">
                <div class="text-xs text-gray-500 mb-0.5">Sell</div>
                <div class="font-mono text-neon-purple text-sm">${{ formatPrice(opp.sellPrice) }}</div>
              </div>
            </div>

            <!-- Right: Spread -->
            <div class="text-right">
              <div class="flex items-center gap-2 justify-end">
                <span
                  class="px-2.5 py-1 rounded text-sm font-bold border"
                  :class="
                    opp.spreadPct >= 0.5
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : opp.spreadPct >= 0.2
                        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        : 'bg-slate-800 text-gray-400 border-slate-700'
                  "
                >
                  +{{ opp.spreadPct.toFixed(2) }}%
                </span>
              </div>
              <div class="text-xs text-gray-500 mt-1 font-mono" v-if="opp.spreadUsd > 0">
                ~${{ opp.spreadUsd.toFixed(2) }} spread
              </div>
              <!-- Net profit after fees -->
              <div class="text-xs mt-1" :class="profitColor(store.getNetProfit(opp).netSpreadPct)">
                Net: {{ store.getNetProfit(opp).netSpreadPct > 0 ? "+" : "" }}{{ store.getNetProfit(opp).netSpreadPct.toFixed(2) }}%
                <span class="text-gray-600">(after {{ store.getNetProfit(opp).totalFeesPct.toFixed(1) }}% fees)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between text-xs text-gray-600 px-2">
      <div class="flex items-center gap-4">
        <span>
          Exchanges: <span class="text-gray-400">{{ store.exchangeCount }}</span>
        </span>
        <span>
          Symbols: <span class="text-gray-400">{{ store.symbolCount }}</span>
        </span>
      </div>
      <div>
        Manual refresh only
      </div>
    </div>
  </div>
</template>
