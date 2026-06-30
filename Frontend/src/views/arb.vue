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
  Search,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Droplets,
  AlertTriangle,
} from "lucide-vue-next";
import { useArbStore } from "@/stores/arbStore";
import type { ArbitrageOpportunity, AnalysisResult, InvestmentTier } from "@/types/crypto";

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
    gate: "Gate.io",
    bitget: "Bitget",
    mexc: "MEXC",
    coinbase: "Coinbase",
  };
  return labels[name.toLowerCase()] || name;
}

function formatUsd(val: number): string {
  if (Math.abs(val) >= 1000) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return val.toFixed(2);
}

const sortedOpps = computed(() => {
  const list = [...store.opportunities];
  if (list.length > 0 && list[0].autoVerified) return list;
  return list.sort((a, b) => b.spreadPct - a.spreadPct);
});

async function handleAnalyze(opp: ArbitrageOpportunity) {
  const existing = store.getAnalysis(opp);
  if (existing && store.isExpanded(opp)) {
    store.toggleExpanded(opp);
    return;
  }
  if (existing) {
    store.toggleExpanded(opp);
    return;
  }
  await store.analyzeOpportunity(opp);
}

onMounted(() => {
  store.refresh();
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

    <!-- Analysis Error Banner -->
    <div
      v-if="store.analysisError"
      class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-3"
    >
      <AlertTriangle class="w-5 h-5 text-amber-400 shrink-0" />
      <span class="text-amber-300 text-sm">
        {{ store.analysisError }}
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

      <!-- Deep Scan Button -->
      <div
        class="glass-card p-4 flex items-center justify-between cursor-pointer hover:bg-neon-cyan/10 transition-colors border border-transparent hover:border-neon-cyan/30"
        @click="store.deepScan()"
      >
        <div class="flex items-center gap-3">
          <div class="p-2.5 rounded-lg" :class="store.isDeepScanning ? 'bg-amber-500/20 text-amber-400' : 'bg-neon-cyan/10 text-neon-cyan'">
            <Zap class="w-5 h-5" :class="{ 'animate-pulse': store.isDeepScanning }" />
          </div>
          <div class="min-w-0">
            <div class="text-xs text-gray-400 truncate">Deep Scan</div>
            <div class="text-sm font-bold" :class="store.isDeepScanning ? 'text-amber-400' : 'text-neon-cyan'">
              {{ store.isDeepScanning ? "Analyzing..." : "Verify All" }}
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
          <span v-if="sortedOpps.length > 0 && sortedOpps[0].autoVerified" class="text-xs font-normal px-2 py-0.5 rounded-full bg-neon-cyan/10 text-neon-cyan ml-2">Deep Scanned</span>
        </h2>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-500 font-mono" v-if="store.lastUpdated">
            {{ store.lastUpdated.toLocaleTimeString() }}
          </span>
          <button
            @click="store.refresh()"
            class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            :disabled="store.isLoading"
            title="Quick Scan (sort by spread)"
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
          :key="store.oppKey(opp)"
          class="bg-slate-900/50 border rounded-lg overflow-hidden transition-all"
          :class="[
            store.isExpanded(opp) ? 'border-neon-cyan/30' : '',
            opp.autoGo ? 'border-green-500/40 shadow-sm shadow-green-500/10' : '',
            opp.autoVerified && !opp.autoGo ? 'border-slate-700/30 opacity-70' : '',
            !opp.autoVerified && !store.isExpanded(opp) ? 'border-slate-700' : '',
          ]"
        >
          <!-- Card Header -->
          <div class="p-5">
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

              <!-- Right: Spread + Analyze Button -->
              <div class="flex items-center gap-3">
                <div class="text-right">
          <div class="flex items-center gap-2 justify-end">
            <span
              class="px-2.5 py-1 rounded text-sm font-bold border"
              :class="
                opp.spreadPct >= 1
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : opp.spreadPct >= 0.5
                    ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    : 'bg-slate-800 text-gray-400 border-slate-700'
              "
            >
              +{{ opp.spreadPct.toFixed(2) }}%
            </span>
            <span
              v-if="opp.autoVerified"
              class="px-2 py-0.5 rounded text-xs font-bold"
              :class="opp.autoGo ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/20'"
            >
              {{ opp.autoGo ? "GO" : "✗" }}
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

                <!-- Analyze Button -->
                <button
                  @click="handleAnalyze(opp)"
                  :disabled="store.isAnalyzing(opp)"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all duration-200"
                  :class="
                    store.isAnalyzing(opp)
                      ? 'bg-slate-700 text-gray-400 cursor-wait'
                      : store.getAnalysis(opp)
                        ? store.isExpanded(opp)
                          ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/30'
                          : 'bg-slate-700/80 text-neon-cyan border border-slate-600 hover:bg-slate-600'
                        : 'bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 text-white border border-neon-cyan/30 hover:from-neon-cyan/30 hover:to-neon-purple/30 hover:shadow-lg hover:shadow-neon-cyan/10'
                  "
                >
                  <RefreshCw v-if="store.isAnalyzing(opp)" class="w-4 h-4 animate-spin" />
                  <Search v-else-if="!store.getAnalysis(opp)" class="w-4 h-4" />
                  <ChevronUp v-else-if="store.isExpanded(opp)" class="w-4 h-4" />
                  <ChevronDown v-else class="w-4 h-4" />
                  <span>
                    {{ store.isAnalyzing(opp) ? "Analyzing..." : store.getAnalysis(opp) ? (store.isExpanded(opp) ? "Hide" : "Results") : "⚡ Analyze" }}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- Analysis Results Panel (expandable) -->
          <div
            v-if="store.isExpanded(opp) && store.getAnalysis(opp)"
            class="border-t border-slate-700/50 bg-slate-950/50 p-5 space-y-5 animate-in"
          >
            <template v-if="store.getAnalysis(opp) as AnalysisResult">
              <!-- Recommendation Banner -->
              <div
                class="rounded-lg p-4 flex items-start gap-4"
                :class="
                  store.getAnalysis(opp)!.recommendation.decision === 'GO'
                    ? 'bg-green-500/10 border border-green-500/30'
                    : 'bg-red-500/10 border border-red-500/30'
                "
              >
                <div
                  class="p-2 rounded-full shrink-0"
                  :class="
                    store.getAnalysis(opp)!.recommendation.decision === 'GO'
                      ? 'bg-green-500/20'
                      : 'bg-red-500/20'
                  "
                >
                  <CheckCircle
                    v-if="store.getAnalysis(opp)!.recommendation.decision === 'GO'"
                    class="w-6 h-6 text-green-400"
                  />
                  <XCircle v-else class="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <div class="flex items-center gap-3 mb-1">
                    <span
                      class="text-lg font-bold"
                      :class="
                        store.getAnalysis(opp)!.recommendation.decision === 'GO'
                          ? 'text-green-400'
                          : 'text-red-400'
                      "
                    >
                      {{ store.getAnalysis(opp)!.recommendation.decision }}
                    </span>
                    <span
                      v-if="store.getAnalysis(opp)!.recommendation.optimalInvestment > 0"
                      class="px-2 py-0.5 rounded bg-green-500/20 text-green-300 text-sm font-mono"
                    >
                      Invest ${{ formatUsd(store.getAnalysis(opp)!.recommendation.optimalInvestment) }}
                      → Profit ${{ formatUsd(store.getAnalysis(opp)!.recommendation.expectedProfit) }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-300">
                    {{ store.getAnalysis(opp)!.recommendation.reason }}
                  </p>
                </div>
              </div>

              <!-- Liquidity + Orderbook Row -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Liquidity Info -->
                <div class="bg-slate-900/80 border border-slate-700/50 rounded-lg p-4">
                  <h4 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <Droplets class="w-4 h-4 text-blue-400" />
                    Liquidity
                  </h4>
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-gray-500">Buy side ({{ exchangeLabel(opp.buyExchange) }})</span>
                      <span class="font-mono text-sm text-neon-cyan">
                        ${{ formatUsd(store.getAnalysis(opp)!.liquidity.buyLiquidityUsd) }}
                      </span>
                    </div>
                    <div class="w-full bg-slate-800 rounded-full h-1.5">
                      <div
                        class="h-1.5 rounded-full bg-neon-cyan/60"
                        :style="{ width: Math.min(100, (store.getAnalysis(opp)!.liquidity.buyLiquidityUsd / 10000) * 100) + '%' }"
                      ></div>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-xs text-gray-500">Sell side ({{ exchangeLabel(opp.sellExchange) }})</span>
                      <span class="font-mono text-sm text-neon-purple">
                        ${{ formatUsd(store.getAnalysis(opp)!.liquidity.sellLiquidityUsd) }}
                      </span>
                    </div>
                    <div class="w-full bg-slate-800 rounded-full h-1.5">
                      <div
                        class="h-1.5 rounded-full bg-neon-purple/60"
                        :style="{ width: Math.min(100, (store.getAnalysis(opp)!.liquidity.sellLiquidityUsd / 10000) * 100) + '%' }"
                      ></div>
                    </div>
                    <div class="flex items-center gap-2 mt-2">
                      <span
                        class="text-xs px-2 py-0.5 rounded-full"
                        :class="
                          store.getAnalysis(opp)!.liquidity.sufficient
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        "
                      >
                        {{ store.getAnalysis(opp)!.liquidity.sufficient ? "Sufficient" : "Low" }}
                      </span>
                      <span class="text-xs text-gray-500">
                        {{ store.getAnalysis(opp)!.liquidity.buyLevels }} / {{ store.getAnalysis(opp)!.liquidity.sellLevels }} levels
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Orderbook Snapshot -->
                <div class="bg-slate-900/80 border border-slate-700/50 rounded-lg p-4">
                  <h4 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <BarChart3 class="w-4 h-4 text-neon-purple" />
                    Orderbook Snapshot
                  </h4>
                  <div class="grid grid-cols-2 gap-3">
                    <!-- Buy Asks -->
                    <div>
                      <div class="text-xs text-gray-500 mb-1.5">Asks ({{ exchangeLabel(opp.buyExchange) }})</div>
                      <div class="space-y-0.5">
                        <div
                          v-for="(level, i) in store.getAnalysis(opp)!.orderbook.buyAsks.slice(0, 5)"
                          :key="'ask-' + i"
                          class="flex justify-between text-xs font-mono"
                        >
                          <span class="text-red-400">${{ formatPrice(level.price) }}</span>
                          <span class="text-gray-500">{{ level.size.toFixed(4) }}</span>
                        </div>
                      </div>
                    </div>
                    <!-- Sell Bids -->
                    <div>
                      <div class="text-xs text-gray-500 mb-1.5">Bids ({{ exchangeLabel(opp.sellExchange) }})</div>
                      <div class="space-y-0.5">
                        <div
                          v-for="(level, i) in store.getAnalysis(opp)!.orderbook.sellBids.slice(0, 5)"
                          :key="'bid-' + i"
                          class="flex justify-between text-xs font-mono"
                        >
                          <span class="text-green-400">${{ formatPrice(level.price) }}</span>
                          <span class="text-gray-500">{{ level.size.toFixed(4) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Investment Tiers Table -->
              <div class="bg-slate-900/80 border border-slate-700/50 rounded-lg p-4">
                <h4 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <DollarSign class="w-4 h-4 text-green-400" />
                  Investment Analysis
                </h4>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="text-xs text-gray-500 border-b border-slate-700/50">
                        <th class="text-left py-2 pr-3 font-medium">Investment</th>
                        <th class="text-right py-2 px-3 font-medium">Eff. Buy</th>
                        <th class="text-right py-2 px-3 font-medium">Eff. Sell</th>
                        <th class="text-right py-2 px-3 font-medium">Slippage</th>
                        <th class="text-right py-2 px-3 font-medium">Fees</th>
                        <th class="text-right py-2 px-3 font-medium">Net Profit</th>
                        <th class="text-right py-2 pl-3 font-medium">ROI</th>
                        <th class="text-center py-2 pl-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="tier in store.getAnalysis(opp)!.analysis"
                        :key="tier.investmentUsd"
                        class="border-b border-slate-800/50 last:border-0"
                        :class="{
                          'bg-green-500/5': tier.feasible,
                          'opacity-60': !tier.feasible
                        }"
                      >
                        <td class="py-2.5 pr-3 font-mono font-semibold">${{ formatUsd(tier.investmentUsd) }}</td>
                        <td class="py-2.5 px-3 text-right font-mono text-xs text-neon-cyan">
                          ${{ tier.effectiveBuyPrice > 0 ? formatPrice(tier.effectiveBuyPrice) : '—' }}
                        </td>
                        <td class="py-2.5 px-3 text-right font-mono text-xs text-neon-purple">
                          ${{ tier.effectiveSellPrice > 0 ? formatPrice(tier.effectiveSellPrice) : '—' }}
                        </td>
                        <td class="py-2.5 px-3 text-right font-mono text-xs">
                          <span :class="tier.slippageBuyPct > 0.5 ? 'text-red-400' : 'text-gray-400'">
                            {{ tier.slippageBuyPct > 0 ? tier.slippageBuyPct.toFixed(2) + '%' : '—' }}
                          </span>
                        </td>
                        <td class="py-2.5 px-3 text-right font-mono text-xs text-gray-400">
                          ${{ tier.totalFeesUsd > 0 ? formatUsd(tier.totalFeesUsd) : '—' }}
                        </td>
                        <td class="py-2.5 px-3 text-right font-mono text-sm font-semibold"
                          :class="tier.netProfitUsd > 0 ? 'text-green-400' : tier.netProfitUsd < 0 ? 'text-red-400' : 'text-gray-500'"
                        >
                          {{ tier.netProfitUsd !== 0 ? (tier.netProfitUsd > 0 ? '+' : '') + '$' + formatUsd(tier.netProfitUsd) : '—' }}
                        </td>
                        <td class="py-2.5 px-3 text-right font-mono text-xs"
                          :class="tier.roiPct > 0 ? 'text-green-400' : tier.roiPct < 0 ? 'text-red-400' : 'text-gray-500'"
                        >
                          {{ tier.roiPct !== 0 ? (tier.roiPct > 0 ? '+' : '') + tier.roiPct.toFixed(2) + '%' : '—' }}
                        </td>
                        <td class="py-2.5 pl-3 text-center">
                          <span
                            class="text-xs px-2 py-0.5 rounded-full font-medium"
                            :class="
                              tier.feasible
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-slate-700 text-gray-500'
                            "
                          >
                            {{ tier.feasible ? '✓ GO' : '✗' }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
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
        Manual refresh only &middot; Orderbooks via Hybrid Direct/Aggregator API
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-in {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    max-height: 2000px;
    transform: translateY(0);
  }
}
</style>

