import axios from "axios";
import type { ArbitrageOpportunity, DeepScanResult } from "@/types/crypto";

const API_URL = import.meta.env.VITE_API_URL || "";

export async function deepScanOpportunities(
  opportunities: ArbitrageOpportunity[]
): Promise<DeepScanResult> {
  const response = await axios.post<DeepScanResult>(
    `${API_URL}/api/deep-scan`,
    { opportunities }
  );
  return response.data;
}
