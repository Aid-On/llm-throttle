# @aid-on/llm-throttle

高精度なLLMレート制限ライブラリ - Precise dual rate limiting for LLM APIs (RPM + TPM)

## 概要

`@aid-on/llm-throttle`は、LLM API呼び出しに特化した高精度なレート制限ライブラリです。RPM（Requests Per Minute）とTPM（Tokens Per Minute）の両方を同時に制御し、効率的なAPI利用を実現します。

## 特徴

- **デュアルレート制限**: RPMとTPMの両方を同時に管理
- **トークンバケットアルゴリズム**: 平滑化されたレート制限とバースト処理
- **リアルタイム調整**: 実際のトークン消費量に基づく事後調整
- **詳細なメトリクス**: 使用状況の可視化と効率性の追跡
- **TypeScript完全対応**: 型安全な開発体験
- **ゼロ依存**: 外部ライブラリに依存しない軽量設計

## インストール

```bash
npm install @aid-on/llm-throttle
```

## 基本的な使用方法

```typescript
import { LLMThrottle } from '@aid-on/llm-throttle';

// レート制限の設定
const limiter = new LLMThrottle({
  rpm: 60,     // 1分間に60リクエスト
  tpm: 10000   // 1分間に10,000トークン
});

// リクエスト前のチェック
const requestId = 'unique-request-id';
const estimatedTokens = 1500;

if (limiter.consume(requestId, estimatedTokens)) {
  // API呼び出し実行
  const response = await callLLMAPI();
  
  // 実際のトークン使用量で調整
  const actualTokens = response.usage.total_tokens;
  limiter.adjustConsumption(requestId, actualTokens);
} else {
  console.log('レート制限に達しています');
}
```

## 高度な使用方法

### バースト制限の設定

```typescript
const limiter = new LLMThrottle({
  rpm: 60,
  tpm: 10000,
  burstRPM: 120,    // 短期間で120リクエストまで許可
  burstTPM: 20000   // 短期間で20,000トークンまで許可
});
```

### エラーハンドリング

```typescript
import { RateLimitError } from '@aid-on/llm-throttle';

try {
  limiter.consumeOrThrow(requestId, estimatedTokens);
  // API呼び出し処理
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`制限理由: ${error.reason}`);
    console.log(`再試行まで: ${error.availableIn}ms`);
  }
}
```

### メトリクスの取得

```typescript
const metrics = limiter.getMetrics();

console.log('RPM使用率:', metrics.rpm.percentage + '%');
console.log('TPM使用率:', metrics.tpm.percentage + '%');
console.log('平均トークン/リクエスト:', metrics.consumptionHistory.averageTokensPerRequest);
console.log('推定精度:', metrics.efficiency);
```

### 事前チェック

```typescript
const check = limiter.canProcess(estimatedTokens);

if (check.allowed) {
  // 処理可能
  limiter.consume(requestId, estimatedTokens);
} else {
  console.log(`制限理由: ${check.reason}`);
  console.log(`利用可能になるまで: ${check.availableIn}ms`);
}
```

## API リファレンス

### LLMThrottle

#### コンストラクター

```typescript
new LLMThrottle(config: DualRateLimitConfig)
```

#### メソッド

- `canProcess(estimatedTokens: number): RateLimitCheckResult` - 処理可能かチェック
- `consume(requestId: string, estimatedTokens: number, metadata?: Record<string, unknown>): boolean` - トークンを消費
- `consumeOrThrow(requestId: string, estimatedTokens: number, metadata?: Record<string, unknown>): void` - 消費失敗時にエラーを投げる
- `adjustConsumption(requestId: string, actualTokens: number): void` - 実際の消費量で調整
- `getMetrics(): RateLimitMetrics` - 使用状況メトリクスを取得
- `getConsumptionHistory(): ConsumptionRecord[]` - 消費履歴を取得
- `reset(): void` - 制限状態をリセット
- `setHistoryRetention(ms: number): void` - 履歴保持期間を設定

### 型定義

```typescript
interface DualRateLimitConfig {
  rpm: number;
  tpm: number;
  burstRPM?: number;
  burstTPM?: number;
  clock?: () => number;
}

interface RateLimitCheckResult {
  allowed: boolean;
  reason?: 'rpm_limit' | 'tpm_limit';
  availableIn?: number;
  availableTokens?: {
    rpm: number;
    tpm: number;
  };
}

interface RateLimitMetrics {
  rpm: {
    used: number;
    available: number;
    limit: number;
    percentage: number;
  };
  tpm: {
    used: number;
    available: number;
    limit: number;
    percentage: number;
  };
  efficiency: number;
  consumptionHistory: {
    count: number;
    averageTokensPerRequest: number;
    totalTokens: number;
  };
}
```

## 実用例

### OpenAI API との統合

```typescript
import OpenAI from 'openai';
import { LLMThrottle } from '@aid-on/llm-throttle';

const openai = new OpenAI();
const limiter = new LLMThrottle({
  rpm: 500,    // OpenAI Tier 1の制限例
  tpm: 10000
});

async function chatCompletion(messages: any[], requestId: string) {
  const estimatedTokens = estimateTokens(messages); // 独自の推定ロジック
  
  if (!limiter.consume(requestId, estimatedTokens)) {
    throw new Error('レート制限に達しています');
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages
    });
    
    // 実際の使用量で調整
    const actualTokens = response.usage?.total_tokens || estimatedTokens;
    limiter.adjustConsumption(requestId, actualTokens);
    
    return response;
  } catch (error) {
    // エラー時は推定値を返却
    limiter.adjustConsumption(requestId, 0);
    throw error;
  }
}
```

### 複数サービスの統合

```typescript
class APIManager {
  private limiters = new Map<string, LLMThrottle>();
  
  constructor() {
    // サービス別の制限設定
    this.limiters.set('openai', new LLMThrottle({
      rpm: 500, tpm: 10000
    }));
    this.limiters.set('anthropic', new LLMThrottle({
      rpm: 1000, tpm: 20000
    }));
  }
  
  async callAPI(service: string, requestId: string, estimatedTokens: number) {
    const limiter = this.limiters.get(service);
    if (!limiter) throw new Error(`Unknown service: ${service}`);
    
    const check = limiter.canProcess(estimatedTokens);
    if (!check.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded for ${service}: ${check.reason}`,
        check.reason!,
        check.availableIn!
      );
    }
    
    limiter.consume(requestId, estimatedTokens);
    // API呼び出し処理...
  }
}
```

## テスト

```bash
npm test
```

## ライセンス

MIT License