"""Statistical evaluators: BLEU, ROUGE-L, Levenshtein, SemanticSimilarity."""
from __future__ import annotations

import math
from collections import Counter
from typing import Any

from app.core.base import BaseEvaluator
from app.models.schemas import EvalInput, EvalResult


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


class BLEUEvaluator(BaseEvaluator):
    """BLEU score between output and expected (reference).

    Uses a simplified BLEU-4 implementation without external dependencies.
    """

    def __init__(self, name: str = "bleu", max_n: int = 4) -> None:
        super().__init__(name=name, type="statistical")
        self.max_n = max_n

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        candidate = _tokenize(_to_str(eval_input.output))
        reference = _tokenize(_to_str(eval_input.expected))

        if not candidate or not reference:
            return EvalResult(score=0.0, reasoning="Empty candidate or reference.")

        brevity_penalty = min(1.0, math.exp(1 - len(reference) / max(len(candidate), 1)))

        precisions: list[float] = []
        for n in range(1, self.max_n + 1):
            cand_ngrams = _ngrams(candidate, n)
            ref_ngrams = _ngrams(reference, n)
            if not cand_ngrams:
                precisions.append(0.0)
                continue
            clipped = sum(min(cand_ngrams[ng], ref_ngrams.get(ng, 0)) for ng in cand_ngrams)
            precisions.append(clipped / sum(cand_ngrams.values()))

        if any(p == 0 for p in precisions):
            score = 0.0
        else:
            log_avg = sum(math.log(p) for p in precisions) / len(precisions)
            score = brevity_penalty * math.exp(log_avg)

        return EvalResult(
            score=min(max(score, 0.0), 1.0),
            reasoning=f"BLEU-{self.max_n}: {score:.4f} (BP={brevity_penalty:.3f})",
            metadata={"precisions": [round(p, 4) for p in precisions], "brevity_penalty": round(brevity_penalty, 4)},
        )


class ROUGELEvaluator(BaseEvaluator):
    """ROUGE-L score (longest common subsequence F1) without external dependencies."""

    def __init__(self, name: str = "rouge_l") -> None:
        super().__init__(name=name, type="statistical")

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        candidate = _tokenize(_to_str(eval_input.output))
        reference = _tokenize(_to_str(eval_input.expected))

        if not candidate or not reference:
            return EvalResult(score=0.0, reasoning="Empty candidate or reference.")

        lcs_len = _lcs_length(reference, candidate)
        precision = lcs_len / len(candidate) if candidate else 0
        recall = lcs_len / len(reference) if reference else 0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0

        return EvalResult(
            score=min(max(f1, 0.0), 1.0),
            reasoning=f"ROUGE-L F1={f1:.4f} (P={precision:.3f}, R={recall:.3f})",
            metadata={"precision": round(precision, 4), "recall": round(recall, 4), "lcs_length": lcs_len},
        )


class LevenshteinEvaluator(BaseEvaluator):
    """Normalized Levenshtein similarity: 1 - edit_distance / max(len_a, len_b)."""

    def __init__(self, name: str = "levenshtein") -> None:
        super().__init__(name=name, type="statistical")

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        a = _to_str(eval_input.output)
        b = _to_str(eval_input.expected)

        if not a and not b:
            return EvalResult(score=1.0, reasoning="Both strings are empty.")
        if not a or not b:
            return EvalResult(score=0.0, reasoning="One string is empty.")

        dist = _levenshtein_distance(a, b)
        max_len = max(len(a), len(b))
        similarity = 1.0 - dist / max_len

        return EvalResult(
            score=min(max(similarity, 0.0), 1.0),
            reasoning=f"Levenshtein similarity={similarity:.4f} (distance={dist}, max_len={max_len})",
            metadata={"distance": dist, "max_length": max_len},
        )


class SemanticSimilarityEvaluator(BaseEvaluator):
    """Semantic similarity via word overlap (bag-of-words cosine).

    A lightweight fallback that does not require external embedding models.
    For production use, replace with sentence-transformers or LLM embeddings.
    """

    def __init__(self, name: str = "semantic_similarity") -> None:
        super().__init__(name=name, type="statistical")

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        tokens_a = _tokenize(_to_str(eval_input.output))
        tokens_b = _tokenize(_to_str(eval_input.expected))

        if not tokens_a or not tokens_b:
            return EvalResult(score=0.0, reasoning="Empty output or expected.")

        vec_a = Counter(tokens_a)
        vec_b = Counter(tokens_b)
        all_keys = set(vec_a.keys()) | set(vec_b.keys())

        dot = sum(vec_a.get(k, 0) * vec_b.get(k, 0) for k in all_keys)
        norm_a = math.sqrt(sum(v * v for v in vec_a.values()))
        norm_b = math.sqrt(sum(v * v for v in vec_b.values()))

        if norm_a == 0 or norm_b == 0:
            return EvalResult(score=0.0, reasoning="Zero-length vector.")

        cosine = dot / (norm_a * norm_b)
        return EvalResult(
            score=min(max(cosine, 0.0), 1.0),
            reasoning=f"Bag-of-words cosine similarity={cosine:.4f}",
            metadata={"method": "bow_cosine"},
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ngrams(tokens: list[str], n: int) -> dict[tuple[str, ...], int]:
    counts: dict[tuple[str, ...], int] = {}
    for i in range(len(tokens) - n + 1):
        ng = tuple(tokens[i : i + n])
        counts[ng] = counts.get(ng, 0) + 1
    return counts


def _lcs_length(x: list[str], y: list[str]) -> int:
    m, n = len(x), len(y)
    prev = [0] * (n + 1)
    for i in range(1, m + 1):
        curr = [0] * (n + 1)
        for j in range(1, n + 1):
            if x[i - 1] == y[j - 1]:
                curr[j] = prev[j - 1] + 1
            else:
                curr[j] = max(prev[j], curr[j - 1])
        prev = curr
    return prev[n]


def _levenshtein_distance(a: str, b: str) -> int:
    m, n = len(a), len(b)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        curr = [i] + [0] * n
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[n]
