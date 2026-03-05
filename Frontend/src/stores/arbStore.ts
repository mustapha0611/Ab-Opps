import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { ExchangePrice, ArbitrageOpportunity } from "@/types/crypto";
import { fetchExchangePrices } from "@/services/findPrice";
import { calcProfit } from "@/services/calcProfit";

export const useArbStore = defineStore("arb", () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const prices = ref<ExchangePrice[]>([]);
  const opportunities = ref<ArbitrageOpportunity[]>([]);
  const isLoading = ref(false);
  const lastError = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);
  const autoRefresh = ref(true);
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Computed ───────────────────────────────────────────────────────────────
  const bestOpportunity = computed(() => {
    if (opportunities.value.length === 0) return null;
    return opportunities.value.reduce((best, opp) =>
      opp.spreadPct > best.spreadPct ? opp : best
    );
  });

  const bestSpreadPct = computed(() => bestOpportunity.value?.spreadPct ?? 0);

  const avgSpreadPct = computed(() => {
    if (opportunities.value.length === 0) return 0;
    const total = opportunities.value.reduce((acc, o) => acc + o.spreadPct, 0);
    return Math.round((total / opportunities.value.length) * 100) / 100;
  });

  const exchangeCount = computed(() => {
    const exchanges = new Set(prices.value.map((p) => p.exchange));
    return exchanges.size;
  });

  const symbolCount = computed(() => {
    const symbols = new Set(prices.value.map((p) => p.symbol));
    return symbols.size;
  });

  // ─── Actions ────────────────────────────────────────────────────────────────

  /** Fetch prices from backend and update state */
  async function refresh(): Promise<void> {
    isLoading.value = true;
    lastError.value = null;

    try {
      const result = await fetchExchangePrices();
      prices.value = result.prices;
      opportunities.value = result.opportunities;
      lastUpdated.value = new Date();
    } catch (err: any) {
      lastError.value = err.message || "Failed to fetch data";
      console.error("[Store] Fetch failed:", err.message);
    } finally {
      isLoading.value = false;
    }
  }

  /** Start auto-refreshing every N milliseconds */
  function startAutoRefresh(intervalMs = 10000): void {
    stopAutoRefresh();
    autoRefresh.value = true;
    refresh(); // Fetch immediately
    refreshTimer = setInterval(() => {
      if (autoRefresh.value) refresh();
    }, intervalMs);
  }

  /** Stop auto-refreshing */
  function stopAutoRefresh(): void {
    autoRefresh.value = false;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  /**
   * Get net profit info for a specific opportunity (accounting for fees).
   */
  function getNetProfit(opp: ArbitrageOpportunity) {
    return calcProfit(opp.buyPrice, opp.sellPrice, opp.buyExchange, opp.sellExchange);
  }

  return {
    // State
    prices,
    opportunities,
    isLoading,
    lastError,
    lastUpdated,
    autoRefresh,
    // Computed
    bestOpportunity,
    bestSpreadPct,
    avgSpreadPct,
    exchangeCount,
    symbolCount,
    // Actions
    refresh,
    startAutoRefresh,
    stopAutoRefresh,
    getNetProfit,
  };
});
