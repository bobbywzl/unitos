# Sparse Routing for Long-Context Transformers

We study whether a transformer can read inputs of 256,000 tokens without attending to every token at every layer. We propose sparse routing: at each layer, a learned router selects the 4,096 tokens most relevant to the current query block, and attention runs over that subset only. On three long-document benchmarks, sparse routing matches dense attention within 0.4 points of accuracy while cutting attention compute by 61 percent at 256,000 tokens.

## Background

Dense attention costs grow with the square of the input length. At 8,000 tokens the attention layers take 18 percent of a forward pass; at 256,000 tokens they take 84 percent. Earlier work reduced this cost with fixed patterns: sliding windows, strided blocks, or a small set of global tokens. Fixed patterns are cheap but blind. A sliding window of 4,096 tokens cannot connect a claim on page 3 with its evidence on page 190, and our error analysis in Section 5 shows that 72 percent of the failures of windowed models on the benchmark are exactly such long-range links.

## Method

A router is a two-layer network of 12 million parameters, one per attention layer, shared across heads. For a query block of 512 tokens it scores every key token with a dot product against a pooled query vector and keeps the top 4,096 keys. The kept set always includes the 512 tokens of the block itself and the first 128 tokens of the document, so local context and the document opening are never dropped. The router is trained jointly with the model on a loss that rewards keeping the keys the dense model attended to most; we call this the retention loss. Without the retention loss, the router keeps recent tokens almost exclusively and accuracy falls by 3.1 points.

Routing adds one pass of scoring per block. The scoring cost is linear in the input length, so at 256,000 tokens it is 2.3 percent of the cost of dense attention.

## Results

| Benchmark | Dense | Window 4k | Sparse routing |
|---|---|---|---|
| LongQA (accuracy) | 71.2 | 58.9 | 70.8 |
| ContractNLI (F1) | 83.5 | 77.1 | 83.3 |
| BookSum (ROUGE-L) | 41.0 | 36.4 | 40.6 |

The largest gain over the windowed baseline is on LongQA, where 11.9 points separate the two, and the questions that recover are the ones whose answer sits more than 50,000 tokens from the question's mention. Throughput at 256,000 tokens is 2.4 times that of dense attention on the same hardware. Memory for the attention layers falls from 96 gigabytes to 31 gigabytes.

## Limitations

The router is trained for a fixed budget of 4,096 keys. A document whose relevant evidence is spread over more than 4,096 tokens loses part of it: on the 8 percent of LongQA questions with more than ten supporting passages, sparse routing trails dense attention by 4.7 points. Routing also depends on the pooled query vector; a query block that mixes two unrelated questions gets a compromise set of keys and answers both worse. We did not test inputs above 256,000 tokens.

## Conclusion

Sparse routing keeps the accuracy of dense attention on long documents at a fraction of its cost, and the retention loss is what makes the router keep the right tokens. The budget of 4,096 keys is the one setting a user has to choose, and the limitations section says when it is too small.
