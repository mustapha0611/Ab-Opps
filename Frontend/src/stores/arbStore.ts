import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { ExchangePrice, ArbitrageOpportunity, AnalysisResult } from "@/types/crypto";
import { fetchExchangePrices } from "@/services/findPrice";
import { analyzeOpportunity as analyzeOpp } from "@/services/analyzeService";
import { deepScanOpportunities } from "@/services/deepScanService";
import { calcProfit } from "@/services/calcProfit";

export const useArbStore = defineStore("arb", () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const prices = ref<ExchangePrice[]>([]);
  const opportunities = ref<ArbitrageOpportunity[]>([]);
  const isLoading = ref(false);
  const isDeepScanning = ref(false);
  const lastError = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  // ─── Analysis State ─────────────────────────────────────────────────────────
  const analysisResults = ref<Record<string, AnalysisResult>>({});
  const analyzingKey = ref<string | null>(null);
  const analysisError = ref<string | null>(null);
  const expandedKey = ref<string | null>(null);

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

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function oppKey(opp: ArbitrageOpportunity): string {
    return `${opp.symbol}-${opp.buyExchange}-${opp.sellExchange}`;
  }

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

  /**
   * Get net profit info for a specific opportunity (accounting for fees).
   */
  function getNetProfit(opp: ArbitrageOpportunity) {
    return calcProfit(opp.buyPrice, opp.sellPrice, opp.buyExchange, opp.sellExchange);
  }

  /**
   * Analyze a specific opportunity: fetch orderbooks, run full pipeline.
   */
  async function analyzeOpportunity(opp: ArbitrageOpportunity): Promise<void> {
    const key = oppKey(opp);
    analyzingKey.value = key;
    analysisError.value = null;

    try {
      const result = await analyzeOpp(opp);
      analysisResults.value[key] = result;
      expandedKey.value = key;
    } catch (err: any) {
      analysisError.value = err?.response?.data?.error || err.message || "Analysis failed";
      console.error("[Store] Analysis failed:", err.message);
    } finally {
      analyzingKey.value = null;
    }
  }

  /** Deep scan: verify all opportunities against real orderbooks, sort by GO/NO-GO */
  async function deepScan(): Promise<void> {
    if (opportunities.value.length === 0) return;
    isDeepScanning.value = true;
    lastError.value = null;

    try {
      const result = await deepScanOpportunities(opportunities.value);
      opportunities.value = result.opportunities;
      lastUpdated.value = new Date();
    } catch (err: any) {
      lastError.value = err?.response?.data?.error || err.message || "Deep scan failed";
      console.error("[Store] Deep scan failed:", err.message);
    } finally {
      isDeepScanning.value = false;
    }
  }

  /** Toggle expanded state for an opportunity */
  function toggleExpanded(opp: ArbitrageOpportunity) {
    const key = oppKey(opp);
    expandedKey.value = expandedKey.value === key ? null : key;
  }

  /** Get analysis result for an opportunity */
  function getAnalysis(opp: ArbitrageOpportunity): AnalysisResult | null {
    return analysisResults.value[oppKey(opp)] || null;
  }

  /** Check if an opportunity is currently being analyzed */
  function isAnalyzing(opp: ArbitrageOpportunity): boolean {
    return analyzingKey.value === oppKey(opp);
  }

  /** Check if an opportunity's analysis is expanded */
  function isExpanded(opp: ArbitrageOpportunity): boolean {
    return expandedKey.value === oppKey(opp);
  }

  return {
    // State
    prices,
    opportunities,
    isLoading,
    lastError,
    lastUpdated,
    // Analysis State
    analysisResults,
    analyzingKey,
    analysisError,
    expandedKey,
    // Computed
    bestOpportunity,
    bestSpreadPct,
    avgSpreadPct,
    exchangeCount,
    symbolCount,
    // Actions
    refresh,
    getNetProfit,
    analyzeOpportunity,
    toggleExpanded,
    getAnalysis,
    isAnalyzing,
    isExpanded,
    isDeepScanning,
    deepScan,
    oppKey,
  };
});

