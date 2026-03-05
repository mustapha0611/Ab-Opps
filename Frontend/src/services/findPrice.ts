import axios from "axios";
import type { ScanResult } from "@/types/crypto";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Fetch exchange prices and arbitrage opportunities from the backend.
 */
export async function fetchExchangePrices(): Promise<ScanResult> {
  const response = await axios.get<ScanResult>(`${API_URL}/api/exchange-prices`);
  return response.data;
}
