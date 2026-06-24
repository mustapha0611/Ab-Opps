$response = Invoke-RestMethod -Uri "http://localhost:3001/api/exchange-prices"
Write-Host "Opportunities: $($response.opportunities.Count)"

if ($response.opportunities.Count -gt 0) {
    $opp = $response.opportunities[0]
    Write-Host "Testing: $($opp.symbol) | Buy: $($opp.buyExchange) @ $($opp.buyPrice) | Sell: $($opp.sellExchange) @ $($opp.sellPrice) | Spread: $($opp.spreadPct)%"
    
    $body = @{
        symbol = $opp.symbol
        buyExchange = $opp.buyExchange
        sellExchange = $opp.sellExchange
        buyPrice = $opp.buyPrice
        sellPrice = $opp.sellPrice
        investmentAmounts = @(100, 500, 1000)
    } | ConvertTo-Json
    
    try {
        $analysis = Invoke-RestMethod -Uri "http://localhost:3001/api/analyze-opportunity" -Method Post -Body $body -ContentType "application/json"
        Write-Host "Decision: $($analysis.recommendation.decision)"
        Write-Host "Buy Asks: $($analysis.orderbook.buyAsks.Count)"
        Write-Host "Sell Bids: $($analysis.orderbook.sellBids.Count)"
        Write-Host "Buy Liquidity: `$$($analysis.liquidity.buyLiquidityUsd)"
        Write-Host "Sell Liquidity: `$$($analysis.liquidity.sellLiquidityUsd)"
        Write-Host "Reason: $($analysis.recommendation.reason)"
        $analysis.analysis | Format-Table investmentUsd, netProfitUsd, roiPct, feasible -AutoSize
    } catch {
        Write-Host "Analysis failed: $_"
    }
}
